import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";

import type { WalletInitialized } from "@src/billing/repositories";
import type { WalletReaderService } from "@src/billing/services/wallet-reader/wallet-reader.service";
import type { JobQueueService } from "@src/core";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import type { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";
import { FinishVolumeClose } from "@src/deployment/services/finish-volume-close/finish-volume-close.job";
import type { OnChainGroupSpec } from "@src/deployment/utils/changed-group-resources/changed-group-resources";
import { ManagedDeploymentClosedHandler } from "./managed-deployment-closed.handler";

describe(ManagedDeploymentClosedHandler.name, () => {
  const PAYLOAD = { walletId: 7, dseq: "100", version: 1 as const };
  const DEADLINE_IN_SEC = 1_793_116_720;

  it("keeps one follow-up per closed deployment", () => {
    const { handler } = setup();

    expect(handler.policy).toBe("exclusive");
  });

  it("asks only for the right to sign with the wallet that closed the deployment", () => {
    const { handler } = setup();

    expect(handler.requiresPermission(PAYLOAD)).toEqual([{ action: "sign", subject: "UserWallet", conditions: { id: 7 } }]);
  });

  it("schedules the close that ends a volume's close for just after its reclamation window", async () => {
    const { handler, walletReaderService, jobQueueService } = setup();

    await handler.handle(PAYLOAD);

    expect(walletReaderService.getWalletById).toHaveBeenCalledWith(7);
    expect(jobQueueService.enqueue).toHaveBeenCalledWith(new FinishVolumeClose({ walletId: 7, dseq: "100" }), {
      singletonKey: "finishVolumeClose.7.100",
      startAfter: new Date((DEADLINE_IN_SEC + 10) * 1000).toISOString(),
      retryLimit: 12,
      retryBackoff: true,
      retryDelay: 30,
      retryDelayMax: 300
    });
  });

  it.each([
    { case: "runs a workload, whose close finishes at once", input: { isVolume: false } },
    { case: "is described by the database fallback, which knows no group specs", input: { groupSpecs: null } },
    { case: "the chain already closed", input: { onChain: "closed" as const } }
  ])("schedules nothing for a deployment that $case", async ({ input }) => {
    const { handler, jobQueueService } = setup(input);

    await handler.handle(PAYLOAD);

    expect(jobQueueService.enqueue).not.toHaveBeenCalled();
  });

  it("reads the volume again while its lease has yet to show the reclamation its close started", async () => {
    const { handler, jobQueueService } = setup({ leaseState: "active" });

    await expect(handler.handle(PAYLOAD)).rejects.toThrow("The close of volume deployment 100 has yet to show a reclaiming lease");

    expect(jobQueueService.enqueue).not.toHaveBeenCalled();
  });

  function setup(input: { isVolume?: boolean; groupSpecs?: null; onChain?: "active" | "closed"; leaseState?: string } = {}) {
    const wallet = mock<WalletInitialized>({ id: 7, address: "akash1owner" });
    const walletReaderService = mock<WalletReaderService>();
    walletReaderService.getWalletById.mockResolvedValue(wallet);
    const groupSpec = { name: "global", volume: input.isVolume === false ? null : { vid: "data" } } as OnChainGroupSpec;
    const leaseState = input.leaseState ?? "reclaiming";
    const lease = {
      state: leaseState,
      reclamation: leaseState === "reclaiming" ? { deadline: String(DEADLINE_IN_SEC) } : undefined
    } as DeploymentResponse["leases"][number];
    const deploymentReaderService = mock<DeploymentReaderService>();
    deploymentReaderService.findWithGroupSpecsByWalletAndDseq.mockResolvedValue({
      deployment: mock<DeploymentResponse>({ deployment: { state: input.onChain ?? "active", id: { owner: "akash1owner", dseq: "100" } }, leases: [lease] }),
      groupSpecs: input.groupSpecs === null ? null : [groupSpec],
      groups: null
    });
    const jobQueueService = mock<JobQueueService>();
    const handler = new ManagedDeploymentClosedHandler(walletReaderService, deploymentReaderService, jobQueueService);

    return { handler, walletReaderService, jobQueueService };
  }
});
