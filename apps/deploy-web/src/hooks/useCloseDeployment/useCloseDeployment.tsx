import { useCallback } from "react";
import { extractApiErrorMessage } from "@akashnetwork/openapi-sdk";
import { Snackbar } from "@akashnetwork/ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";

import { useServices } from "@src/context/ServicesProvider";
import { useWallet } from "@src/context/WalletProvider";
import { useFlag } from "@src/hooks/useFlag";
import { TransactionMessageData } from "@src/utils/TransactionMessageData";

export const DEPENDENCIES = { useServices, useWallet, useFlag, useSnackbar, useQueryClient };

/** `closing` means the close was accepted to run in the background, and the activity host reports how it ends. */
export type CloseOutcome = "closed" | "closing" | "not_closed";

/** The volumes its owner chose to close along with the deployment, which the chain closes only once the deployment no longer mounts them. */
export type CloseDeploymentOptions = { volumeDseqs?: string[] };

/** Closes one deployment in the background while the activity center is on, and through the wallet's blocking dialog otherwise. */
export function useCloseDeployment(
  dependencies: typeof DEPENDENCIES = DEPENDENCIES
): (dseq: string, options?: CloseDeploymentOptions) => Promise<CloseOutcome> {
  const { api } = dependencies.useServices();
  const { address, signAndBroadcastTx } = dependencies.useWallet();
  const isClosingInBackground = dependencies.useFlag("notifications_activity_center");
  const { mutateAsync: requestClose } = api.v1.closeDeployment.useMutation();
  const queryClient = dependencies.useQueryClient();
  const { enqueueSnackbar } = dependencies.useSnackbar();

  const closeVolumesInBackground = useCallback(
    async (volumeDseqs: string[]) => {
      const answers = await Promise.allSettled(volumeDseqs.map(volumeDseq => requestClose({ dseq: volumeDseq, async: "true" })));
      const refusal = answers.find((answer): answer is PromiseRejectedResult => answer.status === "rejected");
      if (!refusal) return;

      enqueueSnackbar(
        <Snackbar title="Couldn't close a volume" subTitle={extractApiErrorMessage(refusal.reason) ?? "Close it from the Volumes page."} iconVariant="error" />,
        { variant: "error" }
      );
    },
    [requestClose, enqueueSnackbar]
  );

  return useCallback(
    async (dseq: string, { volumeDseqs = [] }: CloseDeploymentOptions = {}) => {
      if (!isClosingInBackground) {
        const response = await signAndBroadcastTx([dseq, ...volumeDseqs].map(closing => TransactionMessageData.getCloseDeploymentMsg(address, closing)));
        return response ? "closed" : "not_closed";
      }

      try {
        const { data } = await requestClose({ dseq, async: "true" });
        await closeVolumesInBackground(volumeDseqs);
        await queryClient.invalidateQueries({ queryKey: api.v1.listActivities.getKey() });
        return "activityId" in data ? "closing" : "closed";
      } catch (error) {
        enqueueSnackbar(
          <Snackbar title="Couldn't close this deployment" subTitle={extractApiErrorMessage(error) ?? "Try again in a moment."} iconVariant="error" />,
          { variant: "error" }
        );
        return "not_closed";
      }
    },
    [isClosingInBackground, signAndBroadcastTx, address, requestClose, closeVolumesInBackground, queryClient, api, enqueueSnackbar]
  );
}
