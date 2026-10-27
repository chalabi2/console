import { GroupSpec, type ResourceUnit } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import { LeaseResize } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import type { DeploymentHttpService } from "@akashnetwork/http-sdk";
import { describe, expect, it } from "vitest";
import { mock, mockDeep } from "vitest-mock-extended";

import type { BillingConfigService } from "@src/billing/services/billing-config/billing-config.service";
import type { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import { RpcMessageService } from "@src/billing/services/rpc-message-service/rpc-message.service";
import type { ChainSDK } from "@src/chain/providers/chain-sdk.provider";
import { FeatureFlags } from "@src/core/services/feature-flags/feature-flags";
import type { FeatureFlagsService } from "@src/core/services/feature-flags/feature-flags.service";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import { LeaseResizeService } from "./lease-resize.service";

import { mockConfigService } from "@test/mocks/config-service.mock";
import { createDeploymentInfoGroupSeed, createDeploymentInfoSeed } from "@test/seeders/deployment-info.seeder";
import { createInitializedUserWallet } from "@test/seeders/user-wallet.seeder";

describe(LeaseResizeService.name, () => {
  const OWNER = "akash1owner";
  const DSEQ = "1234";
  const VERSION = new Uint8Array([1, 2, 3]);
  const VERSION_BASE64 = Buffer.from(VERSION).toString("base64");
  const GI = 1024n ** 3n;

  describe("isAvailableTo", () => {
    it("is unavailable to a user the flag leaves out, without asking the chain", async () => {
      const { service, chainSdk, featureFlagsService } = setup({ flag: false });

      expect(await service.isAvailableTo("user-1")).toBe(false);
      expect(featureFlagsService.isEnabled).toHaveBeenCalledWith(FeatureFlags.LEASE_RESIZE, { userId: "user-1" });
      expect(chainSdk.akash.market.v1beta5.getParams).not.toHaveBeenCalled();
    });

    it.each([true, false])("follows the market parameter governance sets when the flag lets the user in (%s)", async enabledOnChain => {
      const { service } = setup({ flag: true, enabledOnChain });

      expect(await service.isAvailableTo("user-1")).toBe(enabledOnChain);
    });

    it("is unavailable on a network whose market reports no parameters", async () => {
      const { service, chainSdk } = setup({ flag: true });
      chainSdk.akash.market.v1beta5.getParams.mockResolvedValue({ params: undefined });

      expect(await service.isAvailableTo("user-1")).toBe(false);
    });
  });

  describe("findPending", () => {
    it("reads the one pending resize of the deployment", async () => {
      const pending = pendingResize();
      const { service, chainSdk } = setup({ pending });

      expect(await service.findPending(OWNER, DSEQ)).toBe(pending);
      expect(chainSdk.akash.market.v1beta5.getLeaseResizes).toHaveBeenCalledWith({ owner: OWNER, dseq: 1234n });
    });

    it("finds nothing for a deployment without a pending resize", async () => {
      const { service } = setup();

      expect(await service.findPending(OWNER, DSEQ)).toBeUndefined();
    });
  });

  describe("planFor", () => {
    it("leaves a deployment the chain could not describe to its provider, reading nothing", async () => {
      const { service, chainSdk } = setup({ flag: true, enabledOnChain: true });

      expect(await service.planFor(planInput({ submitted: [groupSpec({ cpu: "2000" })], groups: null }))).toBeUndefined();
      expect(chainSdk.akash.market.v1beta5.getParams).not.toHaveBeenCalled();
    });

    it.each([true, false])("plans nothing for a patch that keeps the resources (may resize: %s)", async mayResize => {
      const { service } = setup({ flag: true, enabledOnChain: true });

      expect(await service.planFor(planInput({ submitted: [groupSpec()], mayResize }))).toBeUndefined();
    });

    it("plans a resize of the group whose resources the patch changes", async () => {
      const { service } = setup({ flag: true, enabledOnChain: true });
      const resized = groupSpec({ cpu: "2000" });

      expect(await service.planFor(planInput({ submitted: [resized] }))).toEqual({ gseq: 1, groupName: "dcloud", resources: resized.resources });
    });

    it("refuses any patch with 409 while a resize is pending, because the chain refuses an update until it is answered", async () => {
      const { service } = setup({ flag: true, enabledOnChain: true, pending: pendingResize() });

      await expect(service.planFor(planInput({ submitted: [groupSpec()], mayResize: false }))).rejects.toMatchObject({
        status: 409,
        errorCode: "deployment_resize_pending",
        message: "A resize of this deployment is waiting for its provider. Wait for it to be answered, or cancel it, and try again."
      });
    });

    it("refuses a patch that leaves unapplied the other resources the recorded definition asks for, naming how to apply them", async () => {
      const { service } = setup({ flag: true, enabledOnChain: true });

      await expect(service.planFor(planInput({ submitted: [groupSpec({ cpu: "2000" })], mayResize: false }))).rejects.toMatchObject({
        status: 422,
        errorCode: "deployment_resources_unapplied",
        message:
          'The definition recorded for this deployment asks group "dcloud" for other resources than it holds, as a resize that did not go through leaves it. Re-apply it with a patch that changes nothing, or name the resources this patch sets'
      });
    });

    it("refuses unapplied resources as a new deployment's where resizing is unavailable", async () => {
      const { service } = setup({ flag: false });

      await expect(service.planFor(planInput({ submitted: [groupSpec({ cpu: "2000" })], mayResize: false }))).rejects.toMatchObject({
        status: 422,
        errorCode: "deployment_resources_changed"
      });
    });

    it("refuses a change of resources as a new deployment's when resizing is unavailable", async () => {
      const { service, chainSdk } = setup({ flag: false, pending: pendingResize() });

      await expect(service.planFor(planInput({ submitted: [groupSpec({ cpu: "2000" })] }))).rejects.toMatchObject({
        status: 422,
        errorCode: "deployment_resources_changed",
        message: expect.stringContaining('group "dcloud"')
      });
      expect(chainSdk.akash.market.v1beta5.getLeaseResizes).not.toHaveBeenCalled();
    });

    it("refuses a patch that adds a group as a new deployment's even when resizing is available", async () => {
      const { service } = setup({ flag: true, enabledOnChain: true });

      await expect(service.planFor(planInput({ submitted: [groupSpec(), groupSpec({ name: "westcoast" })] }))).rejects.toMatchObject({
        status: 422,
        errorCode: "deployment_resources_changed",
        message: expect.stringContaining('group "westcoast"')
      });
    });

    it("refuses a patch that changes two groups at once", async () => {
      const { service } = setup({ flag: true, enabledOnChain: true });
      const groups = [onChainGroup(), onChainGroup({ name: "westcoast", gseq: 2 })];

      await expect(
        service.planFor(planInput({ submitted: [groupSpec({ cpu: "2000" }), groupSpec({ name: "westcoast", cpu: "2000" })], groups }))
      ).rejects.toMatchObject({
        status: 422,
        errorCode: "deployment_resize_several_groups",
        message: 'The SDL changes the resources of groups "dcloud" and "westcoast". Resize one group at a time'
      });
    });

    it("refuses a change no running lease can be resized to, naming why", async () => {
      const { service } = setup({ flag: true, enabledOnChain: true });

      await expect(service.planFor(planInput({ submitted: [groupSpec({ gpu: "1" })] }))).rejects.toMatchObject({
        status: 422,
        errorCode: "deployment_resize_refused",
        message:
          'The SDL changes group "dcloud" in a way a running lease cannot be resized to: it adds or removes GPUs. Create a new deployment for this SDL instead'
      });
    });

    it.each([
      {
        change: "a change of two groups",
        submitted: () => [groupSpec({ cpu: "2000" }), groupSpec({ name: "westcoast", cpu: "2000" })],
        groups: () => [onChainGroup(), onChainGroup({ name: "westcoast", gseq: 2 })],
        group: "dcloud"
      },
      { change: "an unresizable change", submitted: () => [groupSpec({ gpu: "1" })], groups: () => [onChainGroup()], group: "dcloud" }
    ])("refuses $change as a new deployment's when resizing is unavailable", async ({ submitted, groups, group }) => {
      const { service } = setup({ flag: false });

      await expect(service.planFor(planInput({ submitted: submitted(), groups: groups() }))).rejects.toMatchObject({
        status: 422,
        errorCode: "deployment_resources_changed",
        message: expect.stringContaining(`group "${group}"`)
      });
    });
  });

  describe("request", () => {
    it("asks the provider of the group's active lease for the planned resources, carrying the saved version", async () => {
      const { service, signerService } = setup();
      const wallet = createInitializedUserWallet({ address: OWNER });
      const resized = groupSpec({ cpu: "2000" });
      const order: string[] = [];
      signerService.executeDecodedTxByUserWallet.mockImplementation(async () => {
        order.push("sign");
        return { code: 0, hash: "hash", transactionHash: "hash", rawLog: "" };
      });

      await service.request({
        wallet,
        deployment: deploymentWithLeases(),
        plan: { gseq: 1, groupName: "dcloud", resources: resized.resources },
        manifestVersion: VERSION,
        actingUserId: "user-1",
        assertMayStillSign: async () => {
          order.push("assert");
        }
      });

      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(
        wallet,
        [
          new RpcMessageService(mockConfigService<BillingConfigService>({ DEPLOYMENT_GRANT_DENOM: "uact" })).getResizeLeaseMsg({
            lease: { owner: OWNER, dseq: DSEQ, gseq: 1, oseq: 1, provider: "akash1provider", bseq: 0 },
            resources: resized.resources,
            hash: VERSION
          })
        ],
        { actingUserId: "user-1" }
      );
      expect(order).toEqual(["assert", "sign"]);
    });

    it("sends nothing when the deployment already holds the request the saved version makes", async () => {
      const { service, signerService } = setup({ pending: pendingResize() });

      await service.request({
        wallet: createInitializedUserWallet({ address: OWNER }),
        deployment: deploymentWithLeases(),
        plan: { gseq: 1, groupName: "dcloud", resources: groupSpec({ cpu: "2000" }).resources },
        manifestVersion: VERSION,
        actingUserId: "user-1"
      });

      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });

    it("asks again when the deployment holds a request another version made", async () => {
      const { service, signerService } = setup({ pending: pendingResize({ hash: new Uint8Array([9]) }) });

      await service.request({
        wallet: createInitializedUserWallet({ address: OWNER }),
        deployment: deploymentWithLeases(),
        plan: { gseq: 1, groupName: "dcloud", resources: groupSpec({ cpu: "2000" }).resources },
        manifestVersion: VERSION,
        actingUserId: "user-1"
      });

      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledTimes(1);
    });

    it("asks for a volume's growth carrying no manifest version, which the chain refuses on a volume", async () => {
      const { service, signerService } = setup();
      const wallet = createInitializedUserWallet({ address: OWNER });
      const grown = volumeGroupSpec(2n * GI);

      await service.request({
        wallet,
        deployment: deploymentWithLeases(),
        plan: { gseq: 1, groupName: "data", resources: grown.resources, volumeSize: 2n * GI },
        manifestVersion: VERSION,
        actingUserId: "user-1"
      });

      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(
        wallet,
        [
          new RpcMessageService(mockConfigService<BillingConfigService>({ DEPLOYMENT_GRANT_DENOM: "uact" })).getResizeLeaseMsg({
            lease: { owner: OWNER, dseq: DSEQ, gseq: 1, oseq: 1, provider: "akash1provider", bseq: 0 },
            resources: grown.resources,
            hash: new Uint8Array()
          })
        ],
        { actingUserId: "user-1" }
      );
    });

    it("sends nothing when the deployment already holds the request for the volume's size", async () => {
      const { service, signerService } = setup({ pending: pendingResize({ hash: new Uint8Array(), resources: volumeGroupSpec(2n * GI).resources }) });

      await service.request({
        wallet: createInitializedUserWallet({ address: OWNER }),
        deployment: deploymentWithLeases(),
        plan: { gseq: 1, groupName: "data", resources: volumeGroupSpec(2n * GI).resources, volumeSize: 2n * GI },
        manifestVersion: VERSION,
        actingUserId: "user-1"
      });

      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });

    it("asks again when the pending request asks the volume for another size", async () => {
      const { service, signerService } = setup({ pending: pendingResize({ hash: new Uint8Array(), resources: volumeGroupSpec(3n * GI).resources }) });

      await service.request({
        wallet: createInitializedUserWallet({ address: OWNER }),
        deployment: deploymentWithLeases(),
        plan: { gseq: 1, groupName: "data", resources: volumeGroupSpec(2n * GI).resources, volumeSize: 2n * GI },
        manifestVersion: VERSION,
        actingUserId: "user-1"
      });

      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledTimes(1);
    });

    it("refuses with 409 a group with no active lease", async () => {
      const { service, signerService } = setup();

      await expect(
        service.request({
          wallet: createInitializedUserWallet({ address: OWNER }),
          deployment: deploymentWithLeases({ state: "closed" }),
          plan: { gseq: 1, groupName: "dcloud", resources: groupSpec({ cpu: "2000" }).resources },
          manifestVersion: VERSION,
          actingUserId: "user-1"
        })
      ).rejects.toMatchObject({ status: 409, errorCode: "deployment_resize_no_active_lease", message: 'Group "dcloud" has no active lease to resize' });
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });
  });

  describe("outcomeOf", () => {
    const NOW = new Date("2026-10-26T12:00:00Z");

    it("is pending while the request carrying the version waits for its provider, without reading the deployment", async () => {
      const { service, deploymentHttpService } = setup({ pending: pendingResize({ expiresAt: NOW.getTime() / 1000 + 60 }) });

      expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64 }, NOW)).toBe("pending");
      expect(deploymentHttpService.findByOwnerAndDseq).not.toHaveBeenCalled();
    });

    it("is expired once the request outlives its ttl unanswered", async () => {
      const { service } = setup({ pending: pendingResize({ expiresAt: NOW.getTime() / 1000 }) });

      expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64 }, NOW)).toBe("expired");
    });

    it("is accepted once the deployment runs the version and the request is gone", async () => {
      const { service, deploymentHttpService } = setup({ chainHash: VERSION_BASE64 });

      expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64 }, NOW)).toBe("accepted");
      expect(deploymentHttpService.findByOwnerAndDseq).toHaveBeenCalledWith(OWNER, DSEQ);
    });

    it("is declined once the request is gone and the deployment runs another version", async () => {
      const { service } = setup({ chainHash: "T0xE" });

      expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64 }, NOW)).toBe("declined");
    });

    it("is declined when another request replaced the one carrying the version", async () => {
      const { service } = setup({ pending: pendingResize({ hash: new Uint8Array([9]) }), chainHash: "T0xE" });

      expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64 }, NOW)).toBe("declined");
    });

    describe("of a volume, whose size is no part of the version", () => {
      const VOLUME = { gseq: 1, size: (2n * GI).toString() };

      it("is pending while the request for the volume's size waits for its provider", async () => {
        const { service } = setup({
          pending: pendingResize({ hash: new Uint8Array(), resources: volumeGroupSpec(2n * GI).resources, expiresAt: NOW.getTime() / 1000 + 60 })
        });

        expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64, volume: VOLUME }, NOW)).toBe("pending");
      });

      it("is accepted once the volume's group holds the size, though the deployment keeps its version", async () => {
        const { service } = setup({ chainHash: "T0xE", chainVolumeSize: VOLUME.size });

        expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64, volume: VOLUME }, NOW)).toBe("accepted");
      });

      it("is declined once the request is gone and the volume's group keeps its size, though the deployment runs the version", async () => {
        const { service } = setup({ chainHash: VERSION_BASE64, chainVolumeSize: GI.toString() });

        expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64, volume: VOLUME }, NOW)).toBe("declined");
      });

      it("is not pending on a request for another group's volume, however large", async () => {
        const { service } = setup({
          pending: pendingResize({ hash: new Uint8Array(), resources: volumeGroupSpec(2n * GI).resources, gseq: 2 }),
          chainVolumeSize: GI.toString()
        });

        expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64, volume: VOLUME }, NOW)).toBe("declined");
      });

      it("is declined when the deployment no longer has the volume's group", async () => {
        const { service } = setup({ chainHash: VERSION_BASE64, chainVolumeSize: VOLUME.size });

        expect(await service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64, volume: { ...VOLUME, gseq: 2 } }, NOW)).toBe("declined");
      });
    });

    it("throws when the chain cannot describe the deployment, so the check runs again", async () => {
      const { service, deploymentHttpService } = setup();
      deploymentHttpService.findByOwnerAndDseq.mockResolvedValue({ code: 5, message: "not found", details: [] });

      await expect(service.outcomeOf({ owner: OWNER, dseq: DSEQ, manifestVersion: VERSION_BASE64 }, NOW)).rejects.toThrow(
        "Deployment 1234 could not be read: not found"
      );
    });
  });

  describe("cancel", () => {
    it("withdraws the pending resize of the lease it names", async () => {
      const pending = pendingResize();
      const { service, signerService } = setup({ pending });
      const wallet = createInitializedUserWallet({ address: OWNER });

      await service.cancel({ wallet, dseq: DSEQ, actingUserId: "user-1" });

      expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(
        wallet,
        [new RpcMessageService(mockConfigService<BillingConfigService>({ DEPLOYMENT_GRANT_DENOM: "uact" })).getCancelLeaseResizeMsg(pending.leaseId!)],
        { actingUserId: "user-1" }
      );
    });

    it("answers 404 when nothing is pending", async () => {
      const { service, signerService } = setup();

      await expect(service.cancel({ wallet: createInitializedUserWallet({ address: OWNER }), dseq: DSEQ, actingUserId: "user-1" })).rejects.toMatchObject({
        status: 404,
        message: "This deployment has no resize waiting for its provider"
      });
      expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
    });
  });

  function pendingResize({
    hash = VERSION,
    expiresAt = 4_000_000_000,
    resources = [],
    gseq = 1
  }: { hash?: Uint8Array; expiresAt?: number; resources?: ResourceUnit[]; gseq?: number } = {}) {
    return LeaseResize.fromPartial({
      leaseId: { owner: OWNER, dseq: 1234n, gseq, oseq: 1, provider: "akash1provider", bseq: 0 },
      resources,
      hash,
      expiresAt: BigInt(expiresAt)
    });
  }

  function onChainVolumeGroup(size: string) {
    const group = onChainGroup({ name: "data" });
    group.group_spec.resources[0].resource.storage = [{ name: "data", quantity: { val: size }, attributes: [{ key: "persistent", value: "true" }] }];

    return group;
  }

  function volumeGroupSpec(size: bigint) {
    return GroupSpec.fromPartial({ ...GroupSpec.fromJSON(onChainVolumeGroup(size.toString()).group_spec), volume: { vid: "data" } });
  }

  function onChainGroup({ name = "dcloud", gseq = 1, cpu = "1000", gpu = "0" }: { name?: string; gseq?: number; cpu?: string; gpu?: string } = {}) {
    const group = createDeploymentInfoGroupSeed({ owner: OWNER, dseq: DSEQ, gseq, name, cpuUnits: cpu });
    group.group_spec.resources[0].resource.gpu.units.val = gpu;
    group.group_spec.resources[0].price = { denom: "uact", amount: "1000" };

    return group;
  }

  function groupSpec(input: { name?: string; cpu?: string; gpu?: string } = {}) {
    return GroupSpec.fromJSON(onChainGroup(input).group_spec);
  }

  function planInput(input: { submitted: GroupSpec[]; groups?: ReturnType<typeof onChainGroup>[] | null; mayResize?: boolean }) {
    return {
      userId: "user-1",
      owner: OWNER,
      dseq: DSEQ,
      submitted: input.submitted,
      groups: input.groups === undefined ? [onChainGroup()] : input.groups,
      mayResize: input.mayResize ?? true
    };
  }

  function deploymentWithLeases({ state = "active" }: { state?: string } = {}): DeploymentResponse {
    const info = createDeploymentInfoSeed({ owner: OWNER, dseq: DSEQ });

    return {
      deployment: info.deployment,
      escrow_account: info.escrow_account,
      leases: [
        mock<DeploymentResponse["leases"][number]>({ id: { owner: OWNER, dseq: DSEQ, gseq: 2, oseq: 1, provider: "akash1other", bseq: 0 }, state: "active" }),
        mock<DeploymentResponse["leases"][number]>({ id: { owner: OWNER, dseq: DSEQ, gseq: 1, oseq: 1, provider: "akash1provider", bseq: 0 }, state })
      ]
    };
  }

  function setup(input: { flag?: boolean; enabledOnChain?: boolean; pending?: LeaseResize; chainHash?: string; chainVolumeSize?: string } = {}) {
    const chainSdk = mockDeep<ChainSDK>();
    chainSdk.akash.market.v1beta5.getParams.mockResolvedValue({ params: { leaseResizeEnabled: input.enabledOnChain ?? false } } as never);
    chainSdk.akash.market.v1beta5.getLeaseResizes.mockResolvedValue({ leaseResizes: input.pending ? [input.pending] : [], pagination: undefined });
    const featureFlagsService = mock<FeatureFlagsService>();
    featureFlagsService.isEnabled.mockReturnValue(input.flag ?? false);
    const deploymentHttpService = mock<DeploymentHttpService>();
    deploymentHttpService.findByOwnerAndDseq.mockResolvedValue({
      ...createDeploymentInfoSeed({ owner: OWNER, dseq: DSEQ }),
      deployment: { ...createDeploymentInfoSeed({ owner: OWNER, dseq: DSEQ }).deployment, hash: input.chainHash ?? "T0xE" },
      ...(input.chainVolumeSize && { groups: [onChainVolumeGroup(input.chainVolumeSize)] })
    });
    const signerService = mock<ManagedSignerService>();
    const service = new LeaseResizeService(
      chainSdk,
      featureFlagsService,
      deploymentHttpService,
      new RpcMessageService(mockConfigService<BillingConfigService>({ DEPLOYMENT_GRANT_DENOM: "uact" })),
      signerService
    );

    return { service, chainSdk, featureFlagsService, deploymentHttpService, signerService };
  }
});
