import { useMemo } from "react";

import { useWallet } from "@src/context/WalletProvider";
import type { DeploymentDto, LeaseDto } from "@src/types/deployment";
import { getReclamationDeadline, isClosingVolume, isReclaiming } from "@src/utils/reclamationUtils";
import { volumeClassOf, volumeOf } from "@src/utils/volumeUtils";
import { useDeploymentList } from "./useDeploymentQuery";
import { useAllLeases } from "./useLeaseQuery";

export const DEPENDENCIES = { useWallet, useDeploymentList, useAllLeases };

/** A reclaiming lease still holds the volume's data, so it counts alongside an active one. */
const LIVE_LEASE_STATES = ["active", "reclaiming"] as const;

/**
 * `closing` is a close its owner asked for and `reclaiming` one the provider or a move started; either way the
 * chain holds the lease until its reclamation deadline.
 */
export type VolumeState = "unleased" | "available" | "mounted" | "closing" | "reclaiming";

export interface OwnedVolume {
  name: string;
  owner: string;
  dseq: string;
  sizeBytes: number;
  storageClass?: string;
  state: VolumeState;
  /** The provider holding the volume's lease, which is the only one that can run a service mounting it. */
  provider?: string;
  /** The deployment that mounts the volume already, since a volume takes one attachment at a time. */
  mountedBy?: string;
  reclamationDeadline?: Date;
  pricePerBlock?: LeaseDto["price"];
  /** What becomes of the data once a close completes, as the owner set it at creation. */
  reclaim?: string;
  retention?: string;
}

/** The volumes the wallet leases as their own deployments, read off its open deployments and their live leases. */
export function useOwnedVolumes(dependencies: typeof DEPENDENCIES = DEPENDENCIES): {
  volumes: OwnedVolume[];
  isLoading: boolean;
  isError: boolean;
  refetch: () => void;
} {
  const { address } = dependencies.useWallet();
  const deployments = dependencies.useDeploymentList(address, {}, "active");
  const leases = dependencies.useAllLeases(address, { state: LIVE_LEASE_STATES });
  const volumes = useMemo(() => ownedVolumesOf(deployments.data ?? [], leases.data ?? []), [deployments.data, leases.data]);

  return {
    volumes,
    isLoading: deployments.isLoading || leases.isLoading,
    isError: deployments.isError || leases.isError,
    refetch: () => {
      deployments.refetch();
      leases.refetch();
    }
  };
}

export function ownedVolumesOf(deployments: DeploymentDto[], leases: LeaseDto[]): OwnedVolume[] {
  const mountedBy = mountingDeploymentsOf(deployments);

  return deployments.flatMap(deployment => {
    const group = deployment.groups.find(candidate => volumeOf(candidate));
    const volume = volumeOf(group);
    if (!group || !volume) return [];

    const owner = group.id.owner;
    const lease = leases.find(candidate => candidate.dseq === deployment.dseq && LIVE_LEASE_STATES.some(state => state === candidate.state));
    const mounting = mountedBy.get(volumeKeyOf({ owner, dseq: deployment.dseq }));
    return [
      {
        name: volume.vid,
        owner,
        dseq: deployment.dseq,
        sizeBytes: Number(group.group_spec.resources[0]?.resource.storage[0]?.quantity.val ?? 0),
        storageClass: volumeClassOf(group),
        state: volumeStateOf(lease, mounting),
        provider: lease?.provider,
        mountedBy: mounting,
        reclamationDeadline: (lease && getReclamationDeadline(lease)) ?? undefined,
        pricePerBlock: lease?.price,
        reclaim: volume.reclaim,
        retention: volume.retention
      }
    ];
  });
}

function volumeStateOf(lease: LeaseDto | undefined, mountedBy: string | undefined): VolumeState {
  if (!lease) return "unleased";
  if (isClosingVolume(lease)) return "closing";
  if (isReclaiming(lease)) return "reclaiming";
  return mountedBy ? "mounted" : "available";
}

export function volumeKeyOf(volume: { owner?: string; dseq: string }): string {
  return `${volume.owner ?? ""}/${volume.dseq}`;
}

function mountingDeploymentsOf(deployments: DeploymentDto[]): Map<string, string> {
  return new Map(
    deployments.flatMap(deployment =>
      deployment.groups.flatMap(group =>
        group.group_spec.resources.flatMap(unit => (unit.volumes ?? []).map(ref => [volumeKeyOf(ref), deployment.dseq] as const))
      )
    )
  );
}
