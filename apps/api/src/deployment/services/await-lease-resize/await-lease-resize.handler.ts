import { singleton } from "tsyringe";

import { ActivityService } from "@src/activity/services/activity/activity.service";
import { AuthService } from "@src/auth/services/auth.service";
import type { JobHandler, JobMeta, JobPayload, JobPermissions } from "@src/core";
import { DeploymentWriterService } from "@src/deployment/services/deployment-writer/deployment-writer.service";
import { LeaseResizeService } from "@src/deployment/services/lease-resize/lease-resize.service";
import { MemberDeploymentAccessService } from "@src/deployment/services/member-deployment-access/member-deployment-access.service";
import { failedUpdateActivityOf, unansweredResizeActivityOf, updatedActivityOf } from "@src/deployment/utils/update-activity/update-activity";
import { AwaitLeaseResize } from "./await-lease-resize.job";

/** Thrown to be asked again, because pg-boss retries a job that throws after its retry delay. */
class LeaseResizeStillPending extends Error {
  constructor(dseq: string) {
    super(`The lease resize of deployment ${dseq} is still waiting for its provider`);
  }
}

@singleton()
export class AwaitLeaseResizeHandler implements JobHandler<AwaitLeaseResize> {
  public readonly accepts = AwaitLeaseResize;

  /** One waiting job per update, so an apply retried after it queued one queues no second. */
  public readonly policy = "short";

  constructor(
    private readonly leaseResizeService: LeaseResizeService,
    private readonly deploymentWriterService: DeploymentWriterService,
    private readonly activityService: ActivityService,
    private readonly authService: AuthService,
    private readonly memberDeploymentAccessService: MemberDeploymentAccessService
  ) {}

  /** An organization's deployment may be filed under another member, so its row is reached through the organization rather than the member who saved the update. */
  requiresPermission({ userId, walletId, organizationId }: JobPayload<AwaitLeaseResize>): JobPermissions {
    return [
      { action: "sign", subject: "UserWallet", conditions: { id: walletId } },
      { action: "read", subject: "DeploymentSetting", conditions: organizationId === undefined ? { userId } : { organizationId } }
    ];
  }

  async handle({ userId, owner, dseq, manifestVersion, walletId, activityId }: JobPayload<AwaitLeaseResize>, job?: JobMeta): Promise<void> {
    if (!(await this.activityService.isPending(activityId))) return;

    const update = { userId, dseq, manifestVersion };
    const outcome = await this.leaseResizeService.outcomeOf({ owner, dseq, manifestVersion });

    if (outcome === "accepted") return await this.#pushTheResizedManifest({ ...update, walletId, activityId }, job);

    if (outcome === "pending" && !isLastAttempt(job)) throw new LeaseResizeStillPending(dseq);

    await this.activityService.settle(activityId, unansweredResizeActivityOf(update, outcome === "declined" ? "declined" : "expired"));
  }

  /** The accept already set the version the update saved, so applying the update now sends no deployment update and only pushes its manifest. */
  async #pushTheResizedManifest(
    { walletId, activityId, ...update }: { userId: string; dseq: string; manifestVersion: string; walletId: number; activityId: string },
    job?: JobMeta
  ): Promise<void> {
    try {
      await this.deploymentWriterService.applySavedPatch({ ...update, walletId }, this.authService.ability, {
        assertMayStillSign: () => this.memberDeploymentAccessService.assertMayStillSign({ userId: update.userId, walletId, dseq: update.dseq })
      });
    } catch (error) {
      if (isLastAttempt(job)) await this.activityService.settle(activityId, failedUpdateActivityOf(update, error));

      throw error;
    }

    await this.activityService.settle(activityId, updatedActivityOf(update));
  }
}

function isLastAttempt(job?: JobMeta): boolean {
  return !job || job.retryCount >= job.retryLimit;
}
