"use client";
import type { FC } from "react";
import { Alert, AlertDescription, AlertTitle } from "@akashnetwork/ui/components";
import { Info } from "lucide-react";

import type { LeaseDto } from "@src/types/deployment";
import { getReclamationDeadline, isClosingVolume } from "@src/utils/reclamationUtils";
import { volumeAfterCloseOf, volumeOf } from "@src/utils/volumeUtils";
import { useCountdown } from "../ReclamationBanner/useCountdown";

export const DEPENDENCIES = { useCountdown };

export interface VolumeClosingBannerProps {
  leases: LeaseDto[] | null | undefined;
  className?: string;
  dependencies?: typeof DEPENDENCIES;
}

export const VolumeClosingBanner: FC<VolumeClosingBannerProps> = ({ leases, className, dependencies: d = DEPENDENCIES }) => {
  const closingLease = leases?.find(isClosingVolume);
  const countdown = d.useCountdown(closingLease ? getReclamationDeadline(closingLease) : null);

  if (!closingLease) return null;

  const afterClose = volumeAfterCloseOf(volumeOf(closingLease.group));

  return (
    <Alert className={className}>
      <Info className="h-4 w-4" />
      <AlertTitle>This volume is closing</AlertTitle>
      <AlertDescription>
        <p>
          {countdown
            ? `Its provider keeps serving it until its reclamation window ends, and it finishes closing in ${countdown}.`
            : "Its reclamation window has ended, so it is finishing closing now."}
        </p>
        {afterClose && <p className="mt-1">{afterClose}</p>}
      </AlertDescription>
    </Alert>
  );
};
