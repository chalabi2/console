"use client";
import type { FC } from "react";
import { Badge } from "@akashnetwork/ui/components";

import { useWallet } from "@src/context/WalletProvider";
import { useDeclaredGpuInterconnect } from "@src/hooks/useDeclaredGpuInterconnect";
import type { DeploymentDto } from "@src/types/deployment";
import { deploymentVolumeOf } from "@src/utils/volumeUtils";
import { GpuInterconnectBadge } from "../../shared/GpuInterconnectBadge";
import { TrialDeploymentBadge } from "../../shared/TrialDeploymentBadge";

export const DEPENDENCIES = {
  useWallet,
  useDeclaredGpuInterconnect,
  GpuInterconnectBadge,
  TrialDeploymentBadge
};

export interface DeploymentBadgesProps {
  deployment: DeploymentDto;
  dependencies?: typeof DEPENDENCIES;
}

export const DeploymentBadges: FC<DeploymentBadgesProps> = ({ deployment, dependencies: d = DEPENDENCIES }) => {
  const interconnect = d.useDeclaredGpuInterconnect(deployment);
  const { isTrialing } = d.useWallet();
  const isClosed = deployment.state === "closed";
  const isVolume = !!deploymentVolumeOf(deployment.groups);
  const hasInterconnectBadge = !isClosed && interconnect.enabled;
  const hasTrialBadge = !isClosed && isTrialing;

  if (!isVolume && !hasInterconnectBadge && !hasTrialBadge) return null;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {isVolume && <Badge variant="outline">Volume</Badge>}
      {hasInterconnectBadge && <d.GpuInterconnectBadge interconnect={interconnect} compact />}
      {hasTrialBadge && <d.TrialDeploymentBadge createdHeight={deployment.createdAt} />}
    </div>
  );
};
