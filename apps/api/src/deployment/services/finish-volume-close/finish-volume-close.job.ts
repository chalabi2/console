import { addSeconds } from "date-fns";

import { type EnqueueOptions, type Job, JOB_NAME } from "@src/core";

/** Sends the close that ends a volume's close, which the chain finishes only on a close sent once the reclamation window the first one started has passed. */
export class FinishVolumeClose implements Job {
  static readonly [JOB_NAME] = "FinishVolumeClose";
  readonly name = FinishVolumeClose[JOB_NAME];
  readonly version = 1;

  constructor(
    public readonly data: {
      walletId: number;
      dseq: string;
    }
  ) {}
}

/** The chain compares the deadline with block time, which trails the wall clock by up to a block. */
const BLOCK_TIME_LAG_IN_SEC = 10;

/** Twelve retries backing off from 30 s to a 5 min cap keep closing through a node outage for about 50 minutes. */
const FINISH_VOLUME_CLOSE_RETRY_OPTIONS = {
  retryLimit: 12,
  retryBackoff: true,
  retryDelay: 30,
  retryDelayMax: 5 * 60
} satisfies EnqueueOptions;

export function finishVolumeCloseOptionsFor({ walletId, dseq, deadline }: { walletId: number; dseq: string; deadline: Date }): EnqueueOptions {
  return {
    singletonKey: `finishVolumeClose.${walletId}.${dseq}`,
    startAfter: addSeconds(deadline, BLOCK_TIME_LAG_IN_SEC).toISOString(),
    ...FINISH_VOLUME_CLOSE_RETRY_OPTIONS
  };
}
