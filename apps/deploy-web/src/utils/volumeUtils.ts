import type { DeploymentGroup } from "@src/types/deployment";

export type GroupVolume = NonNullable<DeploymentGroup["group_spec"]["volume"]>;

/** A volume is its own deployment, whose one group names the volume it leases and runs no workload. */
export function volumeOf(group: DeploymentGroup | undefined): GroupVolume | undefined {
  const volume = group?.group_spec?.volume;
  return typeof volume?.vid === "string" ? volume : undefined;
}

export function deploymentVolumeOf(groups: DeploymentGroup[] | undefined): GroupVolume | undefined {
  return groups?.map(volumeOf).find(volume => volume !== undefined);
}

export function volumeClassOf(group: DeploymentGroup | undefined): string | undefined {
  return group?.group_spec.resources[0]?.resource.storage[0]?.attributes.find(attribute => attribute.key === "class")?.value;
}

/** Another deployment attaches a volume by its owner and dseq, then mounts it in a service under a storage name its compute profile leaves undeclared. */
export function volumeAttachmentSdlOf(input: { vid: string; owner: string; dseq: string }): string {
  return [
    "volumes:",
    `  ${input.vid}:`,
    "    external:",
    `      owner: ${input.owner}`,
    `      dseq: ${input.dseq}`,
    "services:",
    "  your-service:",
    "    params:",
    "      storage:",
    `        ${input.vid}:`,
    "          mount: /data",
    `          volume: ${input.vid}`
  ].join("\n");
}
