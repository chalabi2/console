import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

import { isEmptyServicesPatch, servicesPatchBetween } from "./sdlServicesPatch";

describe("sdlServicesPatch", () => {
  describe(servicesPatchBetween.name, () => {
    it("is empty for two identical SDLs", () => {
      const sdl = sdlWith({ web: { image: "nginx:1", env: ["PORT=80"] } });

      const patch = servicesPatchBetween(sdl, sdl);

      expect(patch).toEqual({});
      expect(isEmptyServicesPatch(patch)).toBe(true);
    });

    it("patches a changed image", () => {
      const patch = servicesPatchBetween(sdlWith({ web: { image: "nginx:1" } }), sdlWith({ web: { image: "nginx:2" } }));

      expect(patch).toEqual({ web: { image: "nginx:2" } });
    });

    it("patches added and changed env entries by name and removes the missing ones with null", () => {
      const previous = sdlWith({ web: { image: "nginx", env: ["PORT=80", "MODE=dev", "GONE=1"] } });
      const next = sdlWith({ web: { image: "nginx", env: ["PORT=80", "MODE=prod", "NEW=x"] } });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { env: { MODE: "prod", NEW: "x", GONE: null } } });
    });

    it("carries a secret reference as the patched value, so the api resolves it rather than a typed value", () => {
      const previous = sdlWith({ web: { image: "nginx", env: ["PORT=80"] } });
      const next = sdlWith({ web: { image: "nginx", env: ["PORT=80", "API_KEY=ac-secret://API_KEY"] } });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { env: { API_KEY: "ac-secret://API_KEY" } } });
    });

    it("splits an env entry on its first equals sign only", () => {
      const previous = sdlWith({ web: { image: "nginx", env: [] } });
      const next = sdlWith({ web: { image: "nginx", env: ["URL=postgres://u:p@h/db?a=1"] } });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { env: { URL: "postgres://u:p@h/db?a=1" } } });
    });

    it("leaves a bare env name alone, since it has no value a patch could carry", () => {
      const previous = sdlWith({ web: { image: "nginx", env: ["HOME"] } });
      const next = sdlWith({ web: { image: "nginx", env: ["HOME", "PORT=80"] } });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { env: { PORT: "80" } } });
    });

    it("patches a changed command and args, and clears one that was removed", () => {
      const previous = sdlWith({ web: { image: "nginx", command: ["sh"], args: ["-c", "run"] } });
      const next = sdlWith({ web: { image: "nginx", command: ["bash", "-l"] } });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { command: ["bash", "-l"], args: null } });
    });

    it("patches registry credentials whole when any field changes, and clears them when removed", () => {
      const withCredentials = { image: "nginx", credentials: { host: "ghcr.io", username: "alice", password: "ac-secret://REGISTRY_PASSWORD" } };
      const rotated = { image: "nginx", credentials: { host: "ghcr.io", username: "bob", password: "ac-secret://REGISTRY_PASSWORD" } };

      expect(servicesPatchBetween(sdlWith({ web: withCredentials }), sdlWith({ web: rotated }))).toEqual({
        web: { credentials: { host: "ghcr.io", username: "bob", password: "ac-secret://REGISTRY_PASSWORD" } }
      });
      expect(servicesPatchBetween(sdlWith({ web: withCredentials }), sdlWith({ web: { image: "nginx" } }))).toEqual({ web: { credentials: null } });
    });

    it("ignores a service only one side has, which is structural rather than patchable", () => {
      const previous = sdlWith({ web: { image: "nginx" }, old: { image: "redis" } });
      const next = sdlWith({ web: { image: "nginx" }, added: { image: "postgres" } });

      expect(servicesPatchBetween(previous, next)).toEqual({});
    });

    it("ignores fields outside the manifest-only set", () => {
      const previous = sdlWith({ web: { image: "nginx", params: { storage: { data: { mount: "/data" } } } } });
      const next = sdlWith({ web: { image: "nginx", params: { storage: { data: { mount: "/var/data" } } } } });

      expect(servicesPatchBetween(previous, next)).toEqual({});
    });

    it("moves a container port under the port it declared, pinning the external port it was reached on", () => {
      const previous = sdlWith({ web: { image: "nginx", expose: [{ port: 80, to: [{ global: true }] }] } });
      const next = sdlWith({ web: { image: "nginx", expose: [{ port: 8080, as: 80, to: [{ global: true }] }] } });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { expose: { "80": { port: 8080, as: 80 } } } });
    });

    it("moves only the external port of the endpoint that changed", () => {
      const previous = sdlWith({
        web: {
          image: "nginx",
          expose: [
            { port: 80, as: 80 },
            { port: 3000, as: 3000 }
          ]
        }
      });
      const next = sdlWith({
        web: {
          image: "nginx",
          expose: [
            { port: 80, as: 80 },
            { port: 3000, as: 3001 }
          ]
        }
      });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { expose: { "3000": { as: 3001 } } } });
    });

    it("reads a missing as as the container port, so spelling it out is not a change", () => {
      const previous = sdlWith({ web: { image: "nginx", expose: [{ port: 8080 }] } });
      const next = sdlWith({ web: { image: "nginx", expose: [{ port: 8080, as: 8080 }] } });

      expect(servicesPatchBetween(previous, next)).toEqual({});
    });

    it("leaves every port alone once an endpoint was added or removed, which is structural rather than patchable", () => {
      const previous = sdlWith({ web: { image: "nginx", expose: [{ port: 80, as: 80 }] } });
      const next = sdlWith({
        web: {
          image: "nginx",
          expose: [
            { port: 81, as: 80 },
            { port: 90, as: 90 }
          ]
        }
      });

      expect(servicesPatchBetween(previous, next)).toEqual({});
    });

    it("patches the compute of a service's profile and its instance count, as the api resizes a lease by", () => {
      const previous = sdlWithCompute({ resources: { cpu: { units: 1 }, memory: { size: "1Gi" }, storage: [{ size: "5Gi" }], gpu: { units: 1 } }, count: 1 });
      const next = sdlWithCompute({ resources: { cpu: { units: 2 }, memory: { size: "2Gi" }, storage: [{ size: "10Gi" }], gpu: { units: 2 } }, count: 3 });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { resources: { cpu: 2, memory: "2Gi", ephemeralStorage: "10Gi", gpu: 2 }, count: 3 } });
    });

    it.each([
      { field: "cpu", resources: { cpu: { units: 0.5 } }, expected: { cpu: 0.5 } },
      { field: "memory", resources: { memory: { size: "512Mi" } }, expected: { memory: "512Mi" } },
      { field: "ephemeral storage", resources: { storage: [{ size: "1Gi" }] }, expected: { ephemeralStorage: "1Gi" } }
    ])("patches only the $field that changed", ({ resources, expected }) => {
      const held = { cpu: { units: 1 }, memory: { size: "1Gi" }, storage: [{ size: "5Gi" }] };

      expect(servicesPatchBetween(sdlWithCompute({ resources: held, count: 1 }), sdlWithCompute({ resources: { ...held, ...resources }, count: 1 }))).toEqual({
        web: { resources: expected }
      });
    });

    it.each([true, "true"])("resizes the ephemeral volume beside a persistent one marked %j", persistent => {
      const persistentVolume = { name: "data", size: "10Gi", attributes: { persistent } };
      const previous = sdlWithCompute({ resources: { cpu: { units: 1 }, storage: [persistentVolume, { size: "5Gi" }] }, count: 1 });
      const next = sdlWithCompute({ resources: { cpu: { units: 1 }, storage: [persistentVolume, { size: "8Gi" }] }, count: 1 });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { resources: { ephemeralStorage: "8Gi" } } });
    });

    it.each([
      { field: "cpu", dropped: { memory: { size: "1Gi" }, storage: [{ size: "5Gi" }], gpu: { units: 1 } } },
      { field: "memory", dropped: { cpu: { units: 1 }, storage: [{ size: "5Gi" }], gpu: { units: 1 } } },
      { field: "ephemeral storage", dropped: { cpu: { units: 1 }, memory: { size: "1Gi" }, gpu: { units: 1 } } },
      { field: "gpu", dropped: { cpu: { units: 1 }, memory: { size: "1Gi" }, storage: [{ size: "5Gi" }] } }
    ])("leaves out the $field the next SDL drops, since a resize cannot remove one", ({ dropped }) => {
      const held = { cpu: { units: 1 }, memory: { size: "1Gi" }, storage: [{ size: "5Gi" }], gpu: { units: 1 } };

      expect(servicesPatchBetween(sdlWithCompute({ resources: held, count: 1 }), sdlWithCompute({ resources: dropped, count: 1 }))).toEqual({});
    });

    it("leaves out an instance count the next SDL drops", () => {
      const resources = { cpu: { units: 1 } };
      const next = yaml.dump({
        version: "2.0",
        services: { web: { image: "nginx" } },
        profiles: { compute: { web: { resources } } },
        deployment: { web: { dcloud: { profile: "web" } } }
      });

      expect(servicesPatchBetween(sdlWithCompute({ resources, count: 2 }), next)).toEqual({});
    });

    it("leaves out GPUs whose count stays as it was", () => {
      const resources = { cpu: { units: 1 }, gpu: { units: 2 } };

      expect(
        servicesPatchBetween(sdlWithCompute({ resources, count: 1 }), sdlWithCompute({ resources: { ...resources, cpu: { units: 2 } }, count: 1 }))
      ).toEqual({
        web: { resources: { cpu: 2 } }
      });
    });

    it.each([
      { spelled: "a quoted number", units: ["1", "2"], expected: { web: { resources: { cpu: 2 } } } },
      { spelled: "blanks", units: [1, "  "], expected: {} },
      { spelled: "millicores", units: [1, "500m"], expected: {} }
    ])("reads cpu units spelled as $spelled", ({ units: [previousUnits, nextUnits], expected }) => {
      const previous = sdlWithCompute({ resources: { cpu: { units: previousUnits } }, count: 1 });
      const next = sdlWithCompute({ resources: { cpu: { units: nextUnits } }, count: 1 });

      expect(servicesPatchBetween(previous, next)).toEqual(expected);
    });

    it.each([
      { spelled: "a bare byte count", size: 2147483648, expected: { web: { resources: { memory: "2147483648" } } } },
      { spelled: "something that is not a size", size: { gi: 2 }, expected: {} }
    ])("reads a memory size spelled as $spelled", ({ size, expected }) => {
      const previous = sdlWithCompute({ resources: { memory: { size: "1Gi" } }, count: 1 });
      const next = sdlWithCompute({ resources: { memory: { size } }, count: 1 });

      expect(servicesPatchBetween(previous, next)).toEqual(expected);
    });

    it("reads ephemeral storage declared as a single volume rather than a list", () => {
      const previous = sdlWithCompute({ resources: { storage: { size: "5Gi" } }, count: 1 });
      const next = sdlWithCompute({ resources: { storage: { size: "8Gi" } }, count: 1 });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { resources: { ephemeralStorage: "8Gi" } } });
    });

    it("skips storage entries that are not volumes when finding the ephemeral one", () => {
      const previous = sdlWithCompute({ resources: { storage: ["scratch", null, { size: "5Gi" }] }, count: 1 });
      const next = sdlWithCompute({ resources: { storage: ["scratch", null, { size: "8Gi" }] }, count: 1 });

      expect(servicesPatchBetween(previous, next)).toEqual({ web: { resources: { ephemeralStorage: "8Gi" } } });
    });

    it("leaves ephemeral storage alone when the profile declares more than one ephemeral volume", () => {
      const previous = sdlWithCompute({ resources: { storage: [{ size: "5Gi" }, { name: "cache", size: "1Gi" }] }, count: 1 });
      const next = sdlWithCompute({ resources: { storage: [{ size: "8Gi" }, { name: "cache", size: "1Gi" }] }, count: 1 });

      expect(servicesPatchBetween(previous, next)).toEqual({});
    });

    it("leaves the compute of a service placed more than once to a full update", () => {
      const twice = (units: number) =>
        yaml.dump({
          version: "2.0",
          services: { web: { image: "nginx" } },
          profiles: { compute: { web: { resources: { cpu: { units } } } } },
          deployment: { web: { east: { profile: "web", count: 1 }, west: { profile: "web", count: 1 } } }
        });

      expect(servicesPatchBetween(twice(1), twice(2))).toEqual({});
    });

    it("is empty when either SDL does not parse", () => {
      expect(servicesPatchBetween("not: [valid", sdlWith({ web: { image: "nginx" } }))).toEqual({});
      expect(servicesPatchBetween(sdlWith({ web: { image: "nginx" } }), "not: [valid")).toEqual({});
    });
  });

  function sdlWith(services: Record<string, Record<string, unknown>>): string {
    return yaml.dump({ version: "2.0", services });
  }

  function sdlWithCompute({ resources, count }: { resources: Record<string, unknown>; count: number }): string {
    return yaml.dump({
      version: "2.0",
      services: { web: { image: "nginx" } },
      profiles: { compute: { web: { resources } } },
      deployment: { web: { dcloud: { profile: "web", count } } }
    });
  }
});
