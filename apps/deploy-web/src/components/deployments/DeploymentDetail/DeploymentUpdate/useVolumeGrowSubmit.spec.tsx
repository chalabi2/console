import { ApiError } from "@akashnetwork/openapi-sdk";
import { describe, expect, it, vi } from "vitest";
import { mock, mockDeep } from "vitest-mock-extended";

import type { AppDIContainer } from "@src/context/ServicesProvider/ServicesProvider";
import { DEPENDENCIES, useVolumeGrowSubmit } from "./useVolumeGrowSubmit";

import { act } from "@testing-library/react";
import { MockComponents } from "@tests/unit/mocks";
import { setupQuery } from "@tests/unit/query-client";

const DSEQ = "1234";
const VERSION = "dm9sdW1l";
const RESIZE_PENDING = new ApiError(
  409,
  { message: "A resize of this deployment is waiting for its provider.", code: "deployment_resize_pending" },
  "PATCH /v1/deployments/{dseq} → 409"
);
const SHRINK_REFUSAL = 'The SDL changes group "global" in a way a running lease cannot be resized to: it shrinks volume "data", which can only grow.';
const SHRINK_REFUSED = new ApiError(422, { message: SHRINK_REFUSAL, code: "deployment_resize_refused" }, "PATCH /v1/deployments/{dseq} → 422");
const OUTAGE = new ApiError(500, { message: "The chain could not be reached" }, "PATCH /v1/deployments/{dseq} → 500");

describe(useVolumeGrowSubmit.name, () => {
  it("asks to grow each volume to the size given, guarded on the version the sizes were loaded from", async () => {
    const { result, patchMutate, queryClient, onSubmitted, forgetEarlierOutcomes } = setup();

    await act(() => result.current.submit({ data: "2Gi", logs: "10Gi" }));

    expect(forgetEarlierOutcomes).toHaveBeenCalledWith("deployment_update", DSEQ);
    expect(patchMutate).toHaveBeenCalledWith({ dseq: DSEQ, data: { volumes: { data: { size: "2Gi" }, logs: { size: "10Gi" } }, ifManifestVersion: VERSION } });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["listActivities"] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["getDeployment", DSEQ] });
    expect(onSubmitted).toHaveBeenCalled();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("starts with nothing submitted, refused or held back", () => {
    const { result } = setup();

    expect(result.current).toMatchObject({ isSubmitting: false, refusal: null, isHeldByPendingResize: false });
  });

  it("reports itself submitting until the api answers", async () => {
    const { result } = setup({ patchOutcome: "pending" });

    act(() => void result.current.submit({ data: "2Gi" }));

    expect(result.current.isSubmitting).toBe(true);
  });

  it("holds back while a resize waits for the provider, without an error", async () => {
    const { result, enqueueSnackbar, onSubmitted, markOutcomeHandled } = setup({ patchOutcome: RESIZE_PENDING });

    await act(() => result.current.submit({ data: "2Gi" }));

    expect(result.current.isHeldByPendingResize).toBe(true);
    expect(markOutcomeHandled).toHaveBeenCalledWith("deployment_update", DSEQ, "failed");
    expect(enqueueSnackbar).not.toHaveBeenCalled();
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it("shows the reason a provider's lease cannot take the size", async () => {
    const { result, enqueueSnackbar } = setup({ patchOutcome: SHRINK_REFUSED });

    await act(() => result.current.submit({ data: "512Mi" }));

    expect(result.current.refusal).toBe(SHRINK_REFUSAL);
    expect(enqueueSnackbar).not.toHaveBeenCalled();
  });

  it("reports any other failure in a snackbar that stays until dismissed", async () => {
    const { result, enqueueSnackbar } = setup({ patchOutcome: OUTAGE });

    await act(() => result.current.submit({ data: "2Gi" }));

    expect(enqueueSnackbar).toHaveBeenCalledWith(expect.anything(), { variant: "error", autoHideDuration: null });
    expect(enqueueSnackbar.mock.calls[0][0].props.subTitle).toBe("The chain could not be reached");
    expect(result.current.refusal).toBeNull();
    expect(result.current.isSubmitting).toBe(false);
  });

  it("falls back to a general reason for a failure that names none", async () => {
    const { result, enqueueSnackbar } = setup({ patchOutcome: new ApiError(500, {}, "PATCH /v1/deployments/{dseq} → 500") });

    await act(() => result.current.submit({ data: "2Gi" }));

    expect(enqueueSnackbar.mock.calls[0][0].props.subTitle).toBe("Something went wrong while updating the deployment. Please try again.");
  });

  it("clears an earlier refusal and hold when it submits again", async () => {
    const { result, setOutcome } = setup({ patchOutcome: SHRINK_REFUSED });
    await act(() => result.current.submit({ data: "512Mi" }));
    setOutcome(RESIZE_PENDING);
    await act(() => result.current.submit({ data: "2Gi" }));
    setOutcome("accepted");

    await act(() => result.current.submit({ data: "2Gi" }));

    expect(result.current.refusal).toBeNull();
    expect(result.current.isHeldByPendingResize).toBe(false);
  });

  function setup(input: { patchOutcome?: ApiError | "accepted" | "pending" } = {}) {
    let outcome = input.patchOutcome ?? "accepted";
    const patchMutate = vi.fn((_variables: unknown) => {
      if (outcome === "pending") return new Promise(() => undefined);
      if (outcome === "accepted") return Promise.resolve({ data: { activityId: "4b0b8a63-3f4c-4f36-9a51-0d0e2b8f6c11", manifestVersion: VERSION } });
      return Promise.reject(outcome);
    });
    const api = mockDeep<AppDIContainer["api"]>();
    api.v1.getDeployment.getKey.mockImplementation(request => ["getDeployment", request?.dseq ?? ""]);
    api.v1.listActivities.getKey.mockReturnValue(["listActivities"]);
    api.v1.patchDeployment.useMutation.mockReturnValue(mock<ReturnType<typeof api.v1.patchDeployment.useMutation>>({ mutateAsync: patchMutate as never }));
    const enqueueSnackbar = vi.fn();
    const queryClient = mock<ReturnType<typeof DEPENDENCIES.useQueryClient>>();
    queryClient.invalidateQueries.mockResolvedValue(undefined);
    const forgetEarlierOutcomes = vi.fn();
    const markOutcomeHandled = vi.fn();
    const onSubmitted = vi.fn();
    const dependencies = MockComponents(DEPENDENCIES, {
      useSnackbar: () => ({ enqueueSnackbar, closeSnackbar: vi.fn() }),
      useQueryClient: () => queryClient,
      useMarkActivityOutcomes: () => mock<ReturnType<typeof DEPENDENCIES.useMarkActivityOutcomes>>({ forgetEarlierOutcomes, markOutcomeHandled })
    });

    const { result } = setupQuery(() => useVolumeGrowSubmit({ dseq: DSEQ, manifestVersion: VERSION, onSubmitted }, dependencies), {
      services: { api: () => api }
    });

    return {
      result,
      patchMutate,
      queryClient,
      enqueueSnackbar,
      onSubmitted,
      forgetEarlierOutcomes,
      markOutcomeHandled,
      setOutcome: (next: ApiError | "accepted" | "pending") => (outcome = next)
    };
  }
});
