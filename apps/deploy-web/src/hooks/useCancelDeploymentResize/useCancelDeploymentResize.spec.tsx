import { ApiError } from "@akashnetwork/openapi-sdk";
import { describe, expect, it, vi } from "vitest";
import { mock, mockDeep } from "vitest-mock-extended";

import type { AppDIContainer } from "@src/context/ServicesProvider/ServicesProvider";
import type { DEPENDENCIES } from "./useCancelDeploymentResize";
import { useCancelDeploymentResize } from "./useCancelDeploymentResize";

import { renderHook } from "@testing-library/react";

const DSEQ = "1786440078202";

describe(useCancelDeploymentResize.name, () => {
  it("withdraws the resize, says the deployment keeps its hardware and refreshes the feed", async () => {
    const { result, requestCancel, enqueueSnackbar, queryClient } = setup({});

    expect(await result.current.cancel()).toBe(true);
    expect(requestCancel).toHaveBeenCalledWith({ dseq: DSEQ });
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({ props: expect.objectContaining({ title: "Resize canceled", iconVariant: "success" }) }),
      { variant: "success" }
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["listActivities"] });
  });

  it("tells the user why the resize could not be withdrawn, still refreshing the feed", async () => {
    const refusal = new ApiError(404, { message: "This deployment has no resize waiting for its provider" }, `DELETE /v1/deployments/${DSEQ}/resize → 404`);
    const { result, enqueueSnackbar, queryClient } = setup({ refusal });

    expect(await result.current.cancel()).toBe(false);
    expect(enqueueSnackbar).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({
          title: "Couldn't cancel the resize",
          subTitle: "This deployment has no resize waiting for its provider",
          iconVariant: "error"
        })
      }),
      { variant: "error" }
    );
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["listActivities"] });
  });

  it("asks the user to try again when a refusal carries no reason", async () => {
    const { result, enqueueSnackbar } = setup({ refusal: new Error("Failed to fetch") });

    await result.current.cancel();

    expect(enqueueSnackbar).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ subTitle: "Try again in a moment." }) }), {
      variant: "error"
    });
  });

  it("reports the cancel in flight", () => {
    const { result } = setup({ isPending: true });

    expect(result.current.isCanceling).toBe(true);
  });

  function setup(input: { refusal?: Error; isPending?: boolean }) {
    const requestCancel = input.refusal ? vi.fn().mockRejectedValue(input.refusal) : vi.fn().mockResolvedValue({ data: { success: true } });
    const enqueueSnackbar = vi.fn();
    const queryClient = mock<ReturnType<typeof DEPENDENCIES.useQueryClient>>();
    const api = mockDeep<AppDIContainer["api"]>();
    api.v1.listActivities.getKey.mockReturnValue(["listActivities"]);
    api.v1.deleteDeploymentResize.useMutation.mockReturnValue(
      mock<ReturnType<typeof api.v1.deleteDeploymentResize.useMutation>>({ mutateAsync: requestCancel as never, isPending: input.isPending ?? false })
    );
    const dependencies: typeof DEPENDENCIES = {
      useServices: () => mock<ReturnType<typeof DEPENDENCIES.useServices>>({ api }),
      useSnackbar: () => ({ enqueueSnackbar, closeSnackbar: vi.fn() }),
      useQueryClient: () => queryClient
    };

    const { result } = renderHook(() => useCancelDeploymentResize(DSEQ, dependencies));

    return { result, requestCancel, enqueueSnackbar, queryClient };
  }
});
