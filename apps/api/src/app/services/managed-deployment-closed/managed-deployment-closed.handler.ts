import { singleton } from "tsyringe";

import { ManagedDeploymentClosed } from "@src/billing/events/managed-deployment-closed";
import { WalletReaderService } from "@src/billing/services/wallet-reader/wallet-reader.service";
import { type EventPayload, type JobHandler, type JobPermissions, JobQueueService } from "@src/core";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";
import { FinishVolumeClose, finishVolumeCloseOptionsFor } from "@src/deployment/services/finish-volume-close/finish-volume-close.job";

/** Thrown to read the deployment again, because pg-boss retries a job that throws after its retry delay. */
class VolumeReclamationNotYetRead extends Error {
  constructor(dseq: string) {
    super(`The close of volume deployment ${dseq} has yet to show a reclaiming lease`);
  }
}

@singleton()
export class ManagedDeploymentClosedHandler implements JobHandler<ManagedDeploymentClosed> {
  public readonly accepts = ManagedDeploymentClosed;

  /** Gives the per-deployment key its meaning, so a close followed up twice schedules its finish once; a `standard` queue ignores the key. */
  public readonly policy = "exclusive";

  constructor(
    private readonly walletReaderService: WalletReaderService,
    private readonly deploymentReaderService: DeploymentReaderService,
    private readonly jobQueueService: JobQueueService
  ) {}

  requiresPermission({ walletId }: EventPayload<ManagedDeploymentClosed>): JobPermissions {
    return [{ action: "sign", subject: "UserWallet", conditions: { id: walletId } }];
  }

  /** A volume's close only starts its lease's reclamation window, and the chain finishes it on a close sent once the window has passed. */
  async handle({ walletId, dseq }: EventPayload<ManagedDeploymentClosed>): Promise<void> {
    const wallet = await this.walletReaderService.getWalletById(walletId);
    const { deployment, groupSpecs } = await this.deploymentReaderService.findWithGroupSpecsByWalletAndDseq(wallet, dseq);
    if (!groupSpecs?.some(spec => spec.volume) || deployment.deployment.state === "closed") return;

    const deadline = reclamationDeadlineOf(deployment.leases);
    if (!deadline) throw new VolumeReclamationNotYetRead(dseq);

    await this.jobQueueService.enqueue(new FinishVolumeClose({ walletId, dseq }), finishVolumeCloseOptionsFor({ walletId, dseq, deadline }));
  }
}

function reclamationDeadlineOf(leases: DeploymentResponse["leases"]): Date | undefined {
  const deadline = leases.find(lease => lease.state === "reclaiming")?.reclamation?.deadline;
  return deadline ? new Date(Number(deadline) * 1000) : undefined;
}
