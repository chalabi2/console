"use client";
import { useAtom } from "jotai";

import { type CloseDeploymentConfirmation, CloseDeploymentDialog } from "@src/components/deployments/CloseDeploymentDialog/CloseDeploymentDialog";
import { closeDeploymentRequestAtom } from "@src/store/closeDeploymentStore";

export const DEPENDENCIES = { CloseDeploymentDialog };

/** Hosts the single close confirmation that any call site opens through `useCloseDeploymentConfirm`. */
export function CloseDeploymentConfirmHost({ dependencies: d = DEPENDENCIES }: { dependencies?: typeof DEPENDENCIES }) {
  const [request, setRequest] = useAtom(closeDeploymentRequestAtom);

  if (!request) return null;

  const answer = (confirmation: CloseDeploymentConfirmation | null) => {
    request.resolve(confirmation);
    setRequest(null);
  };

  return <d.CloseDeploymentDialog target={request.target} onConfirm={answer} onCancel={() => answer(null)} />;
}
