import yaml from "js-yaml";

import type { PlacementType, ServiceType } from "@src/types";
import { placementProfileOf } from "./sdlGenerator";

/** How deployments reach a volume: mounted on the provider leasing it, or as an S3 bucket from any provider. */
export type VolumeAccess = "mount" | "bucket";

export interface VolumeDraft {
  name: string;
  size: number;
  unit: string;
  storageClass: string;
  /** How long the provider keeps the data after the volume closes, so a new volume can adopt it; without one the data goes at close. */
  retention?: string;
  placement: PlacementType;
  pricing: ServiceType["pricing"];
  access?: VolumeAccess;
}

/** A volume is its own deployment, declaring the one volume and no service, placed like the service that will mount it. */
export function volumeSdlOf(draft: VolumeDraft): string {
  const sdl = {
    version: "2.2",
    volumes: {
      [draft.name]: {
        size: `${draft.size}${draft.unit}`,
        class: draft.storageClass,
        ...(draft.access === "bucket" ? { access: "bucket" } : {}),
        lifecycle: draft.retention ? { reclaim: "retain", retention: draft.retention } : { reclaim: "delete" }
      }
    },
    profiles: {
      placement: {
        [draft.placement.name]: {
          ...placementProfileOf(draft.placement),
          pricing: { [draft.name]: { denom: draft.pricing.denom, amount: draft.pricing.amount } }
        }
      }
    },
    deployment: { [draft.name]: { [draft.placement.name]: { profile: draft.name, count: 1 } } }
  };

  return `---
${yaml.dump(sdl, { indent: 2, quotingType: '"' })}`;
}
