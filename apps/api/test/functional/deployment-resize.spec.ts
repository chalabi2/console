import { yaml } from "@akashnetwork/chain-sdk";
import { MsgCancelLeaseResize } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { faker } from "@faker-js/faker";
import { CompactEncrypt } from "jose";
import nock from "nock";
import { randomUUID } from "node:crypto";
import { container } from "tsyringe";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import { startJobQueues } from "@src/app/providers/jobs.provider";
import { ApiKeyAuthService } from "@src/auth/services/api-key/api-key-auth.service";
import { AuthService } from "@src/auth/services/auth.service";
import { UserWalletRepository } from "@src/billing/repositories";
import { ManagedSignerService } from "@src/billing/services";
import { BlockHttpService } from "@src/chain/services/block-http/block-http.service";
import { CORE_CONFIG, JobQueueService } from "@src/core";
import { ExecutionContextService } from "@src/core/services/execution-context/execution-context.service";
import { FeatureFlags } from "@src/core/services/feature-flags/feature-flags";
import { FeatureFlagsService } from "@src/core/services/feature-flags/feature-flags.service";
import { SDL_SECRETS_CONTENT_ENCRYPTION, SDL_SECRETS_SEAL_ALGORITHM } from "@src/deployment/config/sdl-secrets.config";
import { DeploymentSettingRepository } from "@src/deployment/repositories/deployment-setting/deployment-setting.repository";
import { ApplyDeploymentUpdate } from "@src/deployment/services/apply-deployment-update/apply-deployment-update.job";
import { SdlService } from "@src/deployment/services/sdl/sdl.service";
import { SdlSecretsService } from "@src/deployment/services/sdl-secrets/sdl-secrets.service";
import { ProviderService } from "@src/provider/services/provider/provider.service";
import { app } from "@src/rest-app";
import { UserRepository } from "@src/user/repositories";
import { deploymentVersion, marketVersion } from "@src/utils/constants";

import { registerFakeSdlSecretsKms, SDL_SECRETS_KID, warmSealingKeyAsBootWould } from "@test/mocks/sdl-secrets-kms.mock";
import { createAkashAddress } from "@test/seeders/akash-address.seeder";
import { createApiKey } from "@test/seeders/api-key.seeder";
import { createDeployment } from "@test/seeders/deployment.seeder";
import { createDeploymentInfoGroupsFromSdl, createDeploymentInfoSeed } from "@test/seeders/deployment-info.seeder";
import { createManyLeaseApiResponses } from "@test/seeders/lease-api-response.seeder";
import { createLeaseStatus } from "@test/seeders/lease-status.seeder";
import { createUser } from "@test/seeders/user.seeder";
import { createUserWallet } from "@test/seeders/user-wallet.seeder";

const { publicKey } = registerFakeSdlSecretsKms();

const DSEQ = "1234";

const STORED_SDL = [
  'version: "2.0"',
  "services:",
  "  web:",
  "    image: nginx",
  "    expose:",
  "      - port: 80",
  "        as: 80",
  "        to:",
  "          - global: true",
  "profiles:",
  "  compute:",
  "    web:",
  "      resources:",
  "        cpu:",
  "          units: 0.5",
  "        memory:",
  "          size: 512Mi",
  "        storage:",
  "          - size: 1Gi",
  "  placement:",
  "    dcloud:",
  "      pricing:",
  "        web:",
  "          denom: uact",
  "          amount: 10000",
  "deployment:",
  "  web:",
  "    dcloud:",
  "      profile: web",
  "      count: 1",
  ""
].join("\n");

