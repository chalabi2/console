import { ApiError } from "@akashnetwork/openapi-sdk";
import { describe, expect, it, vi } from "vitest";
import { mock, mockDeep } from "vitest-mock-extended";

import type { AppDIContainer } from "@src/context/ServicesProvider/ServicesProvider";
import { TransactionMessageData } from "@src/utils/TransactionMessageData";
import type { DEPENDENCIES } from "./useCloseDeployment";
import { useCloseDeployment } from "./useCloseDeployment";

import { renderHook } from "@testing-library/react";

const DSEQ = "1786440078202";
const VOLUME_DSEQ = "1786440078100";

describe(useCloseDeployment.name, () => {
  describe("when the activity center is off", () => {
    it("signs the close in the browser and reports the deployment closed once it lands", async () => {
      const { result, signAndBroadcastTx, requestClose } = setup({});

      expect(await result.current(DSEQ)).toBe("closed");
      expect(signAndBroadcastTx).toHaveBeenCalledWith([TransactionMessageData.getCloseDeploymentMsg("akash1test", DSEQ)]);
      expect(requestClose).not.toHaveBeenCalled();
    });

    it("reports the deployment not closed when the transaction does not land", async () => {
      const { result } = setup({ txResponse: undefined });

      expect(await result.current(DSEQ)).toBe("not_closed");
    });

    it("closes the chosen volumes in the same transaction, after the deployment that mounts them", async () => {
      const { result, signAndBroadcastTx } = setup({});

      expect(await result.current(DSEQ, { volumeDseqs: [VOLUME_DSEQ] })).toBe("closed");
      expect(signAndBroadcastTx).toHaveBeenCalledWith([
        TransactionMessageData.getCloseDeploymentMsg("akash1test", DSEQ),
        TransactionMessageData.getCloseDeploymentMsg("akash1test", VOLUME_DSEQ)
      ]);
    });
  });

  describe("when the activity center is on", () => {
    it("hands the close to the background and reports the deployment closing", async () => {
      const { result, requestClose, signAndBroadcastTx, queryClient } = setup({ isActivityCenterOn: true });

      expect(await result.current(DSEQ)).toBe("closing");
      expect(requestClose).toHaveBeenCalledWith({ dseq: DSEQ, async: "true" });
      expect(signAndBroadcastTx).not.toHaveBeenCalled();
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["listActivities"] });
    });

    it("reports the deployment closed when the close finished during the request", async () => {
      const { result, queryClient } = setup({ isActivityCenterOn: true, closeResponse: { data: { success: true } } });

      expect(await result.current(DSEQ)).toBe("closed");
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["listActivities"] });
    });

    it("tells the user why the close was refused and reports the deployment not closed", async () => {
      const refusal = new ApiError(402, { message: "Not enough credits to close this deployment" }, `DELETE /v1/deployments/${DSEQ} → 402`);
      const { result, enqueueSnackbar } = setup({ isActivityCenterOn: true, closeRefusal: refusal });

      expect(await result.current(DSEQ)).toBe("not_closed");
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({
          props: expect.objectContaining({
            title: "Couldn't close this deployment",
            subTitle: "Not enough credits to close this deployment",
            iconVariant: "error"
          })
        }),
        { variant: "error" }
      );
    });

    it("closes the chosen volumes in the background once the deployment's close is accepted", async () => {
      const { result, requestClose } = setup({ isActivityCenterOn: true });

      expect(await result.current(DSEQ, { volumeDseqs: [VOLUME_DSEQ] })).toBe("closing");
      expect(requestClose.mock.calls).toEqual([[{ dseq: DSEQ, async: "true" }], [{ dseq: VOLUME_DSEQ, async: "true" }]]);
    });

    it("leaves the volumes open when the deployment's close is refused", async () => {
      const { result, requestClose } = setup({ isActivityCenterOn: true, closeRefusal: new Error("Failed to fetch") });

      await result.current(DSEQ, { volumeDseqs: [VOLUME_DSEQ] });

      expect(requestClose).toHaveBeenCalledTimes(1);
    });

    it.each([
      {
        case: "why",
        refusal: new ApiError(409, { message: "volume is still attached" }, `DELETE /v1/deployments/${VOLUME_DSEQ} → 409`),
        subTitle: "volume is still attached"
      },
      { case: "where to close it when the refusal carries no reason", refusal: new Error("Failed to fetch"), subTitle: "Close it from the Volumes page." }
    ])("tells the user $case a volume close was refused, keeping the deployment's outcome", async ({ refusal, subTitle }) => {
      const { result, enqueueSnackbar } = setup({ isActivityCenterOn: true, volumeCloseRefusal: refusal });

      expect(await result.current(DSEQ, { volumeDseqs: [VOLUME_DSEQ] })).toBe("closing");
      expect(enqueueSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ props: expect.objectContaining({ title: "Couldn't close a volume", subTitle, iconVariant: "error" }) }),
        { variant: "error" }
      );
    });

    it("tells the user nothing when every volume close is accepted", async () => {
      const { result, enqueueSnackbar } = setup({ isActivityCenterOn: true });

      await result.current(DSEQ, { volumeDseqs: [VOLUME_DSEQ] });

      expect(enqueueSnackbar).not.toHaveBeenCalled();
    });

    it("closes in the background once the activity center is switched on after it mounted", async () => {
      const { result, rerender, requestClose, signAndBroadcastTx } = setup({});

      rerender({ isActivityCenterOn: true });

      expect(await result.current(DSEQ)).toBe("closing");
      expect(requestClose).toHaveBeenCalled();
      expect(signAndBroadcastTx).not.toHaveBeenCalled();
    });

    it("asks the user to try again when a refusal carries no reason", async () => {
      const { result, enqueueSnackbar } = setup({ isActivityCenterOn: true, closeRefusal: new Error("Failed to fetch") });

      await result.current(DSEQ);

      expect(enqueueSnackbar).toHaveBeenCalledWith(expect.objectContaining({ props: expect.objectContaining({ subTitle: "Try again in a moment." }) }), {
        variant: "error"
      });
    });
  });

  function setup(input: {
    isActivityCenterOn?: boolean;
    txResponse?: unknown;
    closeResponse?: { data: { activityId: string } | { success: boolean } };
    closeRefusal?: Error;
    volumeCloseRefusal?: Error;
  }) {
    const signAndBroadcastTx = vi.fn().mockResolvedValue("txResponse" in input ? input.txResponse : { transactionHash: "0x1" });
    const requestClose = vi.fn(async ({ dseq }: { dseq: string }) => {
      if (input.closeRefusal) throw input.closeRefusal;
      if (dseq === VOLUME_DSEQ && input.volumeCloseRefusal) throw input.volumeCloseRefusal;
      return input.closeResponse ?? { data: { activityId: "b6f2d8e4-0f7c-4b37-9b52-6a1f0d3c2e11" } };
    });
    const enqueueSnackbar = vi.fn();
    const queryClient = mock<ReturnType<typeof DEPENDENCIES.useQueryClient>>();

    const api = mockDeep<AppDIContainer["api"]>();
    api.v1.listActivities.getKey.mockReturnValue(["listActivities"]);
    api.v1.closeDeployment.useMutation.mockReturnValue(mock<ReturnType<typeof api.v1.closeDeployment.useMutation>>({ mutateAsync: requestClose as never }));

    const services = mock<ReturnType<typeof DEPENDENCIES.useServices>>({ api });
    const wallet = mock<ReturnType<typeof DEPENDENCIES.useWallet>>({ address: "akash1test", signAndBroadcastTx });
    const snackbar = { enqueueSnackbar, closeSnackbar: vi.fn() };
    const dependenciesWith = ({ isActivityCenterOn }: { isActivityCenterOn?: boolean }): typeof DEPENDENCIES => ({
      useServices: () => services,
      useWallet: () => wallet,
      useFlag: flag => flag === "notifications_activity_center" && !!isActivityCenterOn,
      useSnackbar: () => snackbar,
      useQueryClient: () => queryClient
    });

    const { result, rerender } = renderHook((props: { isActivityCenterOn?: boolean }) => useCloseDeployment(dependenciesWith(props)), {
      initialProps: { isActivityCenterOn: input.isActivityCenterOn }
    });

    return { result, rerender, signAndBroadcastTx, requestClose, enqueueSnackbar, queryClient };
  }
});
