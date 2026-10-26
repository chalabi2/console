import "@src/app/providers/jobs.provider";

import { container } from "tsyringe";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityRepository } from "@src/activity/repositories/activity/activity.repository";
import { JOB_NAME } from "@src/core";
import { DeploymentWriterService } from "@src/deployment/services/deployment-writer/deployment-writer.service";
import { type LeaseResizeOutcome, LeaseResizeService } from "@src/deployment/services/lease-resize/lease-resize.service";
import { AwaitLeaseResizeHandler } from "./await-lease-resize.handler";
import { AwaitLeaseResize, awaitLeaseResizeKeyFor } from "./await-lease-resize.job";

import { createDseq } from "@test/seeders/db/deployment-setting.seeder";
import { seedUserWithWallet } from "@test/seeders/db/user-with-wallet.seeder";
import { expectJobCompleted, findJobRows, useJobWorkers } from "@test/services/job-queue-harness";

const SAVED_VERSION = "U0FWRUQ=";

const jobWorkers = useJobWorkers(() => [container.resolve(AwaitLeaseResizeHandler)]);

describe(AwaitLeaseResizeHandler.name, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("pushes the resized manifest once the provider accepts and records the update as succeeded, run the way a worker runs it", async () => {
    const { waiting, awaitInBackground, applySavedPatch, findActivity } = await setup({ outcome: "accepted" });

    await awaitInBackground();

    await expectJobCompleted(AwaitLeaseResize[JOB_NAME], { singletonKey: awaitLeaseResizeKeyFor(waiting.activityId) });
    expect(applySavedPatch).toHaveBeenCalledWith(
      { userId: waiting.userId, dseq: waiting.dseq, manifestVersion: SAVED_VERSION, walletId: waiting.walletId },
      expect.anything(),
      { assertMayStillSign: expect.any(Function) }
    );
    expect(await findActivity(waiting.activityId)).toMatchObject({ status: "succeeded", meta: { dseq: waiting.dseq, manifestVersion: SAVED_VERSION } });
  });

  it("records the update as failed when the provider declines the resize", async () => {
    const { waiting, awaitInBackground, applySavedPatch, findActivity } = await setup({ outcome: "declined" });

    await awaitInBackground();

    await expectJobCompleted(AwaitLeaseResize[JOB_NAME], { singletonKey: awaitLeaseResizeKeyFor(waiting.activityId) });
    expect(applySavedPatch).not.toHaveBeenCalled();
    expect(await findActivity(waiting.activityId)).toMatchObject({ status: "failed", meta: { error: { code: "resize_declined" } } });
  });

  it("keeps the update pending and asks again while the provider has yet to answer", async () => {
    const { waiting, awaitInBackground, findActivity } = await setup({ outcome: "pending" });

    await awaitInBackground();

    await vi.waitFor(
      async () => {
        const [row] = await findJobRows(AwaitLeaseResize[JOB_NAME], { singletonKey: awaitLeaseResizeKeyFor(waiting.activityId) });
        expect(row?.state).toBe("retry");
      },
      { timeout: 15_000, interval: 100 }
    );
    expect(await findActivity(waiting.activityId)).toMatchObject({ status: "pending" });
  });

  async function setup(input: { outcome: LeaseResizeOutcome }) {
    const { enqueue, startWorkers } = await jobWorkers();
    const activityRepository = container.resolve(ActivityRepository);
    const { user, wallet } = await seedUserWithWallet();
    const dseq = createDseq();
    const activity = await activityRepository.create({
      userId: user.id,
      type: "deployment_update",
      status: "pending",
      meta: { dseq, manifestVersion: SAVED_VERSION }
    });

    vi.spyOn(container.resolve(LeaseResizeService), "outcomeOf").mockResolvedValue(input.outcome);
    const applySavedPatch = vi.spyOn(container.resolve(DeploymentWriterService), "applySavedPatch").mockResolvedValue("applied");

    const waiting: AwaitLeaseResize["data"] = {
      userId: user.id,
      owner: wallet.address as string,
      dseq,
      manifestVersion: SAVED_VERSION,
      walletId: wallet.id,
      activityId: activity.id
    };

    return {
      waiting,
      applySavedPatch,
      awaitInBackground: async () => {
        await enqueue(new AwaitLeaseResize(waiting), {
          singletonKey: awaitLeaseResizeKeyFor(waiting.activityId),
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: false
        });
        await startWorkers();
      },
      findActivity: async (id: string) => await activityRepository.findById(id)
    };
  }
});
