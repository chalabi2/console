import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import type { GroupVolume } from "./volumeUtils";
import { deploymentVolumeOf, isBucketVolume, volumeAfterCloseOf, volumeAttachmentSdlOf, volumeClassOf, volumeOf } from "./volumeUtils";

import { buildRpcDeployment } from "@tests/seeders";

describe("volumeUtils", () => {
  describe(volumeOf.name, () => {
    it("reads the volume a volume's own group leases", () => {
      expect(volumeOf(buildGroup({ volume: { vid: "data" } }))).toEqual({ vid: "data" });
    });

    it.each([
      { case: "runs a workload", group: buildGroup({}) },
      { case: "carries an empty volume", group: buildGroup({ volume: null }) },
      { case: "is unknown", group: undefined }
    ])("finds no volume in a group that $case", ({ group }) => {
      expect(volumeOf(group)).toBeUndefined();
    });
  });

  describe(isBucketVolume.name, () => {
    it("reads a volume served over S3 as a bucket", () => {
      expect(isBucketVolume({ access: "bucket" })).toBe(true);
    });

    it.each([{ access: "mount" }, {}, undefined])("reads %o as no bucket", volume => {
      expect(isBucketVolume(volume)).toBe(false);
    });
  });

  describe(deploymentVolumeOf.name, () => {
    it("reads the volume of a volume's own deployment", () => {
      expect(deploymentVolumeOf([buildGroup({ volume: { vid: "data" } })])).toEqual({ vid: "data" });
    });

    it.each([
      { case: "runs workloads", groups: [buildGroup({ volume: null }), buildGroup({})] },
      { case: "is not loaded yet", groups: undefined }
    ])("finds no volume in a deployment that $case", ({ groups }) => {
      expect(deploymentVolumeOf(groups)).toBeUndefined();
    });
  });

  describe(volumeClassOf.name, () => {
    it("reads the storage class backing a volume", () => {
      const group = buildGroup({
        storages: [
          [
            { key: "persistent", value: "true" },
            { key: "class", value: "beta3" }
          ]
        ]
      });

      expect(volumeClassOf(group)).toBe("beta3");
    });

    it.each([
      { case: "declares no class", group: buildGroup({ storages: [[{ key: "persistent", value: "true" }]] }) },
      { case: "leases no storage", group: buildGroup({ storages: [] }) },
      { case: "requests no resources", group: buildGroup({ requestsNothing: true }) },
      { case: "is unknown", group: undefined }
    ])("reads no class from a group that $case", ({ group }) => {
      expect(volumeClassOf(group)).toBeUndefined();
    });
  });

  describe(volumeAfterCloseOf.name, () => {
    it("says a volume set to delete loses its data once it closes", () => {
      expect(volumeAfterCloseOf({ reclaim: "delete", retention: "604800s" })).toBe("Its data is deleted once it closes.");
    });

    it("says how long the provider keeps a retained volume's data", () => {
      expect(volumeAfterCloseOf({ reclaim: "retain", retention: "604800s" })).toBe(
        "Its provider then keeps the data for 7 days, so a new volume can adopt it."
      );
    });

    it.each([
      { case: "no retention", volume: { reclaim: "retain" } },
      { case: "no volume", volume: undefined }
    ])("says nothing for $case", ({ volume }) => {
      expect(volumeAfterCloseOf(volume)).toBeNull();
    });
  });

  it("writes the sdl another deployment attaches a volume with, mounting it in one of its services", () => {
    const sdl = volumeAttachmentSdlOf({ vid: "data", owner: "akash1owner", dseq: "1793083597928" });

    expect(yaml.load(sdl)).toEqual({
      volumes: { data: { external: { owner: "akash1owner", dseq: 1793083597928 } } },
      services: { "your-service": { params: { storage: { data: { mount: "/data", volume: "data" } } } } }
    });
  });

  function buildGroup(input: { volume?: GroupVolume | null; storages?: Array<Array<{ key: string; value: string }>>; requestsNothing?: boolean }) {
    const [group] = buildRpcDeployment().groups;
    const [unit] = group.group_spec.resources;
    const storage = input.storages ? input.storages.map(attributes => ({ ...unit.resource.storage[0], attributes })) : unit.resource.storage;
    const resources = input.requestsNothing ? [] : [{ ...unit, resource: { ...unit.resource, storage } }];

    return { ...group, group_spec: { ...group.group_spec, resources, ...("volume" in input && { volume: input.volume }) } };
  }
});
