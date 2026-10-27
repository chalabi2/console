import { atom } from "jotai";

import type { CloseDeploymentConfirmation, CloseDeploymentTarget } from "@src/components/deployments/CloseDeploymentDialog/CloseDeploymentDialog";

export type CloseDeploymentRequest = {
  target: CloseDeploymentTarget;
  resolve: (confirmation: CloseDeploymentConfirmation | null) => void;
};

/** The pending close confirmation, hosted once for the app so a list row's menu can ask after the menu itself has unmounted. */
export const closeDeploymentRequestAtom = atom<CloseDeploymentRequest | null>(null);
