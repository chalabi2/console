import formatDuration from "date-fns/formatDuration";
import intervalToDuration from "date-fns/intervalToDuration";

import type { DeploymentGroup } from "@src/types/deployment";
import { parseReclamationWindowSeconds } from "@src/utils/reclamationUtils";

export type GroupVolume = NonNullable<DeploymentGroup["group_spec"]["volume"]>;

/** A volume is its own deployment, whose one group names the volume it leases and runs no workload. */
export function volumeOf(group: DeploymentGroup | undefined): GroupVolume | undefined {
  const volume = group?.group_spec?.volume;
  return typeof volume?.vid === "string" ? volume : undefined;
}

/** A bucket is served over S3 to deployments on any provider, so nothing mounts it. */
export function isBucketVolume(volume: Pick<GroupVolume, "access"> | undefined): boolean {
  return volume?.access === "bucket";
}

export function deploymentVolumeOf(groups: DeploymentGroup[] | undefined): GroupVolume | undefined {
  return groups?.map(volumeOf).find(volume => volume !== undefined);
}

/** What becomes of a volume's data once its close completes, as its owner set it when creating the volume. */
export function volumeAfterCloseOf(volume: Pick<GroupVolume, "reclaim" | "retention"> | undefined): string | null {
  if (volume?.reclaim === "delete") return "Its data is deleted once it closes.";

  const retentionSeconds = parseReclamationWindowSeconds(volume?.retention);
  if (!retentionSeconds) return null;

  return `Its provider then keeps the data for ${formatDuration(intervalToDuration({ start: 0, end: retentionSeconds * 1000 }))}, so a new volume can adopt it.`;
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
