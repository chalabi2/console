import type { SDLInput } from "@akashnetwork/chain-sdk";
import { generateManifest } from "@akashnetwork/chain-sdk";
import { Endpoint_Kind, GroupSpec, ResourceUnit } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import type { DeploymentInfo } from "@akashnetwork/http-sdk";
import { describe, expect, it } from "vitest";

import type { SdlManifest } from "@src/deployment/services/sdl/sdl.service";
import { resourceChangeOf, volumeSizeOf } from "./lease-resize-plan";

describe(resourceChangeOf.name, () => {
  const GI = 1024n ** 3n;
  const VOLUME_REF = { owner: "akash1owner", dseq: 1200n, gseq: 1, name: "pg-data" };

  it("finds no change when the SDL declares the resources the deployment holds", () => {
    expect(resourceChangeOf(groupSpecsOf(sdl()), [onChainGroup()])).toEqual({ kind: "unchanged" });
  });

  it.each([
    { change: "cpu", apply: (input: SDLInput) => (input.profiles.compute.web.resources.cpu.units = 4) },
    { change: "memory", apply: (input: SDLInput) => (input.profiles.compute.web.resources.memory.size = "4096Mi") },
    { change: "ephemeral storage", apply: (input: SDLInput) => (input.profiles.compute.web.resources.storage = [{ size: "8192Mi" }]) },
    { change: "replica count", apply: (input: SDLInput) => (input.deployment.web.dcloud.count = 3) }
  ])("plans a resize of the group to the SDL's units when it changes its $change", ({ apply }) => {
    const resized = sdl();
    apply(resized);
    const [group] = groupSpecsOf(resized);

    expect(resourceChangeOf([group], [onChainGroup({ gseq: 7 })])).toEqual({
      kind: "resize",
      plan: { gseq: 7, groupName: "dcloud", resources: group.resources }
    });
  });

  it("carries the SDL's new price ceiling with the resized units", () => {
    const resized = sdl();
    resized.profiles.compute.web.resources.cpu.units = 4;
    resized.profiles.placement.dcloud.pricing.web = { denom: "uact", amount: 30000 };

    const change = resourceChangeOf(groupSpecsOf(resized), [onChainGroup()]);

    expect(change).toMatchObject({ kind: "resize", plan: { resources: [{ price: { denom: "uact", amount: "30000" } }] } });
  });

  it("reports a group the SDL adds as a change of groups", () => {
    const renamed = sdl();
    renamed.profiles.placement = { westcoast: renamed.profiles.placement.dcloud };
    renamed.deployment.web = { westcoast: renamed.deployment.web.dcloud };

    expect(resourceChangeOf(groupSpecsOf(renamed), [onChainGroup()])).toEqual({ kind: "groups-changed", groupName: "westcoast" });
  });

  it("reports a group the SDL drops as a change of groups", () => {
    const dropped = onChainGroup({ name: "westcoast", gseq: 2 });

    expect(resourceChangeOf(groupSpecsOf(sdl()), [onChainGroup(), dropped])).toEqual({ kind: "groups-changed", groupName: "westcoast" });
  });

  it("names every group it changes when it changes more than one", () => {
    const twoGroups = sdlWithWorkerIn("westcoast");
    twoGroups.profiles.compute.web.resources.cpu.units = 4;
    twoGroups.profiles.compute.worker.resources.cpu.units = 4;

    expect(resourceChangeOf(groupSpecsOf(twoGroups), [onChainGroup(), workerGroupIn("westcoast")])).toEqual({
      kind: "several-groups",
      groupNames: ["dcloud", "westcoast"]
    });
  });

  it("resizes the one group it changes and leaves the other alone", () => {
    const twoGroups = sdlWithWorkerIn("westcoast");
    twoGroups.profiles.compute.worker.resources.cpu.units = 4;

    expect(resourceChangeOf(groupSpecsOf(twoGroups), [onChainGroup(), workerGroupIn("westcoast")])).toMatchObject({
      kind: "resize",
      plan: { gseq: 2, groupName: "westcoast" }
    });
  });

  it.each([
    {
      reason: "it adds or removes a compute profile",
      apply: (input: SDLInput) => {
        input.services.worker = { image: "ghcr.io/example/worker:1.0.0" };
        input.profiles.compute.worker = { resources: { cpu: { units: 1 }, memory: { size: "512Mi" }, storage: [{ size: "1Gi" }] } };
        input.profiles.placement.dcloud.pricing.worker = { denom: "uact", amount: 1000 };
        input.deployment.worker = { dcloud: { profile: "worker", count: 1 } };
      }
    },
    {
      reason: "it adds or removes GPUs",
      apply: (input: SDLInput) => (input.profiles.compute.web.resources.gpu = { units: 1, attributes: { vendor: { nvidia: [{ model: "h100" }] } } })
    },
    {
      reason: "it adds, removes or changes a globally exposed port",
      apply: (input: SDLInput) => input.services.web.expose!.push({ port: 9000, as: 9000, to: [{ global: true }] })
    },
    {
      reason: "it adds or removes a storage volume",
      apply: (input: SDLInput) => (input.profiles.compute.web.resources.storage = [{ size: "4096Mi" }, { name: "data", size: "1Gi" }])
    },
    {
      reason: "it changes the CPU architecture or another CPU attribute",
      apply: (input: SDLInput) => (input.profiles.compute.web.resources.cpu = { units: 4, attributes: { arch: "arm64" } })
    },
    {
      reason: "it changes the currency its price is set in",
      apply: (input: SDLInput) => {
        input.profiles.compute.web.resources.cpu.units = 4;
        input.profiles.placement.dcloud.pricing.web = { denom: "uakt", amount: 10000 };
      }
    }
  ])("refuses a change no running lease can be resized to: $reason", ({ reason, apply }) => {
    const changed = sdl();
    apply(changed);

    expect(resourceChangeOf(groupSpecsOf(changed), [onChainGroup()])).toEqual({ kind: "unresizable", groupName: "dcloud", reason });
  });

  it("refuses a resize that changes the size of persistent storage", () => {
    const changed = sdlWithPersistentStorage("20Gi");
    changed.profiles.compute.web.resources.cpu.units = 4;

    expect(resourceChangeOf(groupSpecsOf(changed), [onChainGroupWithPersistentStorage()])).toEqual({
      kind: "unresizable",
      groupName: "dcloud",
      reason: 'it changes the size of persistent storage volume "data", which keeps the size it was created with'
    });
  });

  it("resizes compute beside persistent storage that keeps its size", () => {
    const changed = sdlWithPersistentStorage("10Gi");
    changed.profiles.compute.web.resources.cpu.units = 4;

    expect(resourceChangeOf(groupSpecsOf(changed), [onChainGroupWithPersistentStorage()])).toMatchObject({ kind: "resize" });
  });

  it("refuses a resize that changes a storage volume's class", () => {
    const changed = sdlWithPersistentStorage("10Gi", "beta3");

    expect(resourceChangeOf(groupSpecsOf(changed), [onChainGroupWithPersistentStorage()])).toEqual({
      kind: "unresizable",
      groupName: "dcloud",
      reason: 'it changes the class or persistence of storage volume "data"'
    });
  });

  it.each([
    { reason: "it removes CPU or memory", apply: (unit: ResourceUnit) => (unit.resource!.cpu = undefined) },
    { reason: "it removes CPU or memory", apply: (unit: ResourceUnit) => (unit.resource!.memory = undefined) },
    { reason: "it changes a memory attribute", apply: (unit: ResourceUnit) => (unit.resource!.memory!.attributes = [{ key: "class", value: "ecc" }]) },
    { reason: 'it renames storage volume "default"', apply: (unit: ResourceUnit) => (unit.resource!.storage[0].name = "scratch") },
    { reason: "it changes the volumes a service mounts", apply: (unit: ResourceUnit) => (unit.volumes = [VOLUME_REF]) },
    { reason: "it changes the volumes a service mounts", apply: (unit: ResourceUnit) => (unit.volumes = []), mounting: true },
    { reason: "it changes the volumes a service mounts", apply: (unit: ResourceUnit) => (unit.volumes = [{ ...VOLUME_REF, name: "other" }]), mounting: true },
    { reason: "it adds, removes or changes a globally exposed port", apply: (unit: ResourceUnit) => (unit.resource!.endpoints[0].sequenceNumber = 1) },
    {
      reason: "it adds, removes or changes a globally exposed port",
      apply: (unit: ResourceUnit) => (unit.resource!.endpoints[0].kind = Endpoint_Kind.RANDOM_PORT)
    },
    { reason: "it adds or removes a compute profile", apply: (unit: ResourceUnit) => (unit.resource!.id = 2) }
  ])("refuses a resized unit when $reason", ({ reason, apply, mounting }) => {
    const held = mounting ? withVolumesMounted(groupSpecOf(sdl())) : groupSpecOf(sdl());
    const next = withMoreCpu(held);
    apply(next.resources[0]);

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toEqual({ kind: "unresizable", groupName: "dcloud", reason });
  });

  it("refuses a resize of the one unit of a group that breaks a rule, though another unit resizes cleanly", () => {
    const held = groupSpecOf(sdlWithWorkerBesideWeb());
    const next = withMoreCpu(held);
    next.resources[1].resource!.memory!.attributes = [{ key: "class", value: "ecc" }];

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toEqual({ kind: "unresizable", groupName: "dcloud", reason: "it changes a memory attribute" });
  });

  it("keeps the replica count of a unit that mounts a volume", () => {
    const held = withVolumesMounted(groupSpecOf(sdl()));
    const next = structuredClone(held);
    next.resources[0].count = 2;

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toEqual({
      kind: "unresizable",
      groupName: "dcloud",
      reason: "it changes the replica count of a service that mounts a volume"
    });
  });

  it.each([{ owner: "akash1other" }, { dseq: 1201n }, { gseq: 2 }, { name: "other" }])(
    "refuses a unit that mounts another volume, differing by %o",
    difference => {
      const held = withVolumesMounted(groupSpecOf(sdl()));
      const next = withMoreCpu(held);
      next.resources[0].volumes = [{ ...VOLUME_REF, ...difference }];

      expect(resourceChangeOf([next], [onChainGroupOf(held)])).toEqual({
        kind: "unresizable",
        groupName: "dcloud",
        reason: "it changes the volumes a service mounts"
      });
    }
  );

  it("resizes ephemeral storage that an attribute marks as not persistent", () => {
    const held = groupSpecOf(sdl());
    held.resources[0].resource!.storage[0].attributes = [{ key: "persistent", value: "false" }];
    const next = structuredClone(held);
    next.resources[0].resource!.storage[0].quantity!.val = 8n * GI;

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toMatchObject({ kind: "resize" });
  });

  it("resizes the compute of a volume group whose volume keeps its size", () => {
    const held = GroupSpec.fromPartial({ ...groupSpecOf(sdlWithPersistentStorage("10Gi")), volume: { vid: "pg-data" } });

    expect(resourceChangeOf([withMoreCpu(held)], [onChainGroupOf(held)])).toMatchObject({ kind: "resize" });
  });

  it("records no volume size in the plan of a group that leases no volume", () => {
    const resized = sdl();
    resized.profiles.compute.web.resources.cpu.units = 4;

    expect(resourceChangeOf(groupSpecsOf(resized), [onChainGroup()])).toEqual({
      kind: "resize",
      plan: expect.not.objectContaining({ volumeSize: expect.anything() })
    });
  });

  it("resizes the compute of a unit that keeps mounting the same volumes", () => {
    const held = withVolumesMounted(groupSpecOf(sdl()));

    expect(resourceChangeOf([withMoreCpu(held)], [onChainGroupOf(held)])).toMatchObject({ kind: "resize" });
  });

  it("resizes the GPUs of a unit that already holds some", () => {
    const held = groupSpecOf(sdlWithGpu("h100"));
    const next = structuredClone(held);
    next.resources[0].resource!.gpu!.units!.val = 2n;

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toMatchObject({ kind: "resize" });
  });

  it("refuses a resize that changes the model of the GPUs a unit holds", () => {
    const held = groupSpecOf(sdlWithGpu("h100"));
    const [next] = groupSpecsOf(sdlWithGpu("a100"));

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toEqual({
      kind: "unresizable",
      groupName: "dcloud",
      reason: "it changes the GPU model or another GPU attribute"
    });
  });

  it("leaves the GPU attributes of a unit holding no GPUs to the provider, as the chain does", () => {
    const held = groupSpecOf(sdl());
    const next = withMoreCpu(held);
    next.resources[0].resource!.gpu!.attributes = [{ key: "vendor/nvidia/model/h100", value: "true" }];

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toMatchObject({ kind: "resize" });
  });

  it.each([
    { change: "grows", size: 20n * GI, expected: { kind: "resize", plan: { volumeSize: 20n * GI } } },
    { change: "shrinks", size: 5n * GI, expected: { kind: "unresizable", reason: 'it shrinks volume "data", which can only grow' } }
  ])("lets the volume of a volume group grow but never shrink: it $change", ({ size, expected }) => {
    const held = GroupSpec.fromPartial({ ...groupSpecOf(sdlWithPersistentStorage("10Gi")), volume: { vid: "pg-data" } });
    const next = structuredClone(held);
    next.resources[0].resource!.storage[1].quantity!.val = size;

    expect(resourceChangeOf([next], [onChainGroupOf(held)])).toMatchObject(expected);
  });

  function groupSpecOf(input: SDLInput): GroupSpec {
    const [group] = groupSpecsOf(input);

    return group;
  }

  function withMoreCpu(group: GroupSpec): GroupSpec {
    const next = structuredClone(group);
    next.resources[0].resource!.cpu!.units!.val = 4000n;

    return next;
  }

  function withVolumesMounted(group: GroupSpec): GroupSpec {
    const mounting = structuredClone(group);
    mounting.resources[0].volumes = [VOLUME_REF];

    return mounting;
  }

  function onChainGroupOf(group: GroupSpec, gseq = 1): DeploymentInfo["groups"][number] {
    return {
      id: { owner: "akash1owner", dseq: "1234", gseq },
      state: "open",
      created_at: "100",
      group_spec: GroupSpec.toJSON(group) as DeploymentInfo["groups"][number]["group_spec"]
    };
  }

  function sdlWithWorkerBesideWeb(): SDLInput {
    const input = sdl();
    input.services.worker = { image: "ghcr.io/example/worker:1.0.0" };
    input.profiles.compute.worker = { resources: { cpu: { units: 1 }, memory: { size: "512Mi" }, storage: [{ size: "1Gi" }] } };
    input.profiles.placement.dcloud.pricing.worker = { denom: "uact", amount: 1000 };
    input.deployment.worker = { dcloud: { profile: "worker", count: 1 } };

    return input;
  }

  function sdlWithGpu(model: string): SDLInput {
    const input = sdl();
    input.profiles.compute.web.resources.gpu = { units: 1, attributes: { vendor: { nvidia: [{ model }] } } };

    return input;
  }

  function groupSpecsOf(input: SDLInput) {
    const result = generateManifest(input);

    expect(result.ok).toBe(true);

    return (result.value as SdlManifest).groupSpecs;
  }

  function sdl(): SDLInput {
    return {
      version: "2.0",
      services: {
        web: { image: "ghcr.io/example/web:1.0.0", expose: [{ port: 3200, as: 80, to: [{ global: true }] }] }
      },
      profiles: {
        compute: {
          web: { resources: { cpu: { units: 2 }, memory: { size: "2048Mi" }, storage: [{ size: "4096Mi" }] } }
        },
        placement: {
          dcloud: { pricing: { web: { denom: "uact", amount: 10000 } } }
        }
      },
      deployment: { web: { dcloud: { profile: "web", count: 1 } } }
    };
  }

  function sdlWithWorkerIn(placement: string): SDLInput {
    const input = sdl();
    input.services.worker = { image: "ghcr.io/example/worker:1.0.0" };
    input.profiles.compute.worker = { resources: { cpu: { units: 1 }, memory: { size: "512Mi" }, storage: [{ size: "1Gi" }] } };
    input.profiles.placement[placement] = { pricing: { worker: { denom: "uact", amount: 1000 } } };
    input.deployment.worker = { [placement]: { profile: "worker", count: 1 } };

    return input;
  }

  function sdlWithPersistentStorage(size: string, storageClass = "beta2"): SDLInput {
    const input = sdl();
    input.services.web.params = { storage: { data: { mount: "/data" } } };
    input.profiles.compute.web.resources.storage = [{ size: "4096Mi" }, { name: "data", size, attributes: { persistent: true, class: storageClass } }];

    return input;
  }

  function onChainGroup({ name = "dcloud", gseq = 1 }: { name?: string; gseq?: number } = {}): DeploymentInfo["groups"][number] {
    return {
      id: { owner: "akash1owner", dseq: "1234", gseq },
      state: "open",
      created_at: "100",
      group_spec: {
        name,
        requirements: { signed_by: { all_of: [], any_of: [] }, attributes: [] },
        resources: [
          {
            resource: {
              id: 1,
              cpu: { units: { val: "2000" }, attributes: [] },
              memory: { quantity: { val: "2147483648" }, attributes: [] },
              storage: [{ name: "default", quantity: { val: "4294967296" }, attributes: [] }],
              gpu: { units: { val: "0" }, attributes: [] },
              endpoints: [{ kind: "SHARED_HTTP", sequence_number: 0 }]
            },
            count: 1,
            price: { denom: "uact", amount: "10000.000000000000000000" }
          }
        ]
      }
    };
  }

  function workerGroupIn(placement: string): DeploymentInfo["groups"][number] {
    const group = onChainGroup({ name: placement, gseq: 2 });
    const [unit] = group.group_spec.resources;
    unit.resource.cpu.units.val = "1000";
    unit.resource.memory.quantity.val = "536870912";
    unit.resource.storage[0].quantity.val = "1073741824";
    unit.resource.endpoints = [];
    unit.price = { denom: "uact", amount: "1000.000000000000000000" };

    return group;
  }

  function onChainGroupWithPersistentStorage(): DeploymentInfo["groups"][number] {
    const group = onChainGroup();
    group.group_spec.resources[0].resource.storage.push({
      name: "data",
      quantity: { val: "10737418240" },
      attributes: [
        { key: "class", value: "beta2" },
        { key: "persistent", value: "true" }
      ]
    });

    return group;
  }
});

describe(volumeSizeOf.name, () => {
  const PERSISTENT = [{ key: "persistent", value: "true" }];

  it("reads the size of the persistent storage entry, the volume itself", () => {
    const resources = [
      unitWith([
        { name: "scratch", quantity: { val: 5n }, attributes: [] },
        { name: "data", quantity: { val: 10n }, attributes: PERSISTENT }
      ])
    ];

    expect(volumeSizeOf(resources)).toBe(10n);
  });

  it.each([
    { case: "no unit", resources: [] },
    { case: "a unit without resources", resources: [ResourceUnit.fromPartial({ count: 1 })] },
    { case: "no persistent storage entry", resources: [unitWith([{ name: "scratch", quantity: { val: 5n }, attributes: [] }])] },
    { case: "a persistent entry without a quantity", resources: [unitWith([{ name: "data", attributes: PERSISTENT }])] }
  ])("finds no size in $case", ({ resources }) => {
    expect(volumeSizeOf(resources)).toBe(0n);
  });

  function unitWith(storage: Array<{ name: string; quantity?: { val: bigint }; attributes: Array<{ key: string; value: string }> }>): ResourceUnit {
    return ResourceUnit.fromPartial({ resource: { id: 1, storage }, count: 1 });
  }
});
