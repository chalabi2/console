import { createProxy } from "@akashnetwork/react-query-proxy";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import { QueryKeys } from "./queryKeys";
import { BID_POLL_INTERVAL } from "./useListBids";
import { DEPENDENCIES, useLeaseVolume, useMoveVolume, useVolumeBids } from "./useVolumeMoveQueries";

import { act } from "@testing-library/react";
import { type RenderAppHookOptions, setupQuery } from "@tests/unit/query-client";

type ApiService = ReturnType<NonNullable<NonNullable<RenderAppHookOptions["services"]>["api"]>>;

const OWNER = "akash1owner";
const VOLUME_LIST_KEY = QueryKeys.getDeploymentListKey(OWNER, "active");
const LIVE_LEASES_KEY = QueryKeys.getAllLeasesKey(OWNER, ["active", "reclaiming"]);
const UNRELATED_KEY = QueryKeys.getBucketInfoKey("100", 1, 1);

describe("useVolumeMoveQueries", () => {
  describe(useMoveVolume.name, () => {
    it("asks for the volume's move and reloads the wallet's volumes", async () => {
      const { result, moveVolume, queryClient } = setup({ useHook: dependencies => useMoveVolume(dependencies) });

      await act(() => result.current.mutateAsync({ dseq: "100" }));

      expect(moveVolume).toHaveBeenCalledWith({ dseq: "100" });
      expect(queryClient.getQueryState(VOLUME_LIST_KEY)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(LIVE_LEASES_KEY)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(UNRELATED_KEY)?.isInvalidated).toBe(false);
    });

    it("reloads nothing when the move is refused", async () => {
      const { result, queryClient } = setup({ moveRejection: new Error("refused"), useHook: dependencies => useMoveVolume(dependencies) });

      await act(() => result.current.mutateAsync({ dseq: "100" }).catch(() => undefined));

      expect(queryClient.getQueryState(VOLUME_LIST_KEY)?.isInvalidated).toBe(false);
    });
  });

  describe(useLeaseVolume.name, () => {
    it("leases the volume and reloads the wallet's volumes", async () => {
      const { result, createLease, queryClient } = setup({ useHook: dependencies => useLeaseVolume(dependencies) });
      const leases = [{ dseq: "100", gseq: 1, oseq: 2, provider: "akash1provider" }];

      await act(() => result.current.mutateAsync({ leases }));

      expect(createLease).toHaveBeenCalledWith({ leases });
      expect(queryClient.getQueryState(VOLUME_LIST_KEY)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(LIVE_LEASES_KEY)?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(UNRELATED_KEY)?.isInvalidated).toBe(false);
    });
  });

  describe(useVolumeBids.name, () => {
    it("polls the bids on the volume's order", () => {
      const { useListBids } = setup({ useHook: dependencies => useVolumeBids("100", dependencies) });

      expect(useListBids).toHaveBeenCalledWith("100", { refetchInterval: BID_POLL_INTERVAL });
    });

    it("lists each open bid with the order it bids on and its price", () => {
      const { result } = setup({
        bids: [bid({ provider: "akash1meridian", oseq: 2, amount: "1.5" }), bid({ provider: "akash1northwind", oseq: 2, amount: "2", state: "closed" })],
        useHook: dependencies => useVolumeBids("100", dependencies)
      });

      expect(result.current).toEqual([{ provider: "akash1meridian", gseq: 1, oseq: 2, perBlockAmount: "1.5", denom: "uact" }]);
    });

    it("has no bids before they load", () => {
      const { result } = setup({ useHook: dependencies => useVolumeBids("100", dependencies) });

      expect(result.current).toEqual([]);
    });
  });

  function bid(input: { provider: string; oseq: number; amount: string; state?: string }) {
    return {
      bid: {
        id: { owner: OWNER, dseq: "100", gseq: 1, oseq: input.oseq, provider: input.provider, bseq: 0 },
        state: input.state ?? "open",
        price: { denom: "uact", amount: input.amount }
      }
    };
  }

  function setup<T>(input: { useHook: (dependencies: typeof DEPENDENCIES) => T; bids?: ReturnType<typeof bid>[]; moveRejection?: Error }) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(VOLUME_LIST_KEY, []);
    queryClient.setQueryData(LIVE_LEASES_KEY, []);
    queryClient.setQueryData(UNRELATED_KEY, {});
    const moveVolume = vi.fn(input.moveRejection ? () => Promise.reject(input.moveRejection) : () => Promise.resolve({ data: { success: true } }));
    const createLease = vi.fn().mockResolvedValue({ data: {} });
    const api = createProxy({ v1: { moveVolume, createLease } }) as unknown as ApiService;
    const useListBids = vi.fn((..._args: Parameters<typeof DEPENDENCIES.useListBids>) =>
      mock<ReturnType<typeof DEPENDENCIES.useListBids>>({ data: input.bids ? { data: input.bids } : undefined })
    );
    const dependencies = {
      ...DEPENDENCIES,
      useWallet: () => mock<ReturnType<typeof DEPENDENCIES.useWallet>>({ address: OWNER }),
      useListBids: useListBids as typeof DEPENDENCIES.useListBids
    };

    const { result } = setupQuery(() => input.useHook(dependencies), { services: { api: () => api, queryClient: () => queryClient } });

    return { result, queryClient, moveVolume, createLease, useListBids };
  }
});
