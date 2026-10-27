import "@src/app/providers/jobs.provider";

import { faker } from "@faker-js/faker";
import { subMinutes } from "date-fns";
import { container } from "tsyringe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import { type EnqueueOptions, JOB_NAME } from "@src/core";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";
import { FinishVolumeCloseHandler } from "./finish-volume-close.handler";
import { FinishVolumeClose, finishVolumeCloseOptionsFor } from "./finish-volume-close.job";

import { seedUserWithWallet } from "@test/seeders/db/user-with-wallet.seeder";
import { expectJobCompleted, findJobRows, useJobWorkers } from "@test/services/job-queue-harness";

const jobWorkers = useJobWorkers(() => [container.resolve(FinishVolumeCloseHandler)]);

describe(FinishVolumeCloseHandler.name, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the close that ends a volume's close with the wallet that closed it, run the way a worker runs it", async () => {
    const { wallet, dseq, sign, finishInBackground, awaitCompleted } = await setup();

    await finishInBackground();

    await awaitCompleted();
    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({ id: wallet.id, address: wallet.address }),
      [expect.objectContaining({ value: expect.objectContaining({ id: { owner: wallet.address, dseq: BigInt(dseq) } }) })],
      { completesRecordedClose: true }
    );
  });

  it("sends nothing for a volume the chain already closed", async () => {
    const { sign, finishInBackground, awaitCompleted } = await setup({ onChain: "closed" });

    await finishInBackground();

    await awaitCompleted();
    expect(sign).not.toHaveBeenCalled();
  });

  it("sends the close again later while the chain refuses it ahead of the deadline", async () => {
    const { sign, finishInBackground, waitForJobInRetry } = await setup();
    sign.mockRejectedValue(new Error("reclamation window not elapsed"));

    await finishInBackground({ retryDelay: 3600 });

    await waitForJobInRetry();
  });

  async function setup(input: { onChain?: "active" | "closed" } = {}) {
    const { enqueue, startWorkers } = await jobWorkers();
    const { wallet, address } = await seedUserWithWallet();
    const dseq = faker.string.numeric(7);
    vi.spyOn(container.resolve(DeploymentReaderService), "findByWalletAndDseqWithoutProviderStatus").mockResolvedValue(
      mock<DeploymentResponse>({ deployment: { state: input.onChain ?? "active", id: { owner: address, dseq } } })
    );
    const sign = vi
      .spyOn(container.resolve(ManagedSignerService), "executeDecodedTxByUserWallet")
      .mockResolvedValue({ code: 0, hash: "TX-HASH", transactionHash: "TX-HASH", rawLog: "[]" });
    const options = finishVolumeCloseOptionsFor({ walletId: wallet.id, dseq, deadline: subMinutes(new Date(), 1) });

    return {
      wallet: { ...wallet, address },
      dseq,
      sign,
      awaitCompleted: () => expectJobCompleted(FinishVolumeClose[JOB_NAME], { singletonKey: options.singletonKey }),
      finishInBackground: async (retryOverrides: EnqueueOptions = {}) => {
        await enqueue(new FinishVolumeClose({ walletId: wallet.id, dseq }), { ...options, ...retryOverrides });
        await startWorkers();
      },
      waitForJobInRetry: async () =>
        await vi.waitFor(
          async () => {
            const [row] = await findJobRows(FinishVolumeClose[JOB_NAME], { singletonKey: options.singletonKey });
            expect(row?.state).toBe("retry");
          },
          { timeout: 15_000, interval: 100 }
        )
    };
  }
});
