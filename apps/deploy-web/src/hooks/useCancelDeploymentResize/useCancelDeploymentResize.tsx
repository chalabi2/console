import { useCallback } from "react";
import { extractApiErrorMessage } from "@akashnetwork/openapi-sdk";
import { Snackbar } from "@akashnetwork/ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";

import { useServices } from "@src/context/ServicesProvider";

export const DEPENDENCIES = { useServices, useSnackbar, useQueryClient };

/** Resolves whether the resize was withdrawn, so the caller stops offering it before the feed reports how the update ended. */
export function useCancelDeploymentResize(dseq: string, dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { api } = dependencies.useServices();
  const { mutateAsync: requestCancel, isPending: isCanceling } = api.v1.deleteDeploymentResize.useMutation();
  const queryClient = dependencies.useQueryClient();
  const { enqueueSnackbar } = dependencies.useSnackbar();

  const cancel = useCallback(async (): Promise<boolean> => {
    try {
      await requestCancel({ dseq });
      enqueueSnackbar(<Snackbar title="Resize canceled" subTitle="The deployment keeps the hardware it runs." iconVariant="success" />, { variant: "success" });
      return true;
    } catch (error) {
      enqueueSnackbar(
        <Snackbar title="Couldn't cancel the resize" subTitle={extractApiErrorMessage(error) ?? "Try again in a moment."} iconVariant="error" />,
        { variant: "error" }
      );
      return false;
    } finally {
      await queryClient.invalidateQueries({ queryKey: api.v1.listActivities.getKey() });
    }
  }, [dseq, requestCancel, enqueueSnackbar, queryClient, api]);

  return { cancel, isCanceling };
}
