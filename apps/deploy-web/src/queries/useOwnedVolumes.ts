import { useMemo } from "react";

import { useWallet } from "@src/context/WalletProvider";
import type { DeploymentDto, LeaseDto } from "@src/types/deployment";
import { volumeClassOf, volumeOf } from "@src/utils/volumeUtils";
import { useDeploymentList } from "./useDeploymentQuery";
import { useAllLeases } from "./useLeaseQuery";

export const DEPENDENCIES = { useWallet, useDeploymentList, useAllLeases };

export interface OwnedVolume {
  name: string;
  owner: string;
  dseq: string;
  sizeBytes: number;
  storageClass?: string;
  /** The provider holding the volume's lease, which is the only one that can run a service mounting it. */
  provider?: string;
  /** The deployment that mounts the volume already, since a volume takes one attachment at a time. */
  mountedBy?: string;
}

/** The volumes the wallet leases as their own deployments, read off its open deployments and their live leases. */
export function useOwnedVolumes(dependencies: typeof DEPENDENCIES = DEPENDENCIES): { volumes: OwnedVolume[]; isLoading: boolean } {
  const { address } = dependencies.useWallet();
  const deployments = dependencies.useDeploymentList(address, {}, "active");
  const leases = dependencies.useAllLeases(address, { state: "active" });
  const volumes = useMemo(() => ownedVolumesOf(deployments.data ?? [], leases.data ?? []), [deployments.data, leases.data]);

  return { volumes, isLoading: deployments.isLoading || leases.isLoading };
}

export function ownedVolumesOf(deployments: DeploymentDto[], leases: LeaseDto[]): OwnedVolume[] {
  const mountedBy = mountingDeploymentsOf(deployments);

  return deployments.flatMap(deployment => {
    const group = deployment.groups.find(candidate => volumeOf(candidate));
    const volume = volumeOf(group);
    if (!group || !volume) return [];

    const owner = group.id.owner;
    return [
      {
        name: volume.vid,
        owner,
        dseq: deployment.dseq,
        sizeBytes: Number(group.group_spec.resources[0]?.resource.storage[0]?.quantity.val ?? 0),
        storageClass: volumeClassOf(group),
        provider: leases.find(lease => lease.dseq === deployment.dseq && lease.state === "active")?.provider,
        mountedBy: mountedBy.get(volumeKeyOf({ owner, dseq: deployment.dseq }))
      }
    ];
  });
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