describe("Resizing a deployment's lease in place", () => {
  const userRepository = container.resolve(UserRepository);
  const apiKeyAuthService = container.resolve(ApiKeyAuthService);
  const userWalletRepository = container.resolve(UserWalletRepository);
  const blockHttpService = container.resolve(BlockHttpService);
  const signerService = container.resolve(ManagedSignerService);
  const providerService = container.resolve(ProviderService);
  const deploymentSettingRepository = container.resolve(DeploymentSettingRepository);

  beforeAll(async () => {
    await startJobQueues();
    await warmSealingKeyAsBootWould();
  }, 20_000);

  afterEach(() => {
    vi.restoreAllMocks();
    nock.cleanAll();
  });

  afterAll(async () => {
    await container.dispose();
    vi.restoreAllMocks();
    nock.cleanAll();
  });

  describe("PATCH /v1/deployments/{dseq}", () => {
    it("records the resized definition and leaves the resize to the background, answering 202 with the update's activity", async () => {
      const { apiKey, user, address } = await setup({ resizeOnChain: true });
      const enqueue = vi.spyOn(container.resolve(JobQueueService), "enqueue");

      const response = await patch(apiKey, { services: { web: { resources: { cpu: 2, memory: "2Gi" }, count: 2 } } });

      expect(response.status).toBe(202);
      const { data } = (await response.json()) as { data: { activityId: string; manifestVersion: string } };
      expect(data).toEqual({ activityId: expect.any(String), manifestVersion: expect.any(String) });
      const stored = yaml.raw<{ profiles: { compute: { web: { resources: unknown } } }; deployment: { web: { dcloud: { count: number } } } }>(
        (await deploymentSettingRepository.findOneBy({ userId: user.id, dseq: DSEQ }))!.sdl!
      );
      expect(stored.profiles.compute.web.resources).toEqual({ cpu: { units: 2 }, memory: { size: "2Gi" }, storage: [{ size: "1Gi" }] });
      expect(stored.deployment.web.dcloud.count).toBe(2);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ name: ApplyDeploymentUpdate.name, data: expect.objectContaining({ owner: address, manifestVersion: data.manifestVersion }) }),
        expect.anything()
      );
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
      expect(providerService.sendManifest).not.toHaveBeenCalled();
    });

    it("lists the update as a pending resize, which a caller can withdraw", async () => {
      const { apiKey } = await setup({ resizeOnChain: true });

      const response = await patch(apiKey, { services: { web: { resources: { cpu: 2 } } } });

      const { data } = (await response.json()) as { data: { activityId: string; manifestVersion: string } };
      const listed = await app.request("/v1/activities", { headers: new Headers({ "x-api-key": apiKey }) });
      expect(((await listed.json()) as { data: { activities: unknown[] } }).data.activities).toEqual([
        expect.objectContaining({
          id: data.activityId,
          type: "deployment_update",
          status: "pending",
          meta: { dseq: DSEQ, manifestVersion: data.manifestVersion, resize: true }
        })
      ]);
    });

    it("refuses a change of resources as one that needs a new deployment while the network has resizing turned off", async () => {
      const { apiKey, user, sdl } = await setup({ resizeOnChain: false });

      const response = await patch(apiKey, { services: { web: { resources: { cpu: 2 } } } });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "deployment_resources_changed" });
      expect((await deploymentSettingRepository.findOneBy({ userId: user.id, dseq: DSEQ }))!.sdl).toBe(sdl);
    });

    it("refuses GPUs for a service that runs without any, recording nothing", async () => {
      const { apiKey, user, sdl } = await setup({ resizeOnChain: true });

      const response = await patch(apiKey, { services: { web: { resources: { gpu: 1 } } } });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ message: expect.stringContaining("/profiles/compute/web/resources/gpu") });
      expect((await deploymentSettingRepository.findOneBy({ userId: user.id, dseq: DSEQ }))!.sdl).toBe(sdl);
    });

    it("refuses a patch of other fields while the recorded definition asks for resources the deployment does not hold, resizing nothing", async () => {
      const { apiKey, user, sdl } = await setup({ resizeOnChain: true, chainSdl: STORED_SDL.replace("units: 0.5", "units: 1") });

      const response = await patch(apiKey, { services: { web: { image: "nginx:1.27" } } });

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "deployment_resources_unapplied" });
      expect((await deploymentSettingRepository.findOneBy({ userId: user.id, dseq: DSEQ }))!.sdl).toBe(sdl);
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });

    it("re-applies a recorded definition asking for other resources by resizing the lease, given a patch that changes nothing", async () => {
      const { apiKey, user } = await setup({ resizeOnChain: true, chainSdl: STORED_SDL.replace("units: 0.5", "units: 1") });
      const enqueue = vi.spyOn(container.resolve(JobQueueService), "enqueue");

      const response = await patch(apiKey, { sealedSecrets: await sealFor(user.id, {}) });

      expect(response.status).toBe(202);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ name: ApplyDeploymentUpdate.name, data: expect.objectContaining({ resizes: true }) }),
        expect.anything()
      );
    });

    it("refuses any patch while a resize waits for the deployment's provider", async () => {
      const { apiKey } = await setup({ resizeOnChain: true, pendingResize: true });

      const response = await patch(apiKey, { services: { web: { image: "nginx:1.27" } } });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "deployment_resize_pending" });
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });
  });

  describe("DELETE /v1/deployments/{dseq}/resize", () => {
    it("withdraws the pending resize of the lease it names", async () => {
      const { apiKey, address } = await setup({ resizeOnChain: true, pendingResize: true });

      const response = await app.request(`/v1/deployments/${DSEQ}/resize`, { method: "DELETE", headers: new Headers({ "x-api-key": apiKey }) });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: { success: true } });
      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(
        expect.objectContaining({ address }),
        [
          {
            typeUrl: `/${MsgCancelLeaseResize.$type}`,
            value: MsgCancelLeaseResize.fromPartial({ id: { owner: address, dseq: 1234n, gseq: 1, oseq: 1, provider: "akash1provider", bseq: 0 } })
          }
        ],
        expect.anything()
      );
    });

    it("answers 404 when no resize waits for the provider", async () => {
      const { apiKey } = await setup({ resizeOnChain: true });

      const response = await app.request(`/v1/deployments/${DSEQ}/resize`, { method: "DELETE", headers: new Headers({ "x-api-key": apiKey }) });

      expect(response.status).toBe(404);
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });
  });

  async function sealFor(userId: string, secrets: Record<string, string>) {
    return await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(secrets)))
      .setProtectedHeader({
        alg: SDL_SECRETS_SEAL_ALGORITHM,
        enc: SDL_SECRETS_CONTENT_ENCRYPTION,
        kid: SDL_SECRETS_KID,
        sub: userId,
        exp: Math.floor(Date.now() / 1000) + 300
      })
      .encrypt(publicKey);
  }

  function patch(apiKey: string, data: Record<string, unknown>) {
    return app.request(`/v1/deployments/${DSEQ}`, {
      method: "PATCH",
      body: JSON.stringify({ data }),
      headers: new Headers({ "Content-Type": "application/json", "x-api-key": apiKey })
    });
  }

  async function mockChain(input: { address: string; sdl: string; resizeOnChain: boolean; pendingResize?: boolean }) {
    const restUrl = container.resolve(CORE_CONFIG).REST_API_NODE_URL;
    const { address, sdl } = input;
    const info = createDeploymentInfoSeed({ owner: address, dseq: DSEQ, groups: createDeploymentInfoGroupsFromSdl({ sdl, owner: address, dseq: DSEQ }) });
    const leases = createManyLeaseApiResponses(1, { owner: address, dseq: DSEQ, state: "active" });
    const pending = {
      lease_id: { owner: address, dseq: DSEQ, gseq: 1, oseq: 1, provider: "akash1provider", bseq: 0 },
      resources: [],
      hash: "",
      requested_at: "1",
      expires_at: "4000000000",
      digest: ""
    };

    nock(restUrl).persist().get(`/akash/deployment/${deploymentVersion}/deployments/info?id.owner=${address}&id.dseq=${DSEQ}`).reply(200, info);
    nock(restUrl).persist().get(`/akash/market/${marketVersion}/leases/list?filters.owner=${address}&filters.dseq=${DSEQ}`).reply(200, { leases });
    nock(restUrl)
      .persist()
      .get(`/akash/market/${marketVersion}/leases/list?filters.owner=${address}&filters.dseq=${DSEQ}&pagination.limit=1000`)
      .reply(200, { leases });
    nock(restUrl)
      .persist()
      .get(`/akash/market/${marketVersion}/params`)
      .reply(200, { params: { lease_resize_enabled: input.resizeOnChain, lease_resize_ttl: "600s" } });
    nock(restUrl)
      .persist()
      .get(`/akash/market/${marketVersion}/leases/resizes`)
      .query({ owner: address, dseq: DSEQ })
      .reply(200, { lease_resizes: input.pendingResize ? [pending] : [], pagination: null });

    await createDeployment({ owner: address, dseq: DSEQ });
  }

  async function setup(input: { resizeOnChain: boolean; pendingResize?: boolean; chainSdl?: string }) {
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
    vi.spyOn(blockHttpService, "getCurrentHeight").mockResolvedValue(faker.number.int({ min: 1000000, max: 10000000 }));
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
    vi.spyOn(providerService, "sendManifest").mockResolvedValue(true);
    vi.spyOn(providerService, "getLeaseStatus").mockResolvedValue(createLeaseStatus());
    vi.spyOn(providerService, "toProviderAuth").mockResolvedValue(mock());
    vi.spyOn(container.resolve(FeatureFlagsService), "isEnabled").mockImplementation(
      flag => flag !== FeatureFlags.ORGANIZATIONS && flag !== FeatureFlags.ORGANIZATIONS_ENFORCE
    );

    const sdl = STORED_SDL;
    await mockChain({ address, sdl: input.chainSdl ?? sdl, resizeOnChain: input.resizeOnChain, pendingResize: input.pendingResize });

    const sealedSecrets = await container.resolve(ExecutionContextService).runWithContext(async () => {
      container.resolve(AuthService).currentUser = user;

      return await container.resolve(SdlSecretsService).sealForStorage({ userId: user.id, dseq: DSEQ, secrets: { unused: randomUUID() } });
    });
    const resolved = await container.resolve(SdlService).generateResolvedManifest({ sdl, secrets: {} });

    await deploymentSettingRepository.upsertDefinition({
      userId: user.id,
      dseq: DSEQ,
      sdl,
      manifestVersion: resolved.ok ? Buffer.from(resolved.value.manifestVersion).toString("base64") : "unresolvable",
      sealedSecrets
    });

    return { user, apiKey, address, sdl };
  }
});
