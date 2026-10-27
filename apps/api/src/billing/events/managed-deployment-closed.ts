import type { DomainEvent } from "@src/core/services/domain-events/domain-events.service";
import { DOMAIN_EVENT_NAME } from "@src/core/services/domain-events/domain-events.service";

/** Every close the console signs, whether a member asked for it or the console closed the deployment on its own. */
export class ManagedDeploymentClosed implements DomainEvent {
  static readonly [DOMAIN_EVENT_NAME] = "ManagedDeploymentClosed";

  public readonly name = ManagedDeploymentClosed[DOMAIN_EVENT_NAME];
  public readonly version = 1;

  constructor(
    public readonly data: {
      walletId: number;
      dseq: string;
    }
  ) {}
}
