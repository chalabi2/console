import { describe, expect, it } from "vitest";

import type { GroupVolume } from "./volumeUtils";
import { volumeOf } from "./volumeUtils";

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

  function buildGroup(input: { volume?: GroupVolume | null }) {
    const [group] = buildRpcDeployment().groups;
    return { ...group, group_spec: { ...group.group_spec, ...("volume" in input && { volume: input.volume }) } };
  }
});
