import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { DeploymentDto, LeaseDto } from "@src/types/deployment";
import { deploymentToDto } from "@src/utils/deploymentDetailUtils";
import type { DEPENDENCIES } from "./useOwnedVolumes";
import { ownedVolumesOf, useOwnedVolumes, volumeKeyOf } from "./useOwnedVolumes";

import { act, renderHook } from "@testing-library/react";
import { buildRpcDeployment } from "@tests/seeders";

const OWNER = "akash1owner";
const PROVIDER = "akash1provider";
const PRICE = { denom: "uact", amount: "1.5" };
const DEADLINE_SECONDS = 1_793_130_012;

describe("useOwnedVolumes", () => {
  describe(ownedVolumesOf.name, () => {
    it("reads a volume off its own deployment, with its size, class, provider and price", () => {
      expect(ownedVolumesOf([buildVolumeDeployment("100")], [buildLease({ dseq: "100" })])).toEqual([
        {
          name: "data",
          owner: OWNER,
          dseq: "100",
          sizeBytes: 1_073_741_824,
          storageClass: "beta3",
          state: "available",
          provider: PROVIDER,
          mountedBy: undefined,
          reclamationDeadline: undefined,
          pricePerBlock: PRICE
        }
      ]);
    });

    it("reads a volume another deployment mounts as mounted by it", () => {
      const [volume] = ownedVolumesOf([buildVolumeDeployment("100"), buildMountingDeployment("200", "100")], [buildLease({ dseq: "100" })]);

      expect(volume).toMatchObject({ state: "mounted", mountedBy: "200" });
    });

    it.each([
      { case: "holds no lease", leases: [] },
      { case: "holds only a closed lease", leases: [buildLease({ dseq: "100", state: "closed" })] },
      { case: "shares no dseq with a lease", leases: [buildLease({ dseq: "999" })] }
    ])("reads a volume that $case as unleased, with no provider or price", ({ leases }) => {
      const [volume] = ownedVolumesOf([buildVolumeDeployment("100")], leases);

      expect(volume).toMatchObject({ state: "unleased", provider: undefined, pricePerBlock: undefined });
    });

    it("reads a volume its owner closed as closing until its reclamation deadline, still on its provider", () => {
      const lease = buildLease({ dseq: "100", state: "reclaiming", reclamation: { reason: "reason_volume_closed_retain", deadline: DEADLINE_SECONDS } });

      const [volume] = ownedVolumesOf([buildVolumeDeployment("100")], [lease]);

      expect(volume).toMatchObject({ state: "closing", provider: PROVIDER, reclamationDeadline: new Date(DEADLINE_SECONDS * 1000) });
    });

    it.each(["reason_volume_evict", "reason_volume_migrate"])("reads a volume reclaimed for %s as reclaiming", reason => {
      const lease = buildLease({ dseq: "100", state: "reclaiming", reclamation: { reason, deadline: DEADLINE_SECONDS } });

      const [volume] = ownedVolumesOf([buildVolumeDeployment("100")], [lease]);

      expect(volume).toMatchObject({ state: "reclaiming", reclamationDeadline: new Date(DEADLINE_SECONDS * 1000) });
    });

    it("reads no deadline for a reclaiming lease the chain gave none", () => {
      const lease = buildLease({ dseq: "100", state: "reclaiming", reclamation: { reason: "reason_volume_evict" } });

      const [volume] = ownedVolumesOf([buildVolumeDeployment("100")], [lease]);

      expect(volume.reclamationDeadline).toBeUndefined();
    });

    it("leaves out a deployment that runs a workload", () => {
      expect(ownedVolumesOf([buildMountingDeployment("200", "100")], [])).toEqual([]);
    });
  });

  describe("useOwnedVolumes", () => {
    it("reads the wallet's open deployments and the leases that still hold a volume", () => {
      const { useDeploymentList, useAllLeases } = setup({});

      expect(useDeploymentList).toHaveBeenCalledWith(OWNER, {}, "active");
      expect(useAllLeases).toHaveBeenCalledWith(OWNER, { state: ["active", "reclaiming"] });
    });

    it("lists the volumes once both have loaded", () => {
      const { result } = setup({ deployments: [buildVolumeDeployment("100")], leases: [buildLease({ dseq: "100" })] });

      expect(result.current).toMatchObject({ volumes: [expect.objectContaining({ dseq: "100", provider: PROVIDER })], isLoading: false, isError: false });
    });

    it.each([
      { case: "the deployments", input: { isLoadingDeployments: true } },
      { case: "the leases", input: { isLoadingLeases: true } }
    ])("reports loading while $case load", ({ input }) => {
      const { result } = setup(input);

      expect(result.current.isLoading).toBe(true);
    });

    it.each([
      { case: "the deployments", input: { isDeploymentsError: true } },
      { case: "the leases", input: { isLeasesError: true } }
    ])("reports an error when $case fail to load", ({ input }) => {
      const { result } = setup(input);

      expect(result.current.isError).toBe(true);
    });

    it("reloads both the deployments and the leases", () => {
      const { result, deploymentList, leaseList } = setup({});

      act(() => result.current.refetch());

      expect(deploymentList.refetch).toHaveBeenCalled();
      expect(leaseList.refetch).toHaveBeenCalled();
    });

    function setup(input: {
      deployments?: DeploymentDto[];
      leases?: LeaseDto[];
      isLoadingDeployments?: boolean;
      isLoadingLeases?: boolean;
      isDeploymentsError?: boolean;
      isLeasesError?: boolean;
    }) {
      const deploymentList = Object.assign(mock<ReturnType<typeof DEPENDENCIES.useDeploymentList>>({ isLoading: !!input.isLoadingDeployments }), {
        data: input.deployments,
        isError: !!input.isDeploymentsError,
        refetch: vi.fn()
      });
      const leaseList = Object.assign(mock<ReturnType<typeof DEPENDENCIES.useAllLeases>>({ isLoading: !!input.isLoadingLeases }), {
        data: input.leases,
        isError: !!input.isLeasesError,
        refetch: vi.fn()
      });
      const useDeploymentList = vi.fn(() => deploymentList);
      const useAllLeases = vi.fn(() => leaseList);
      const dependencies = {
        useWallet: () => mock<ReturnType<typeof DEPENDENCIES.useWallet>>({ address: OWNER }),
        useDeploymentList: useDeploymentList as unknown as typeof DEPENDENCIES.useDeploymentList,
        useAllLeases: useAllLeases as unknown as typeof DEPENDENCIES.useAllLeases
      };

      const { result } = renderHook(() => useOwnedVolumes(dependencies));

      return { result, useDeploymentList, useAllLeases, deploymentList, leaseList };
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

  function buildLease(input: { dseq: string; state?: string; reclamation?: LeaseDto["reclamation"] }): LeaseDto {
    return Object.assign(mock<LeaseDto>(), {
      dseq: input.dseq,
      state: input.state ?? "active",
      provider: PROVIDER,
      price: PRICE,
      reclamation: input.reclamation
    });
  }
});
