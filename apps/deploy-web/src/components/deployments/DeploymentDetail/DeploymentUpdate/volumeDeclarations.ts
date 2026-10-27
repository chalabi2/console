import yaml from "js-yaml";

import { storageUnits } from "@src/utils/akash/units";

export interface DeclaredVolume {
  name: string;
  size: string;
  storageClass?: string;
  reclaim?: string;
  retention?: string;
}

export interface VolumeSize {
  amount: number;
  unit: string;
}

type Node = Record<string, unknown>;

/** A volume's own deployment declares volumes and runs no service, while one that mounts a volume runs services and is edited through its services. */
export function volumesDeclaredBy(sdl: string): DeclaredVolume[] | null {
  const document = parsedOrNull(sdl);

  if (!isNode(document) || !isNode(document.volumes) || runsServices(document)) return null;

  const declared = Object.entries(document.volumes).flatMap(([name, volume]) =>
    isNode(volume) && typeof volume.size === "string" ? [declaredVolumeOf(name, volume)] : []
  );

  return declared.length > 0 ? declared : null;
}

export function volumeSizeOf(size: string): VolumeSize | null {
  const match = /^(\d+(?:\.\d+)?)\s*([A-Za-z]+)$/.exec(size.trim());
  const unit = match && storageUnits.find(candidate => candidate.suffix.toLowerCase() === match[2].toLowerCase());

  return match && unit ? { amount: Number(match[1]), unit: unit.suffix } : null;
}

export function sizeTextOf({ amount, unit }: VolumeSize): string {
  return `${amount}${unit}`;
}

export function bytesOf({ amount, unit }: VolumeSize): number {
  return amount * (storageUnits.find(candidate => candidate.suffix === unit)?.value ?? 0);
}

function declaredVolumeOf(name: string, volume: Node): DeclaredVolume {
  const lifecycle = isNode(volume.lifecycle) ? volume.lifecycle : {};

  return {
    name,
    size: volume.size as string,
    ...(typeof volume.class === "string" && { storageClass: volume.class }),
    ...(typeof lifecycle.reclaim === "string" && { reclaim: lifecycle.reclaim }),
    ...(typeof lifecycle.retention === "string" && { retention: lifecycle.retention })
  };
}

function runsServices(document: Node): boolean {
  return isNode(document.services) && Object.keys(document.services).length > 0;
}

function parsedOrNull(sdl: string): unknown {
  try {
    return yaml.load(sdl);
  } catch {
    return null;
  }
}

function isNode(value: unknown): value is Node {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
