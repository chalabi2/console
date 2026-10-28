import { MsgCloseLease } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { faker } from "@faker-js/faker";
import nock from "nock";
import { container } from "tsyringe";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import { ApiKeyAuthService } from "@src/auth/services/api-key/api-key-auth.service";
import { UserWalletRepository } from "@src/billing/repositories";
import { ManagedSignerService } from "@src/billing/services";
import { CORE_CONFIG } from "@src/core";
import { FeatureFlags } from "@src/core/services/feature-flags/feature-flags";
import { FeatureFlagsService } from "@src/core/services/feature-flags/feature-flags.service";
import { app } from "@src/rest-app";
import { UserRepository } from "@src/user/repositories";
import { deploymentVersion, marketVersion } from "@src/utils/constants";

import { createAkashAddress } from "@test/seeders/akash-address.seeder";
import { createApiKey } from "@test/seeders/api-key.seeder";
import { createDeployment } from "@test/seeders/deployment.seeder";
import { createDeploymentInfoGroupSeed, createDeploymentInfoSeed } from "@test/seeders/deployment-info.seeder";
import { createLeaseApiResponse } from "@test/seeders/lease-api-response.seeder";
import { createUser } from "@test/seeders/user.seeder";
import { createUserWallet } from "@test/seeders/user-wallet.seeder";

const DSEQ = "5678";
const PROVIDER = "akash1provider";

describe("Moving a volume to another provider", () => {
  const userRepository = container.resolve(UserRepository);
  const apiKeyAuthService = container.resolve(ApiKeyAuthService);
  const userWalletRepository = container.resolve(UserWalletRepository);
  const signerService = container.resolve(ManagedSignerService);

  afterEach(() => {
    vi.restoreAllMocks();
    nock.cleanAll();
  });

  afterAll(async () => {
    await container.dispose();
  });

  describe("POST /v1/deployments/{dseq}/move", () => {
    it("closes the volume's lease, which the chain reclaims to move it", async () => {
      const { apiKey, address, lease } = await setup({});

      const response = await move(apiKey);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { success: true } });
      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(
        expect.objectContaining({ address }),
        [
          {
            typeUrl: `/${MsgCloseLease.$type}`,
            value: MsgCloseLease.fromPartial({ id: { ...lease.id, dseq: 5678n } })
          }
        ],
        expect.anything()
      );
      expect(lease.id).toMatchObject({ owner: address, dseq: DSEQ, gseq: 1, oseq: 1, provider: PROVIDER });
    });

    it("refuses a deployment that is not a volume", async () => {
      const { apiKey } = await setup({ volume: false });

      const response = await move(apiKey);

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: "Only a volume can be moved to another provider" });
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });

    it("closes a bucket's lease the same way, for its objects to move with it", async () => {
      const { apiKey, address, lease } = await setup({ access: "bucket" });

      const response = await move(apiKey);

      expect(response.status).toBe(200);
      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(
        expect.objectContaining({ address }),
        [
          {
            typeUrl: `/${MsgCloseLease.$type}`,
            value: MsgCloseLease.fromPartial({ id: { ...lease.id, dseq: 5678n } })
          }
        ],
        expect.anything()
      );
    });

    it("refuses a volume already on its way out of its lease", async () => {
      const { apiKey } = await setup({ leaseState: "reclaiming" });

      const response = await move(apiKey);

      expect(response.status).toBe(409);
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });

    it("refuses an anonymous request", async () => {
      await setup({});

      const response = await app.request(`/v1/deployments/${DSEQ}/move`, { method: "POST" });

      expect(response.status).toBe(401);
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });
  });

  function move(apiKey: string) {
    return app.request(`/v1/deployments/${DSEQ}/move`, { method: "POST", headers: new Headers({ "x-api-key": apiKey }) });
  }

  async function mockChain(input: { address: string; volume: boolean; access?: string; leaseState: string }) {
    const restUrl = container.resolve(CORE_CONFIG).REST_API_NODE_URL;
    const group = createDeploymentInfoGroupSeed({ owner: input.address, dseq: DSEQ, gseq: 1, name: "pgdata" });
    const groups = [
      {
        ...group,
        group_spec: {
          ...group.group_spec,
          ...(input.volume && {
            volume: { vid: "pgdata", access: input.access, reclaim: "retain", retention: "3600s", max_attachments: 1, max_replicas: 0 }
          })
        }
      }
    ];
    const info = createDeploymentInfoSeed({ owner: input.address, dseq: DSEQ, groups });
    const lease = createLeaseApiResponse({ owner: input.address, dseq: DSEQ, gseq: 1, oseq: 1, provider: PROVIDER, state: input.leaseState });
    const leases = [lease];

    nock(restUrl).persist().get(`/akash/deployment/${deploymentVersion}/deployments/info?id.owner=${input.address}&id.dseq=${DSEQ}`).reply(200, info);
    nock(restUrl).persist().get(`/akash/market/${marketVersion}/leases/list?filters.owner=${input.address}&filters.dseq=${DSEQ}`).reply(200, { leases });
    nock(restUrl)
      .persist()
      .get(`/akash/market/${marketVersion}/leases/list?filters.owner=${input.address}&filters.dseq=${DSEQ}&pagination.limit=1000`)
      .reply(200, { leases });

    await createDeployment({ owner: input.address, dseq: DSEQ });

    return lease.lease;
  }

  async function setup(input: { volume?: boolean; access?: string; leaseState?: string }) {
    const dbUser = await userRepository.create({ userId: faker.string.uuid() });
    const apiKey = faker.string.alphanumeric(24);
    const user = createUser({ id: dbUser.id, userId: dbUser.userId ?? undefined });
    const address = createAkashAddress();
    const wallets = [createUserWallet({ userId: dbUser.id, address })];
    const apiKeys: Record<string, ReturnType<typeof createApiKey>> = { [apiKey]: createApiKey({ userId: dbUser.id }) };

    vi.spyOn(userRepository, "findById").mockImplementation(async id =>
      id === dbUser.id ? { ...user, trial: false, userWallets: { isTrialing: false } } : undefined
    );
    vi.spyOn(apiKeyAuthService, "getAndValidateApiKeyFromHeader").mockImplementation(async key => apiKeys[key!]);
    vi.spyOn(userWalletRepository, "accessibleBy").mockReturnValue(
      mock<UserWalletRepository>({
        findByUserId: async () => wallets,
        findOneByUserId: async () => wallets[0],
        findOneUsedBy: async () => wallets[0]
      })
    );
    vi.spyOn(signerService, "executeDecodedTxByUserWallet").mockResolvedValue({
      code: 0,
      transactionHash: "fake-transaction-hash",
      hash: "fake-transaction-hash",
      rawLog: "fake-raw-log"
    });
    vi.spyOn(container.resolve(FeatureFlagsService), "isEnabled").mockImplementation(
      flag => flag !== FeatureFlags.ORGANIZATIONS && flag !== FeatureFlags.ORGANIZATIONS_ENFORCE
    );

    const lease = await mockChain({ address, volume: input.volume ?? true, access: input.access, leaseState: input.leaseState ?? "active" });

    return { apiKey, address, lease };
  }
});
