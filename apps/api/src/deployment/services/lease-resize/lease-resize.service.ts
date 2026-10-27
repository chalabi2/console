import { GroupSpec } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import type { LeaseResize } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { DeploymentHttpService, type DeploymentInfo } from "@akashnetwork/http-sdk";
import createError from "http-errors";
import { inject, singleton } from "tsyringe";

import type { UserWalletOutput } from "@src/billing/repositories";
import { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import { RpcMessageService } from "@src/billing/services/rpc-message-service/rpc-message.service";
import { CHAIN_SDK, type ChainSDK } from "@src/chain/providers/chain-sdk.provider";
import { FeatureFlags } from "@src/core/services/feature-flags/feature-flags";
import { FeatureFlagsService } from "@src/core/services/feature-flags/feature-flags.service";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import { type LeaseResizePlan, type ResourceChange, resourceChangeOf, volumeSizeOf } from "@src/deployment/utils/lease-resize-plan/lease-resize-plan";

/** Lets a client tell an SDL that needs a new deployment from one that is merely invalid. */
export const RESOURCES_CHANGED_ERROR_CODE = "deployment_resources_changed";

export const RESIZE_SEVERAL_GROUPS_ERROR_CODE = "deployment_resize_several_groups";

export const RESIZE_REFUSED_ERROR_CODE = "deployment_resize_refused";

export const RESIZE_PENDING_ERROR_CODE = "deployment_resize_pending";

export const NO_LEASE_TO_RESIZE_ERROR_CODE = "deployment_resize_no_active_lease";

export const RESOURCES_UNAPPLIED_ERROR_CODE = "deployment_resources_unapplied";

export type LeaseResizeOutcome = "accepted" | "pending" | "expired" | "declined";

type OnChainGroup = DeploymentInfo["groups"][number];

type ResizePlanInput = {
  userId: string;
  owner: string;
  dseq: string;
  submitted: GroupSpec[];
  /** Null when the chain could not describe the deployment, which leaves the change to the provider. */
  groups: OnChainGroup[] | null;
  /** Set for a patch naming resources or a count, or one changing no service or leaving the recorded definition as it is, which re-applies it: the only patches that resize. */
  mayResize: boolean;
};

/** A volume's size is no part of its manifest version, so a volume's resize is told apart by its group and the size it asks for. */
export type AwaitedVolume = { gseq: number; size: string };

/** What a waiting update asked for: the manifest version it carries, and for a volume, the size of its group. */
type AwaitedResize = { owner: string; dseq: string; manifestVersion: string; volume?: AwaitedVolume };

type ResizeRequest = {
  wallet: UserWalletOutput;
  deployment: DeploymentResponse;
  plan: LeaseResizePlan;
  manifestVersion: Uint8Array;
  actingUserId: string;
  assertMayStillSign?: () => Promise<void>;
};

export function resourcesChangedError(groupName: string) {
  return createError(
    422,
    `The SDL changes the resources of group "${groupName}". An update cannot change a deployment's groups, compute resources, replica counts or globally exposed ports, so create a new deployment for this SDL instead`,
    { errorCode: RESOURCES_CHANGED_ERROR_CODE }
  );
}

function firstChangedGroupOf(change: Exclude<ResourceChange, { kind: "unchanged" }>): string {
  switch (change.kind) {
    case "resize":
      return change.plan.groupName;
    case "several-groups":
      return change.groupNames[0];
    default:
      return change.groupName;
  }
}

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** The chain refuses a manifest version on a volume's resize, since the volume's size is no part of the manifest. */
function hashOf(plan: LeaseResizePlan, manifestVersion: Uint8Array): Uint8Array {
  return plan.volumeSize === undefined ? manifestVersion : new Uint8Array();
}

function isRequestOf(pending: LeaseResize, { manifestVersion, volume }: Pick<AwaitedResize, "manifestVersion" | "volume">): boolean {
  if (!volume) return base64Of(pending.hash) === manifestVersion;

  return pending.leaseId?.gseq === volume.gseq && volumeSizeOf(pending.resources).toString() === volume.size;
}

/** The plan's volume, in the shape a job carries it. */
export function awaitedVolumeOf(plan: LeaseResizePlan): AwaitedVolume | undefined {
  return plan.volumeSize === undefined ? undefined : { gseq: plan.gseq, size: plan.volumeSize.toString() };
}

@singleton()
export class LeaseResizeService {
  constructor(
    @inject(CHAIN_SDK) private readonly chainSdk: ChainSDK,
    private readonly featureFlagsService: FeatureFlagsService,
    private readonly deploymentHttpService: DeploymentHttpService,
    private readonly rpcMessageService: RpcMessageService,
    private readonly signerService: ManagedSignerService
  ) {}

  /** The flag rolls the feature out to users, and the market parameter is what governance turned on, so both must allow it. */
  async isAvailableTo(userId: string): Promise<boolean> {
    if (!this.featureFlagsService.isEnabled(FeatureFlags.LEASE_RESIZE, { userId })) return false;

    const { params } = await this.chainSdk.akash.market.v1beta5.getParams({});

    return params?.leaseResizeEnabled ?? false;
  }

  /** A deployment holds at most one pending resize. */
  async findPending(owner: string, dseq: string): Promise<LeaseResize | undefined> {
    const { leaseResizes } = await this.chainSdk.akash.market.v1beta5.getLeaseResizes({ owner, dseq: BigInt(dseq) });

    return leaseResizes[0];
  }

  /** Refuses any patch while a resize is pending, because the chain refuses an update until the provider answers and an accept sets the version the request carries. */
  async planFor({ userId, owner, dseq, submitted, groups, mayResize }: ResizePlanInput): Promise<LeaseResizePlan | undefined> {
    if (!groups) return undefined;

    const change = resourceChangeOf(submitted, groups);
    const isAvailable = await this.isAvailableTo(userId);

    if (isAvailable && (await this.findPending(owner, dseq))) {
      throw createError(409, "A resize of this deployment is waiting for its provider. Wait for it to be answered, or cancel it, and try again.", {
        errorCode: RESIZE_PENDING_ERROR_CODE
      });
    }

    if (change.kind === "unchanged") return undefined;

    if (!isAvailable || change.kind === "groups-changed") throw resourcesChangedError(firstChangedGroupOf(change));

    if (!mayResize) {
      throw createError(
        422,
        `The definition recorded for this deployment asks group "${firstChangedGroupOf(change)}" for other resources than it holds, as a resize that did not go through leaves it. Re-apply it with a patch that changes nothing, or name the resources this patch sets`,
        { errorCode: RESOURCES_UNAPPLIED_ERROR_CODE }
      );
    }

    if (change.kind === "several-groups") {
      throw createError(
        422,
        `The SDL changes the resources of groups ${change.groupNames.map(name => `"${name}"`).join(" and ")}. Resize one group at a time`,
        {
          errorCode: RESIZE_SEVERAL_GROUPS_ERROR_CODE
        }
      );
    }

    if (change.kind === "unresizable") {
      throw createError(
        422,
        `The SDL changes group "${change.groupName}" in a way a running lease cannot be resized to: ${change.reason}. Create a new deployment for this SDL instead`,
        {
          errorCode: RESIZE_REFUSED_ERROR_CODE
        }
      );
    }

    return change.plan;
  }

  /** Sends nothing when the deployment already holds the request this version makes, so a retried apply asks the provider once. */
  async request({ wallet, deployment, plan, manifestVersion, actingUserId, assertMayStillSign }: ResizeRequest): Promise<void> {
    const pending = await this.findPending(wallet.address!, deployment.deployment.id.dseq);

    if (pending && isRequestOf(pending, { manifestVersion: base64Of(manifestVersion), volume: awaitedVolumeOf(plan) })) return;

    const lease = deployment.leases.find(candidate => candidate.id.gseq === plan.gseq && candidate.state === "active");

    if (!lease) {
      throw createError(409, `Group "${plan.groupName}" has no active lease to resize`, { errorCode: NO_LEASE_TO_RESIZE_ERROR_CODE });
    }

    await assertMayStillSign?.();

    const message = this.rpcMessageService.getResizeLeaseMsg({ lease: lease.id, resources: plan.resources, hash: hashOf(plan, manifestVersion) });

    await this.signerService.executeDecodedTxByUserWallet(wallet, [message], { actingUserId });
  }

  /** Reads the pending request before the deployment, because an accept drops the one and sets the other in a single transaction. */
  async outcomeOf(awaited: AwaitedResize, now = new Date()): Promise<LeaseResizeOutcome> {
    const { owner, dseq, manifestVersion, volume } = awaited;
    const pending = await this.findPending(owner, dseq);

    if (pending && isRequestOf(pending, awaited)) {
      return Number(pending.expiresAt) * 1000 <= now.getTime() ? "expired" : "pending";
    }

    const deployment = await this.#chainDeploymentOf(owner, dseq);
    const isApplied = volume ? volumeSizeOnChainOf(deployment, volume.gseq) === volume.size : deployment.deployment.hash === manifestVersion;

    return isApplied ? "accepted" : "declined";
  }

  async cancel({ wallet, dseq, actingUserId }: { wallet: UserWalletOutput; dseq: string; actingUserId: string }): Promise<void> {
    const pending = await this.findPending(wallet.address!, dseq);

    if (!pending?.leaseId) {
      throw createError(404, "This deployment has no resize waiting for its provider");
    }

    const message = this.rpcMessageService.getCancelLeaseResizeMsg(pending.leaseId);

    await this.signerService.executeDecodedTxByUserWallet(wallet, [message], { actingUserId });
  }

  async #chainDeploymentOf(owner: string, dseq: string): Promise<DeploymentInfo> {
    const response = await this.deploymentHttpService.findByOwnerAndDseq(owner, dseq);

    if ("code" in response) throw new Error(`Deployment ${dseq} could not be read: ${response.message}`);

    return response;
  }
}

function volumeSizeOnChainOf(deployment: DeploymentInfo, gseq: number): string | undefined {
  const group = deployment.groups.find(candidate => candidate.id.gseq === gseq);

  return group && volumeSizeOf(GroupSpec.fromJSON(group.group_spec).resources).toString();
}
