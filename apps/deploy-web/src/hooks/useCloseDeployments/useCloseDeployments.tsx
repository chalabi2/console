import { useCallback } from "react";
import { extractApiErrorMessage } from "@akashnetwork/openapi-sdk";
import { Snackbar } from "@akashnetwork/ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";

import { useServices } from "@src/context/ServicesProvider";
import { useWallet } from "@src/context/WalletProvider";
import { useSendCloseBatch } from "@src/hooks/useCloseBatches/useCloseBatches";
import type { CloseDeploymentOptions } from "@src/hooks/useCloseDeployment/useCloseDeployment";
import { useFlag } from "@src/hooks/useFlag";
import { TransactionMessageData } from "@src/utils/TransactionMessageData";

export const DEPENDENCIES = { useServices, useWallet, useFlag, useSendCloseBatch, useSnackbar, useQueryClient };

/** A deployment in neither list was not closed: its transaction failed or its close was refused. */
export type BulkCloseOutcome = { closed: string[]; closing: string[] };

/** Closes several deployments, each in the background under one bulk close while the activity center is on, and in one wallet transaction otherwise. */
export function useCloseDeployments(
  dependencies: typeof DEPENDENCIES = DEPENDENCIES
): (dseqs: string[], options?: CloseDeploymentOptions) => Promise<BulkCloseOutcome> {
  const { api } = dependencies.useServices();
  const { address, signAndBroadcastTx } = dependencies.useWallet();
  const isClosingInBackground = dependencies.useFlag("notifications_activity_center");
  const sendCloseBatch = dependencies.useSendCloseBatch();
  const { mutateAsync: requestClose } = api.v1.closeDeployment.useMutation();
  const queryClient = dependencies.useQueryClient();
  const { enqueueSnackbar } = dependencies.useSnackbar();

  const closeWithWallet = useCallback(
    async (dseqs: string[], { volumeDseqs = [] }: CloseDeploymentOptions = {}): Promise<BulkCloseOutcome> => {
      const response = await signAndBroadcastTx([...dseqs, ...volumeDseqs].map(dseq => TransactionMessageData.getCloseDeploymentMsg(address, dseq)));
      return { closed: response ? dseqs : [], closing: [] };
    },
    [signAndBroadcastTx, address]
  );

  const reportRefusals = useCallback(
    (refusals: unknown[], noun: "deployment" | "volume" = "deployment") => {
      const count = refusals.length === 1 ? `1 ${noun}` : `${refusals.length} ${noun}s`;
      enqueueSnackbar(
        <Snackbar title={`Couldn't close ${count}`} subTitle={extractApiErrorMessage(refusals[0]) ?? "Try again in a moment."} iconVariant="error" />,
        { variant: "error" }
      );
    },
    [enqueueSnackbar]
  );

  const closeInBackground = useCallback(
    async (dseqs: string[], { volumeDseqs = [] }: CloseDeploymentOptions = {}): Promise<BulkCloseOutcome> => {
      const answers = await sendCloseBatch(batchId => Promise.allSettled(dseqs.map(dseq => requestClose({ dseq, async: "true", batchId }))));

      const outcome: BulkCloseOutcome = { closed: [], closing: [] };
      const refusals: unknown[] = [];
      answers.forEach((answer, index) => {
        if (answer.status === "rejected") refusals.push(answer.reason);
        else if ("activityId" in answer.value.data) outcome.closing.push(dseqs[index]);
        else outcome.closed.push(dseqs[index]);
      });

      const volumeAnswers =
        refusals.length === 0 ? await Promise.allSettled(volumeDseqs.map(volumeDseq => requestClose({ dseq: volumeDseq, async: "true" }))) : [];
      await queryClient.invalidateQueries({ queryKey: api.v1.listActivities.getKey() });

      if (refusals.length > 0) reportRefusals(refusals);
      const volumeRefusals = volumeAnswers.flatMap(answer => (answer.status === "rejected" ? [answer.reason] : []));
      if (volumeRefusals.length > 0) reportRefusals(volumeRefusals, "volume");
      return outcome;
    },
    [sendCloseBatch, requestClose, queryClient, api, reportRefusals]
  );

  return isClosingInBackground ? closeInBackground : closeWithWallet;
}
