import { ApiError } from "@akashnetwork/openapi-sdk";
import { describe, expect, it, vi } from "vitest";
import { mock, mockDeep } from "vitest-mock-extended";

import type { AppDIContainer } from "@src/context/ServicesProvider/ServicesProvider";
import type { DEPENDENCIES } from "./useCreateVolume";
import { useCreateVolume } from "./useCreateVolume";

import { act, renderHook } from "@testing-library/react";

const OWNER = "akash1owner";
const DSEQ = "1793120236298";
const SDL = 'version: "2.2"\n';

describe(useCreateVolume.name, () => {
  it("starts with a volume to describe", () => {
    const { result } = setup({});

    expect(result.current.step).toEqual({ kind: "editing" });
  });

  it("creates the volume's own deployment and waits for providers to bid on it", async () => {
    const { result, createDeployment, useListBids } = setup({});

    await act(() => result.current.create({ name: "data", sdl: SDL }));

    expect(createDeployment).toHaveBeenCalledWith({ data: { sdl: SDL, name: "data", deposit: 0.5 } });
    expect(result.current.step).toEqual({ kind: "choosing", dseq: DSEQ });
    expect(useListBids).toHaveBeenLastCalledWith(DSEQ, { refetchInterval: 2000 });
  });

  it("asks for no bids before the volume's deployment exists", () => {
    const { useListBids } = setup({});

    expect(useListBids).toHaveBeenLastCalledWith(undefined, { refetchInterval: 2000 });
  });

  it.each([
    { case: "the api's reason", failure: new ApiError(400, { message: "volume name in use" }, "POST /v1/deployments → 400"), message: "volume name in use" },
    { case: "a general reason when the api gives none", failure: new Error("network down"), message: "The volume could not be created. Try again in a moment." }
  ])("goes back to the description with $case when the create fails", async ({ failure, message }) => {
    const { result } = setup({ createFailure: failure });

    await act(() => result.current.create({ name: "data", sdl: SDL }));

    expect(result.current.step).toEqual({ kind: "editing", error: message });
  });

  it("offers the open bids of the volume's deployment", async () => {
    const { result } = setup({
      bids: [
        { provider: "akash1a", state: "open", amount: "1.5", denom: "uact" },
        { provider: "akash1b", state: "closed", amount: "1", denom: "uact" }
      ]
    });

    await act(() => result.current.create({ name: "data", sdl: SDL }));

    expect(result.current.bids).toEqual([{ provider: "akash1a", perBlockAmount: "1.5", denom: "uact" }]);
  });

  it("leases the volume from the provider chosen and refreshes the wallet's volumes", async () => {
    const { result, createLease, queryClient } = setup({});
    await act(() => result.current.create({ name: "data", sdl: SDL }));

    let leased: string | undefined;
    await act(async () => {
      leased = await result.current.lease("akash1provider");
    });

    expect(createLease).toHaveBeenCalledWith({ leases: [{ dseq: DSEQ, gseq: 1, oseq: 1, provider: "akash1provider" }] });
    expect(leased).toBe(DSEQ);
    expect(result.current.step).toEqual({ kind: "editing" });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["DEPLOYMENT_LIST", OWNER] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["ALL_LEASES", OWNER] });
  });

  it("keeps the providers on offer with the reason a lease failed", async () => {
    const { result } = setup({ leaseFailure: new Error("provider gone") });
    await act(() => result.current.create({ name: "data", sdl: SDL }));

    let leased: string | undefined = "not called";
    await act(async () => {
      leased = await result.current.lease("akash1provider");
    });

    expect(leased).toBeUndefined();
    expect(result.current.step).toEqual({
      kind: "choosing",
      dseq: DSEQ,
      error: "The volume could not be leased from this provider. Choose another or try again."
    });
  });

  it("leases nothing before the volume's deployment exists", async () => {
    const { result, createLease } = setup({});

    await act(async () => {
      await result.current.lease("akash1provider");
    });

    expect(createLease).not.toHaveBeenCalled();
  });

  it("closes the volume's deployment when it is abandoned before its lease", async () => {
    const { result, closeDeployment } = setup({});
    await act(() => result.current.create({ name: "data", sdl: SDL }));

    await act(() => result.current.abandon());

    expect(closeDeployment).toHaveBeenCalledWith({ dseq: DSEQ });
    expect(result.current.step).toEqual({ kind: "editing" });
  });

  it("starts over even when closing the abandoned deployment fails", async () => {
    const { result } = setup({ closeFailure: new Error("chain down") });
    await act(() => result.current.create({ name: "data", sdl: SDL }));

    await act(() => result.current.abandon());

    expect(result.current.step).toEqual({ kind: "editing" });
  });

  it("closes nothing when abandoned before a deployment exists", async () => {
    const { result, closeDeployment } = setup({});

    await act(() => result.current.abandon());

    expect(closeDeployment).not.toHaveBeenCalled();
  });

  function setup(input: {
    createFailure?: Error;
    leaseFailure?: Error;
    closeFailure?: Error;
    bids?: Array<{ provider: string; state: string; amount: string; denom: string }>;
  }) {
    const createDeployment = vi.fn(() => (input.createFailure ? Promise.reject(input.createFailure) : Promise.resolve({ data: { dseq: DSEQ, manifest: "" } })));
    const createLease = vi.fn(() => (input.leaseFailure ? Promise.reject(input.leaseFailure) : Promise.resolve({ data: {} })));
    const closeDeployment = vi.fn(() => (input.closeFailure ? Promise.reject(input.closeFailure) : Promise.resolve({ data: { success: true } })));
    const api = mockDeep<AppDIContainer["api"]>();
    api.v1.createDeployment.useMutation.mockReturnValue(
      mock<ReturnType<typeof api.v1.createDeployment.useMutation>>({ mutateAsync: createDeployment as never })
    );
    api.v1.createLease.useMutation.mockReturnValue(mock<ReturnType<typeof api.v1.createLease.useMutation>>({ mutateAsync: createLease as never }));
    api.v1.closeDeployment.useMutation.mockReturnValue(mock<ReturnType<typeof api.v1.closeDeployment.useMutation>>({ mutateAsync: closeDeployment as never }));
    const bidList = Object.assign(mock<ReturnType<typeof DEPENDENCIES.useListBids>>(), {
      data: {
        data: (input.bids ?? []).map(bid => ({
          bid: {
            id: { owner: OWNER, dseq: DSEQ, gseq: 1, oseq: 1, provider: bid.provider, bseq: 0 },
            state: bid.state,
            price: { amount: bid.amount, denom: bid.denom }
          }
        }))
      }
    });
    const useListBids = vi.fn(() => bidList);
    const queryClient = mock<ReturnType<typeof DEPENDENCIES.useQueryClient>>();
    queryClient.invalidateQueries.mockResolvedValue(undefined);
    const dependencies = {
      useServices: () => mock<ReturnType<typeof DEPENDENCIES.useServices>>({ api }),
      useListBids: useListBids as unknown as typeof DEPENDENCIES.useListBids,
      useWallet: () => mock<ReturnType<typeof DEPENDENCIES.useWallet>>({ address: OWNER }),
      useQueryClient: () => queryClient
    };

    const { result } = renderHook(() => useCreateVolume(dependencies));

    return { result, createDeployment, createLease, closeDeployment, useListBids, queryClient };
  }
});
