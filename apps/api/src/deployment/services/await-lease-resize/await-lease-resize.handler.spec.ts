import type { Ability } from "@casl/ability";
import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";

import type { ActivityService } from "@src/activity/services/activity/activity.service";
import type { AuthService } from "@src/auth/services/auth.service";
import type { DeploymentWriterService } from "@src/deployment/services/deployment-writer/deployment-writer.service";
import type { LeaseResizeOutcome, LeaseResizeService } from "@src/deployment/services/lease-resize/lease-resize.service";
import type { MemberDeploymentAccessService } from "@src/deployment/services/member-deployment-access/member-deployment-access.service";
import { failedUpdateActivityOf, unansweredResizeActivityOf, updatedActivityOf } from "@src/deployment/utils/update-activity/update-activity";
import { AwaitLeaseResizeHandler } from "./await-lease-resize.handler";

describe(AwaitLeaseResizeHandler.name, () => {
  const UPDATE = { userId: "user-1", dseq: "100", manifestVersion: "U0FWRUQ=" };
  const PAYLOAD = { ...UPDATE, owner: "akash1owner", walletId: 7, organizationId: "organization-1", activityId: "activity-1", version: 1 as const };
  const FIRST_ATTEMPT = { id: "job-1", retryCount: 0, retryLimit: 180 };
  const LAST_ATTEMPT = { id: "job-1", retryCount: 180, retryLimit: 180 };

  it("keeps one waiting job per update", () => {
    const { handler } = setup();

    expect(handler.policy).toBe("short");
  });

  it("asks for the right to sign with the update's wallet and to read the definitions of the deployment's organization", () => {
    const { handler } = setup();

    expect(handler.requiresPermission(PAYLOAD)).toEqual([
      { action: "sign", subject: "UserWallet", conditions: { id: 7 } },
      { action: "read", subject: "DeploymentSetting", conditions: { organizationId: "organization-1" } }
    ]);
  });

  it("reads only the user's own definitions for a deployment filed before organizations", () => {
    const { handler } = setup();
    const { organizationId: _organizationId, ...unfiledPayload } = PAYLOAD;

    expect(handler.requiresPermission(unfiledPayload)).toEqual([
      { action: "sign", subject: "UserWallet", conditions: { id: 7 } },
      { action: "read", subject: "DeploymentSetting", conditions: { userId: "user-1" } }
    ]);
  });

  it("does nothing once the update has an outcome", async () => {
    const { handler, leaseResizeService } = setup({ pending: false });

    await handler.handle(PAYLOAD, FIRST_ATTEMPT);

    expect(leaseResizeService.outcomeOf).not.toHaveBeenCalled();
  });

  it("asks again later while the provider has yet to answer", async () => {
    const { handler, leaseResizeService, activityService } = setup({ outcome: "pending" });

    await expect(handler.handle(PAYLOAD, FIRST_ATTEMPT)).rejects.toThrow("The lease resize of deployment 100 is still waiting for its provider");
    expect(leaseResizeService.outcomeOf).toHaveBeenCalledWith({ owner: "akash1owner", dseq: "100", manifestVersion: "U0FWRUQ=" });
    expect(activityService.settle).not.toHaveBeenCalled();
  });

  it("asks after a volume's resize by the group and size the update asked for", async () => {
    const { handler, leaseResizeService } = setup();
    const volume = { gseq: 1, size: "2147483648" };

    await expect(handler.handle({ ...PAYLOAD, volume }, FIRST_ATTEMPT)).rejects.toThrow("The lease resize of deployment 100 is still waiting for its provider");
    expect(leaseResizeService.outcomeOf).toHaveBeenCalledWith({ owner: "akash1owner", dseq: "100", manifestVersion: "U0FWRUQ=", volume });
  });

  it("records the resize as unanswered once it has waited as long as it may", async () => {
    const { handler, activityService } = setup({ outcome: "pending" });

    await handler.handle(PAYLOAD, LAST_ATTEMPT);

    expect(activityService.settle).toHaveBeenCalledWith("activity-1", unansweredResizeActivityOf(UPDATE, "expired"));
  });

  it.each(["declined", "expired"] as const)("records the update as failed when the resize is %s", async outcome => {
    const { handler, activityService, deploymentWriterService } = setup({ outcome });

    await handler.handle(PAYLOAD, FIRST_ATTEMPT);

    expect(activityService.settle).toHaveBeenCalledWith("activity-1", unansweredResizeActivityOf(UPDATE, outcome));
    expect(deploymentWriterService.applySavedPatch).not.toHaveBeenCalled();
  });

  it("pushes the resized manifest once the provider accepts, then records the update as succeeded", async () => {
    const { handler, activityService, deploymentWriterService, ability } = setup({ outcome: "accepted" });

    await handler.handle(PAYLOAD, FIRST_ATTEMPT);

    expect(deploymentWriterService.applySavedPatch).toHaveBeenCalledWith({ ...UPDATE, walletId: 7 }, ability, { assertMayStillSign: expect.any(Function) });
    expect(activityService.settle).toHaveBeenCalledWith("activity-1", updatedActivityOf(UPDATE));
  });

  it("has the writer check that the member who saved the update may still sign with its wallet", async () => {
    const { handler, deploymentWriterService, memberDeploymentAccessService } = setup({ outcome: "accepted" });

    await handler.handle(PAYLOAD, FIRST_ATTEMPT);
    const [[, , { assertMayStillSign }]] = deploymentWriterService.applySavedPatch.mock.calls as [
      [unknown, unknown, { assertMayStillSign: () => Promise<void> }]
    ];
    await assertMayStillSign();

    expect(memberDeploymentAccessService.assertMayStillSign).toHaveBeenCalledWith({ userId: "user-1", walletId: 7, dseq: "100" });
  });

  it("retries a push that failed, leaving the update pending", async () => {
    const { handler, activityService, deploymentWriterService } = setup({ outcome: "accepted" });
    deploymentWriterService.applySavedPatch.mockRejectedValue(new Error("provider unreachable"));

    await expect(handler.handle(PAYLOAD, FIRST_ATTEMPT)).rejects.toThrow("provider unreachable");
    expect(activityService.settle).not.toHaveBeenCalled();
  });

  it("records the update as failed when the last push fails", async () => {
    const { handler, activityService, deploymentWriterService } = setup({ outcome: "accepted" });
    const error = new Error("provider unreachable");
    deploymentWriterService.applySavedPatch.mockRejectedValue(error);

    await expect(handler.handle(PAYLOAD, LAST_ATTEMPT)).rejects.toThrow("provider unreachable");
    expect(activityService.settle).toHaveBeenCalledWith("activity-1", failedUpdateActivityOf(UPDATE, error));
  });

  function setup(input: { pending?: boolean; outcome?: LeaseResizeOutcome } = {}) {
    const leaseResizeService = mock<LeaseResizeService>();
    leaseResizeService.outcomeOf.mockResolvedValue(input.outcome ?? "pending");
    const deploymentWriterService = mock<DeploymentWriterService>();
    deploymentWriterService.applySavedPatch.mockResolvedValue("applied");
    const activityService = mock<ActivityService>();
    activityService.isPending.mockResolvedValue(input.pending ?? true);
    const ability = mock<Ability>();
    const authService = mock<AuthService>({ ability });
    const memberDeploymentAccessService = mock<MemberDeploymentAccessService>();
    memberDeploymentAccessService.assertMayStillSign.mockResolvedValue(undefined);

    const handler = new AwaitLeaseResizeHandler(leaseResizeService, deploymentWriterService, activityService, authService, memberDeploymentAccessService);

    return { handler, leaseResizeService, deploymentWriterService, activityService, ability, memberDeploymentAccessService };
  }
});
