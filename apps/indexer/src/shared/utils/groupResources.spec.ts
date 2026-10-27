import { ResourceUnit, Storage } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import { describe, expect, it } from "vitest";

import { getGPUAttributes, groupResourceRowOf, isPersistentStorage, leaseResourcesOf } from "./groupResources";

describe("groupResources", () => {
  describe(groupResourceRowOf.name, () => {
    it("records a resource unit's hardware, count and price as a deployment group resource row", () => {
      const unit = setup({
        cpu: 1500,
        memory: 2147483648,
        storage: [
          { quantity: 536870912, persistent: false },
          { quantity: 1073741824, persistent: false },
          { quantity: 10737418240, persistent: true }
        ],
        gpu: { units: 2, attributeKey: "vendor/nvidia/model/a100", attributeValue: "true" },
        count: 3,
        price: "104.060646000000000000"
      });

      expect(groupResourceRowOf(unit)).toEqual({
        cpuUnits: 1500,
        gpuUnits: 2,
        gpuVendor: "nvidia",
        gpuModel: "a100",
        memoryQuantity: 2147483648,
        ephemeralStorageQuantity: 1610612736,
        persistentStorageQuantity: 10737418240,
        count: 3,
        price: 104.060646
      });
    });

    it("counts a unit without hardware, gpu or price as zero", () => {
      const unit = ResourceUnit.fromPartial({ count: 1 });

      expect(groupResourceRowOf(unit)).toEqual({
        cpuUnits: 0,
        gpuUnits: 0,
        gpuVendor: null,
        gpuModel: null,
        memoryQuantity: 0,
        ephemeralStorageQuantity: 0,
        persistentStorageQuantity: 0,
        count: 1,
        price: 0
      });
    });

    it.each([
      { case: "leaves out cpu, gpu and memory", resource: {} },
      { case: "gives its hardware no units or quantities", resource: { cpu: {}, gpu: {}, memory: {}, storage: [{ name: "data" }] } }
    ])("counts a unit whose resource $case as zero", ({ resource }) => {
      const unit = ResourceUnit.fromPartial({ resource, count: 1 });

      expect(groupResourceRowOf(unit)).toMatchObject({
        cpuUnits: 0,
        gpuUnits: 0,
        memoryQuantity: 0,
        ephemeralStorageQuantity: 0,
        persistentStorageQuantity: 0
      });
    });
  });

  describe(leaseResourcesOf.name, () => {
    it("adds up every unit's hardware once per instance", () => {
      const resources = leaseResourcesOf([
        { cpuUnits: 1000, gpuUnits: 1, memoryQuantity: 100, ephemeralStorageQuantity: 10, persistentStorageQuantity: 1, count: 2 },
        { cpuUnits: 500, gpuUnits: 0, memoryQuantity: 50, ephemeralStorageQuantity: 5, persistentStorageQuantity: 3, count: 3 }
      ]);

      expect(resources).toEqual({
        cpuUnits: 3500,
        gpuUnits: 2,
        memoryQuantity: 350,
        ephemeralStorageQuantity: 35,
        persistentStorageQuantity: 11
      });
    });

    it("finds nothing leased in a group without resources", () => {
      expect(leaseResourcesOf([])).toEqual({
        cpuUnits: 0,
        gpuUnits: 0,
        memoryQuantity: 0,
        ephemeralStorageQuantity: 0,
        persistentStorageQuantity: 0
      });
    });
  });

  describe(isPersistentStorage.name, () => {
    it("tells persistent storage by its persistent attribute", () => {
      expect(isPersistentStorage(Storage.fromPartial({ name: "data", attributes: [{ key: "persistent", value: "true" }] }))).toBe(true);
    });

    it.each([
      { name: "persistent set to false", attributes: [{ key: "persistent", value: "false" }] },
      { name: "another attribute set to true", attributes: [{ key: "class", value: "true" }] },
      { name: "no attributes", attributes: [] }
    ])("treats storage with $name as ephemeral", ({ attributes }) => {
      expect(isPersistentStorage(Storage.fromPartial({ name: "default", attributes }))).toBe(false);
    });
  });

  describe(getGPUAttributes.name, () => {
    it("reads the vendor and model of a gpu", () => {
      expect(getGPUAttributes(gpuWith([{ key: "vendor/nvidia/model/h100", value: "true" }]))).toEqual({ vendor: "nvidia", model: "h100" });
    });

    it("leaves the model out of a gpu that accepts any model", () => {
      expect(getGPUAttributes(gpuWith([{ key: "vendor/nvidia/model/*", value: "true" }]))).toEqual({ vendor: "nvidia", model: null });
    });

    it.each([
      { case: "no gpu", gpu: undefined },
      { case: "no attributes", gpu: gpuWith([]) },
      {
        case: "several attributes",
        gpu: gpuWith([
          { key: "vendor/nvidia/model/h100", value: "true" },
          { key: "vendor/amd/model/mi300", value: "true" }
        ])
      },
      { case: "an attribute that is not true", gpu: gpuWith([{ key: "vendor/nvidia/model/h100", value: "false" }]) },
      { case: "an attribute that names no vendor and model", gpu: gpuWith([{ key: "interface/pcie", value: "true" }]) },
      { case: "an attribute naming a vendor and model past its start", gpu: gpuWith([{ key: "class/vendor/nvidia/model/h100", value: "true" }]) }
    ])("finds neither vendor nor model for $case", ({ gpu }) => {
      expect(getGPUAttributes(gpu)).toEqual({ vendor: null, model: null });
    });
  });

  function gpuWith(attributes: { key: string; value: string }[]) {
    return ResourceUnit.fromPartial({ resource: { gpu: { units: { val: 1n }, attributes } } }).resource?.gpu;
  }

  function setup(input: {
    cpu: number;
    memory: number;
    storage: { quantity: number; persistent: boolean }[];
    gpu: { units: number; attributeKey: string; attributeValue: string };
    count: number;
    price: string;
  }) {
    return ResourceUnit.fromPartial({
      resource: {
        cpu: { units: { val: BigInt(input.cpu) } },
        memory: { quantity: { val: BigInt(input.memory) } },
        storage: input.storage.map(({ quantity, persistent }, index) => ({
          name: `volume-${index}`,
          quantity: { val: BigInt(quantity) },
          attributes: persistent ? [{ key: "persistent", value: "true" }] : []
        })),
        gpu: { units: { val: BigInt(input.gpu.units) }, attributes: [{ key: input.gpu.attributeKey, value: input.gpu.attributeValue }] }
      },
      count: input.count,
      price: { denom: "uact", amount: input.price }
    });
  }
});
