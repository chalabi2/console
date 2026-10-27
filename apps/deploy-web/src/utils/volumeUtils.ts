import type { DeploymentGroup } from "@src/types/deployment";

export type GroupVolume = NonNullable<DeploymentGroup["group_spec"]["volume"]>;

/** A volume is its own deployment, whose one group leases the volume's storage and runs no workload. */
export function volumeOf(group: DeploymentGroup | undefined): GroupVolume | undefined {
  return group?.group_spec.volume ?? undefined;
}
