import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { defaultPlacement, defaultPricing } from "./data";
import { validateGeneratedSdl } from "./validateGeneratedSdl";
import type { VolumeDraft } from "./volumeSdl";
import { volumeSdlOf } from "./volumeSdl";

describe(volumeSdlOf.name, () => {
  it("declares the one volume and deploys it to the placement of the service that mounts it", () => {
    const sdl = yaml.load(volumeSdlOf(buildDraft({}))) as Record<string, any>;

    expect(sdl).toEqual({
      version: "2.2",
      volumes: { data: { size: "10Gi", class: "beta3", lifecycle: { reclaim: "retain", retention: "168h" } } },
      profiles: { placement: { dcloud: { pricing: { data: { denom: "uact", amount: 100000 } } } } },
      deployment: { data: { dcloud: { profile: "data", count: 1 } } }
    });
  });

  it("deletes the data at close when the volume keeps none", () => {
    const sdl = yaml.load(volumeSdlOf(buildDraft({ retention: undefined }))) as Record<string, any>;

    expect(sdl.volumes.data.lifecycle).toEqual({ reclaim: "delete" });
  });

  it("asks for the region and signers the service's placement asks for", () => {
    const placement = defaultPlacement({ name: "dcloud", regions: ["us-west"], signedBy: { anyOf: [{ id: "a", value: "akash1auditor" }], allOf: [] } });

    const sdl = yaml.load(volumeSdlOf(buildDraft({ placement }))) as Record<string, any>;

    expect(sdl.profiles.placement.dcloud).toEqual({
      attributes: { "location-region": "us-west" },
      signedBy: { anyOf: ["akash1auditor"] },
      pricing: { data: { denom: "uact", amount: 100000 } }
    });
  });

  it("writes an sdl the chain validator accepts", () => {
    expect(validateGeneratedSdl(volumeSdlOf(buildDraft({})))).toEqual([]);
  });

  function buildDraft(input: Partial<VolumeDraft>): VolumeDraft {
    return {
      name: "data",
      size: 10,
      unit: "Gi",
      storageClass: "beta3",
      retention: "168h",
      placement: defaultPlacement({ name: "dcloud" }),
      pricing: defaultPricing(),
      ...input
    };
  }
});
