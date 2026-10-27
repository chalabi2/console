import { useState } from "react";
import { extractApiErrorMessage } from "@akashnetwork/openapi-sdk";
import { Snackbar } from "@akashnetwork/ui/components";
import { useQueryClient } from "@tanstack/react-query";
import { useSnackbar } from "notistack";

import { useServices } from "@src/context/ServicesProvider";
import { useMarkActivityOutcomes } from "@src/hooks/useHandledActivityOutcomes/useHandledActivityOutcomes";
import { isResizePending, resourceRefusalOf, sdlRefusalOf, UPDATE_FAILURE_MESSAGE } from "@src/utils/updateDeploymentFailure";

export const DEPENDENCIES = { Snackbar, useSnackbar, useQueryClient, useMarkActivityOutcomes };

export interface VolumeGrowSubmitInput {
  dseq: string;
  /** The version the sizes were loaded from, so a change made elsewhere since then is refused rather than overwritten. */
  manifestVersion: string;
  onSubmitted: () => void;
}

/** Growing a volume is always a resize its provider has to accept, so the api applies it in the background and the activity feed reports how it ends. */
export function useVolumeGrowSubmit({ dseq, manifestVersion, onSubmitted }: VolumeGrowSubmitInput, d = DEPENDENCIES) {
  const { api } = useServices();
  const { enqueueSnackbar } = d.useSnackbar();
  const queryClient = d.useQueryClient();
  const { forgetEarlierOutcomes, markOutcomeHandled } = d.useMarkActivityOutcomes();
  const patchDeployment = api.v1.patchDeployment.useMutation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [isHeldByPendingResize, setIsHeldByPendingResize] = useState(false);

  async function submit(sizes: Record<string, string>) {
    setRefusal(null);
    setIsHeldByPendingResize(false);
    setIsSubmitting(true);
    forgetEarlierOutcomes("deployment_update", dseq);

    try {
      const volumes = Object.fromEntries(Object.entries(sizes).map(([name, size]) => [name, { size }]));
      await patchDeployment.mutateAsync({ dseq, data: { volumes, ifManifestVersion: manifestVersion } });
    } catch (cause) {
      markOutcomeHandled("deployment_update", dseq, "failed");
      setIsSubmitting(false);
      reportFailure(cause);
      return;
    }

    await queryClient.invalidateQueries({ queryKey: api.v1.listActivities.getKey() });
    void queryClient.invalidateQueries({ queryKey: api.v1.getDeployment.getKey({ dseq }) });
    setIsSubmitting(false);
    onSubmitted();
  }

  function reportFailure(cause: unknown) {
    if (isResizePending(cause)) {
      setIsHeldByPendingResize(true);
      return;
    }

    const refused = resourceRefusalOf(cause) ?? sdlRefusalOf(cause);
    if (refused !== null) {
      setRefusal(refused);
      return;
    }

    enqueueSnackbar(<d.Snackbar title="Error" subTitle={extractApiErrorMessage(cause) ?? UPDATE_FAILURE_MESSAGE} iconVariant="error" />, {
      variant: "error",
      autoHideDuration: null
    });
  }

  return { submit, isSubmitting, refusal, isHeldByPendingResize };
}
