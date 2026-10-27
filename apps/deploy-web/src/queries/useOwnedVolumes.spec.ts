import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { DeploymentDto, LeaseDto } from "@src/types/deployment";
import { deploymentToDto } from "@src/utils/deploymentDetailUtils";
import type { DEPENDENCIES } from "./useOwnedVolumes";
import { ownedVolumesOf, useOwnedVolumes, volumeKeyOf } from "./useOwnedVolumes";

import { renderHook } from "@testing-library/react";
import { buildRpcDeployment } from "@tests/seeders";

const OWNER = "akash1owner";
const PROVIDER = "akash1provider";

describe("useOwnedVolumes", () => {
  describe(ownedVolumesOf.name, () => {
    it("reads a volume off its own deployment, with its size, class and the provider holding its lease", () => {
      expect(ownedVolumesOf([buildVolumeDeployment("100")], [buildLease({ dseq: "100" })])).toEqual([
        { name: "data", owner: OWNER, dseq: "100", sizeBytes: 1_073_741_824, storageClass: "beta3", provider: PROVIDER, mountedBy: undefined }
      ]);
    });

    it("names the deployment that mounts a volume already", () => {
      const [volume] = ownedVolumesOf([buildVolumeDeployment("100"), buildMountingDeployment("200", "100")], [buildLease({ dseq: "100" })]);

      expect(volume.mountedBy).toBe("200");
    });

    it.each([
      { case: "holds no lease", leases: [] },
      { case: "holds only a lease that is not active", leases: [buildLease({ dseq: "100", state: "reclaiming" })] },
      { case: "shares no dseq with a lease", leases: [buildLease({ dseq: "999" })] }
    ])("reads no provider for a volume that $case", ({ leases }) => {
      const [volume] = ownedVolumesOf([buildVolumeDeployment("100")], leases);

      expect(volume.provider).toBeUndefined();
    });

    it("leaves out a deployment that runs a workload", () => {
      expect(ownedVolumesOf([buildMountingDeployment("200", "100")], [])).toEqual([]);
    });
  });

  describe("useOwnedVolumes", () => {
    it("reads the wallet's open deployments and active leases", () => {
      const { useDeploymentList, useAllLeases } = setup({});

      expect(useDeploymentList).toHaveBeenCalledWith(OWNER, {}, "active");
      expect(useAllLeases).toHaveBeenCalledWith(OWNER, { state: "active" });
    });

    it("lists the volumes once both have loaded", () => {
      const { result } = setup({ deployments: [buildVolumeDeployment("100")], leases: [buildLease({ dseq: "100" })] });

      expect(result.current).toEqual({ volumes: [expect.objectContaining({ dseq: "100", provider: PROVIDER })], isLoading: false });
    });

    it.each([
      { case: "the deployments", input: { isLoadingDeployments: true } },
      { case: "the leases", input: { isLoadingLeases: true } }
    ])("reports loading while $case load", ({ input }) => {
      const { result } = setup(input);

      expect(result.current.isLoading).toBe(true);
    });

    function setup(input: { deployments?: DeploymentDto[]; leases?: LeaseDto[]; isLoadingDeployments?: boolean; isLoadingLeases?: boolean }) {
      const deploymentList = Object.assign(mock<ReturnType<typeof DEPENDENCIES.useDeploymentList>>({ isLoading: !!input.isLoadingDeployments }), {
        data: input.deployments
      });
      const leaseList = Object.assign(mock<ReturnType<typeof DEPENDENCIES.useAllLeases>>({ isLoading: !!input.isLoadingLeases }), { data: input.leases });
      const useDeploymentList = vi.fn(() => deploymentList);
      const useAllLeases = vi.fn(() => leaseList);
      const dependencies = {
        useWallet: () => mock<ReturnType<typeof DEPENDENCIES.useWallet>>({ address: OWNER }),
        useDeploymentList: useDeploymentList as unknown as typeof DEPENDENCIES.useDeploymentList,
        useAllLeases: useAllLeases as unknown as typeof DEPENDENCIES.useAllLeases
      };

      const { result } = renderHook(() => useOwnedVolumes(dependencies));

      return { result, useDeploymentList, useAllLeases };
    }
  });

  it("keys a volume by its owner and dseq", () => {
    expect(volumeKeyOf({ owner: OWNER, dseq: "100" })).toBe(`${OWNER}/100`);
    expect(volumeKeyOf({ dseq: "100" })).toBe("/100");
  });

  function buildVolumeDeployment(dseq: string): DeploymentDto {
    return deploymentToDto(
      buildRpcDeployment({
        deployment: { id: { owner: OWNER, dseq } },
        groups: [
          {
            group_spec: {
              volume: { vid: "data" },
              resources: [
                {
                  resource: {
                    storage: [
                      {
                        name: "data",
                        quantity: { val: "1073741824" },
                        attributes: [
                          { key: "class", value: "beta3" },
                          { key: "persistent", value: "true" }
                        ]
                      }
                    ]
                  }
                }
              ]
            }
          }
        ]
      })
    );
  }

  function buildMountingDeployment(dseq: string, volumeDseq: string): DeploymentDto {
    return deploymentToDto(
      buildRpcDeployment({
        deployment: { id: { owner: OWNER, dseq } },
        groups: [{ group_spec: { resources: [{ volumes: [{ owner: OWNER, dseq: volumeDseq, gseq: 1, name: "data" }] }] } }]
      })
    );
  }

  function buildLease(input: { dseq: string; state?: string }): LeaseDto {
    return mock<LeaseDto>({ dseq: input.dseq, state: input.state ?? "active", provider: PROVIDER });
  }
});
