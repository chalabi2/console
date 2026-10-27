import { describe, expect, it } from "vitest";

import { bytesOf, sizeTextOf, volumesDeclaredBy, volumeSizeOf } from "./volumeDeclarations";

describe("volumeDeclarations", () => {
  describe(volumesDeclaredBy.name, () => {
    it("reads each volume a volume's own deployment declares, with its class and lifecycle", () => {
      const sdl = volumeSdl(["  data:", "    size: 1Gi", "    class: beta3", "    lifecycle:", "      reclaim: retain", "      retention: 1h"]);

      expect(volumesDeclaredBy(sdl)).toEqual([{ name: "data", size: "1Gi", storageClass: "beta3", reclaim: "retain", retention: "1h" }]);
    });

    it("reads a volume declared without a class or lifecycle", () => {
      expect(volumesDeclaredBy(volumeSdl(["  data:", "    size: 1Gi"]))).toEqual([{ name: "data", size: "1Gi" }]);
    });

    it("leaves out a volume the deployment mounts from another one", () => {
      const sdl = volumeSdl(["  data:", "    size: 1Gi", "  shared:", "    external:", "      dseq: 12"]);

      expect(volumesDeclaredBy(sdl)).toEqual([{ name: "data", size: "1Gi" }]);
    });

    it.each([
      { case: "runs services", sdl: volumeSdl(["  data:", "    size: 1Gi"], ["services:", "  web:", "    image: nginx"]) },
      { case: "only mounts volumes other deployments lease", sdl: volumeSdl(["  shared:", "    external:", "      dseq: 12"]) },
      { case: "declares no volumes", sdl: 'version: "2.0"\nservices:\n  web:\n    image: nginx\n' },
      { case: "is not yaml", sdl: "version: [" },
      { case: "is not a document", sdl: "just text" }
    ])("finds no volume deployment in an sdl that $case", ({ sdl }) => {
      expect(volumesDeclaredBy(sdl)).toBeNull();
    });
  });

  describe(volumeSizeOf.name, () => {
    it.each([
      { size: "2Gi", expected: { amount: 2, unit: "Gi" } },
      { size: " 512mi ", expected: { amount: 512, unit: "Mi" } },
      { size: "1.5Ti", expected: { amount: 1.5, unit: "Ti" } },
      { size: "1.25Gi", expected: { amount: 1.25, unit: "Gi" } },
      { size: "10 GB", expected: { amount: 10, unit: "GB" } }
    ])("reads $size as an amount and a unit", ({ size, expected }) => {
      expect(volumeSizeOf(size)).toEqual(expected);
    });

    it.each(["2", "2Xi", "Gi", "-1Gi", "2Gi extra"])("reads nothing from %s", size => {
      expect(volumeSizeOf(size)).toBeNull();
    });
  });

  it("writes a size back as the sdl spells it", () => {
    expect(sizeTextOf({ amount: 1.5, unit: "Gi" })).toBe("1.5Gi");
  });

  it("counts the bytes of a size", () => {
    expect(bytesOf({ amount: 2, unit: "Gi" })).toBe(2 * 1024 ** 3);
    expect(bytesOf({ amount: 3, unit: "MB" })).toBe(3 * 1000 ** 2);
  });

  function volumeSdl(volumes: string[], extra: string[] = []): string {
    return ['version: "2.2"', "volumes:", ...volumes, ...extra, ""].join("\n");
  }
});
