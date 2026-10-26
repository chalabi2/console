import { type EnqueueOptions, type Job, JOB_NAME } from "@src/core";

/** Waits for the provider to answer the lease resize an update asked for, then pushes the update's manifest, or records why the deployment keeps its resources. */
export class AwaitLeaseResize implements Job {
  static readonly [JOB_NAME] = "AwaitLeaseResize";
  readonly name = AwaitLeaseResize[JOB_NAME];
  readonly version = 1;

  constructor(
    public readonly data: {
      /** The member who saved the update, whose feed reports it. */
      userId: string;
      owner: string;
      dseq: string;
      /** The saved version the resize carries, which the deployment runs once the provider accepts. */
      manifestVersion: string;
      walletId: number;
      /** Absent for a deployment filed before organizations, whose row only its user reaches. */
      organizationId?: string;
      activityId: string;
    }
  ) {}
}

export function awaitLeaseResizeKeyFor(activityId: string): string {
  return `awaitLeaseResize.${activityId}`;
}

/** Checks every 10 s for half an hour, which outlasts the ten minutes the chain gives a provider to answer by default. */
export const AWAIT_LEASE_RESIZE_RETRY_OPTIONS = {
  retryLimit: 180,
  retryDelay: 10,
  retryBackoff: false
} satisfies EnqueueOptions;
