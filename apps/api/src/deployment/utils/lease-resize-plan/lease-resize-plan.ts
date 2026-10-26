import type { Attribute } from "@akashnetwork/chain-sdk/private-types/akash.v1";
import { type Endpoint, GroupSpec, type ResourceUnit } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import type { DeploymentInfo } from "@akashnetwork/http-sdk";

import { findGroupsWithChangedResources } from "@src/deployment/utils/changed-group-resources/changed-group-resources";

type OnChainGroup = DeploymentInfo["groups"][number];
type Resources = NonNullable<ResourceUnit["resource"]>;
type Storage = Resources["storage"][number];
type VolumeRef = ResourceUnit["volumes"][number];

export interface LeaseResizePlan {
  gseq: number;
  groupName: string;
  resources: ResourceUnit[];
}

export type ResourceChange =
  | { kind: "unchanged" }
  | { kind: "resize"; plan: LeaseResizePlan }
  | { kind: "groups-changed"; groupName: string }
  | { kind: "several-groups"; groupNames: string[] }
  | { kind: "unresizable"; groupName: string; reason: string };

const PERSISTENT_STORAGE_ATTRIBUTE = "persistent";

/** Classifies what an SDL changes about the resources a deployment holds on chain, holding the one group it may resize to the rules the chain's GroupSpec.Resize applies. */
export function resourceChangeOf(submitted: GroupSpec[], onChain: OnChainGroup[]): ResourceChange {
  const changedGroupNames = findGroupsWithChangedResources(
    submitted,
    onChain.map(group => group.group_spec)
  );

  if (changedGroupNames.length === 0) return { kind: "unchanged" };

  const structural = changedGroupNames.find(name => !submitted.some(group => group.name === name) || !onChain.some(group => group.group_spec.name === name));

  if (structural) return { kind: "groups-changed", groupName: structural };

  if (changedGroupNames.length > 1) return { kind: "several-groups", groupNames: changedGroupNames };

  const [groupName] = changedGroupNames;
  const next = submitted.find(group => group.name === groupName)!;
  const held = onChain.find(group => group.group_spec.name === groupName)!;
  const reason = resizeRefusalOf(GroupSpec.fromJSON(held.group_spec), next);

  if (reason) return { kind: "unresizable", groupName, reason };

  return { kind: "resize", plan: { gseq: held.id.gseq, groupName, resources: next.resources } };
}

function resizeRefusalOf(current: GroupSpec, next: GroupSpec): string | undefined {
  if (next.resources.length !== current.resources.length) return "it adds or removes a compute profile";

  const nextById = new Map(next.resources.map(unit => [unit.resource?.id, unit]));

  for (const unit of current.resources) {
    const nextUnit = nextById.get(unit.resource?.id);
    const refusal = nextUnit ? unitResizeRefusalOf(current.volume !== undefined, unit, nextUnit) : "it adds or removes a compute profile";

    if (refusal) return refusal;
  }

  return undefined;
}

function unitResizeRefusalOf(isVolumeGroup: boolean, current: ResourceUnit, next: ResourceUnit): string | undefined {
  if (next.price?.denom !== current.price?.denom) return "it changes the currency its price is set in";

  return (
    volumeRefusalOf(current, next) ??
    computeRefusalOf(current.resource, next.resource) ??
    storageRefusalOf(isVolumeGroup, current.resource?.storage ?? [], next.resource?.storage ?? []) ??
    endpointRefusalOf(current.resource?.endpoints ?? [], next.resource?.endpoints ?? [])
  );
}

function volumeRefusalOf(current: ResourceUnit, next: ResourceUnit): string | undefined {
  if (current.volumes.length > 0 && next.count !== current.count) return "it changes the replica count of a service that mounts a volume";

  const sameVolumes = next.volumes.length === current.volumes.length && current.volumes.every((ref, index) => isSameVolumeRef(ref, next.volumes[index]));

  return sameVolumes ? undefined : "it changes the volumes a service mounts";
}

function isSameVolumeRef(left: VolumeRef, right: VolumeRef): boolean {
  return left.owner === right.owner && left.dseq === right.dseq && left.gseq === right.gseq && left.name === right.name;
}

function computeRefusalOf(current: Resources | undefined, next: Resources | undefined): string | undefined {
  if (!current?.cpu !== !next?.cpu || !current?.memory !== !next?.memory) return "it removes CPU or memory";

  if (!sameAttributes(current?.cpu?.attributes, next?.cpu?.attributes)) return "it changes the CPU architecture or another CPU attribute";

  if (!sameAttributes(current?.memory?.attributes, next?.memory?.attributes)) return "it changes a memory attribute";

  const heldGpus = gpuUnitsOf(current);
  const nextGpus = gpuUnitsOf(next);

  if ((heldGpus === 0n) !== (nextGpus === 0n)) return "it adds or removes GPUs";

  if (heldGpus > 0n && !sameAttributes(current?.gpu?.attributes, next?.gpu?.attributes)) return "it changes the GPU model or another GPU attribute";

  return undefined;
}

function storageRefusalOf(isVolumeGroup: boolean, current: Storage[], next: Storage[]): string | undefined {
  if (next.length !== current.length) return "it adds or removes a storage volume";

  for (const [index, volume] of current.entries()) {
    const nextVolume = next[index];

    if (nextVolume.name !== volume.name) return `it renames storage volume "${volume.name}"`;

    if (!sameAttributes(volume.attributes, nextVolume.attributes)) return `it changes the class or persistence of storage volume "${volume.name}"`;

    if (!isPersistent(volume)) continue;

    const heldSize = volume.quantity?.val ?? 0n;
    const nextSize = nextVolume.quantity?.val ?? 0n;

    if (isVolumeGroup && nextSize < heldSize) return `it shrinks volume "${volume.name}", which can only grow`;

    if (!isVolumeGroup && nextSize !== heldSize)
      return `it changes the size of persistent storage volume "${volume.name}", which keeps the size it was created with`;
  }

  return undefined;
}

function endpointRefusalOf(current: Endpoint[], next: Endpoint[]): string | undefined {
  const sameEndpoints =
    next.length === current.length &&
    current.every((endpoint, index) => endpoint.kind === next[index].kind && endpoint.sequenceNumber === next[index].sequenceNumber);

  return sameEndpoints ? undefined : "it adds, removes or changes a globally exposed port";
}

function isPersistent(volume: Storage): boolean {
  return volume.attributes.some(attribute => attribute.key === PERSISTENT_STORAGE_ATTRIBUTE && attribute.value === "true");
}

function gpuUnitsOf(resources: Resources | undefined): bigint {
  return resources?.gpu?.units?.val ?? 0n;
}

/** Compared as key and value sets, because the chain sorts attributes and an SDL lists them in its own order. */
function sameAttributes(left: Attribute[] | undefined, right: Attribute[] | undefined): boolean {
  const keyed = (attributes: Attribute[] | undefined) => (attributes ?? []).map(({ key, value }) => `${key}=${value}`).sort();

  return JSON.stringify(keyed(left)) === JSON.stringify(keyed(right));
}
