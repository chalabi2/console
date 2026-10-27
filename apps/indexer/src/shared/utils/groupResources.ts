import type * as v1beta2 from "@akashnetwork/akash-api/v1beta2";
import type * as v1beta3 from "@akashnetwork/akash-api/v1beta3";
import type * as v1beta4 from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import type { GroupResourceRow } from "@akashnetwork/database/dbSchemas/akash";

export type LeaseResources = Pick<GroupResourceRow, "cpuUnits" | "gpuUnits" | "memoryQuantity" | "ephemeralStorageQuantity" | "persistentStorageQuantity">;

export function groupResourceRowOf(unit: v1beta4.ResourceUnit): GroupResourceRow {
  const { vendor: gpuVendor, model: gpuModel } = getGPUAttributes(unit.resource?.gpu);
  const storage = unit.resource?.storage ?? [];

  return {
    cpuUnits: Number(unit.resource?.cpu?.units?.val ?? 0),
    gpuUnits: Number(unit.resource?.gpu?.units?.val ?? 0),
    gpuVendor,
    gpuModel,
    memoryQuantity: Number(unit.resource?.memory?.quantity?.val ?? 0),
    ephemeralStorageQuantity: storageQuantityOf(storage.filter(x => !isPersistentStorage(x))),
    persistentStorageQuantity: storageQuantityOf(storage.filter(x => isPersistentStorage(x))),
    count: unit.count,
    price: parseFloat(unit.price?.amount ?? "0")
  };
}

export function leaseResourcesOf(rows: Pick<GroupResourceRow, keyof LeaseResources | "count">[]): LeaseResources {
  return {
    cpuUnits: sumOf(rows.map(x => x.cpuUnits * x.count)),
    gpuUnits: sumOf(rows.map(x => x.gpuUnits * x.count)),
    memoryQuantity: sumOf(rows.map(x => x.memoryQuantity * x.count)),
    ephemeralStorageQuantity: sumOf(rows.map(x => x.ephemeralStorageQuantity * x.count)),
    persistentStorageQuantity: sumOf(rows.map(x => x.persistentStorageQuantity * x.count))
  };
}

export function isPersistentStorage(storage: v1beta2.Storage | v1beta3.Storage | v1beta4.Storage): boolean {
  return (storage.attributes || []).some(a => a.key === "persistent" && a.value === "true");
}

export function getGPUAttributes(gpu: v1beta3.GPU | v1beta4.GPU | undefined): { vendor: string | null; model: string | null } {
  if (!gpu || !gpu.attributes || gpu.attributes.length !== 1) return { vendor: null, model: null };

  const attr = gpu.attributes[0];

  if (attr.value !== "true") return { vendor: null, model: null };

  const regex = /^vendor\/(.*)\/model\/(.*)$/;
  const match = attr.key.match(regex);

  if (!match) return { vendor: null, model: null };

  const vendor = match[1];
  const model = match[2] != "*" ? match[2] : null;

  return { vendor, model };
}

function storageQuantityOf(storage: v1beta4.Storage[]): number {
  return sumOf(storage.map(x => Number(x.quantity?.val ?? 0)));
}

function sumOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}
