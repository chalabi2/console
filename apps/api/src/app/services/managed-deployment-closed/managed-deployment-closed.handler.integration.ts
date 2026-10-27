import "@src/app/providers/jobs.provider";

import { faker } from "@faker-js/faker";
import { addHours, addSeconds, getUnixTime } from "date-fns";
import { container } from "tsyringe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import { ManagedDeploymentClosed } from "@src/billing/events/managed-deployment-closed";
import { JOB_NAME } from "@src/core";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";
import { FinishVolumeCloseHandler } from "@src/deployment/services/finish-volume-close/finish-volume-close.handler";
import { FinishVolumeClose } from "@src/deployment/services/finish-volume-close/finish-volume-close.job";
import type { OnChainGroupSpec } from "@src/deployment/utils/changed-group-resources/changed-group-resources";
import { ManagedDeploymentClosedHandler } from "./managed-deployment-closed.handler";

import { seedUserWithWallet } from "@test/seeders/db/user-with-wallet.seeder";
import { expectJobCompleted, findJobRows, useJobWorkers } from "@test/services/job-queue-harness";

const jobWorkers = useJobWorkers(() => [container.resolve(ManagedDeploymentClosedHandler), container.resolve(FinishVolumeCloseHandler)]);

describe(ManagedDeploymentClosedHandler.name, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("schedules the close that ends a volume's close for just after its reclamation window, run the way a worker runs it", async () => {
    const { walletId, dseq, deadline, followUpInBackground, awaitCompleted, findFinishes } = await setup({ isVolume: true });

    await followUpInBackground();

    await awaitCompleted();
    const [finish] = await findFinishes();
    expect(finish).toMatchObject({ state: "created", data: { walletId, dseq }, retry_limit: 12 });
    expect(new Date(finish.start_after)).toEqual(addSeconds(deadline, 10));
  });

  it("schedules nothing after closing a deployment that runs a workload, whose close finishes at once", async () => {
    const { followUpInBackground, awaitCompleted, findFinishes } = await setup({ isVolume: false });

    await followUpInBackground();

    await awaitCompleted();
    expect(await findFinishes()).toEqual([]);
  });

  async function setup(input: { isVolume: boolean }) {
    const { enqueue, startWorkers } = await jobWorkers();
    const { wallet, address } = await seedUserWithWallet();
    const dseq = faker.string.numeric(7);
    const deadline = new Date(getUnixTime(addHours(new Date(), 1)) * 1000);
    const lease = { state: "reclaiming", reclamation: { deadline: String(getUnixTime(deadline)) } } as DeploymentResponse["leases"][number];
    vi.spyOn(container.resolve(DeploymentReaderService), "findWithGroupSpecsByWalletAndDseq").mockResolvedValue({
      deployment: mock<DeploymentResponse>({ deployment: { state: "active", id: { owner: address, dseq } }, leases: [lease] }),
      groupSpecs: [{ name: "global", volume: input.isVolume ? { vid: "data" } : null } as OnChainGroupSpec],
      groups: null
    });
    const singletonKey = `${ManagedDeploymentClosed.name}.${dseq}.${wallet.id}`;

    return {
      walletId: wallet.id,
      dseq,
      deadline,
      awaitCompleted: () => expectJobCompleted(ManagedDeploymentClosed[JOB_NAME], { singletonKey }),
      findFinishes: () => findJobRows(FinishVolumeClose[JOB_NAME], { data: { dseq } }),
      followUpInBackground: async () => {
        await enqueue(new ManagedDeploymentClosed({ walletId: wallet.id, dseq }), { singletonKey });
        await startWorkers();
      }
    };
  }
});
