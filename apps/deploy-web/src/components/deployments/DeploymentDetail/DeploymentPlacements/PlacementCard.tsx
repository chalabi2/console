"use client";
import type { FC } from "react";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@akashnetwork/ui/components";
import { ChevronRight, MapPin, Server } from "lucide-react";
import Link from "next/link";

import { useTeeResourceCarveouts } from "@src/hooks/useTeeResourceCarveouts";
import { useLeaseStatus } from "@src/queries/useLeaseQuery";
import { isProviderUnavailableError } from "@src/services/query-error-policy/query-error-policy";
import type { LeaseDto } from "@src/types/deployment";
import type { ApiProviderList } from "@src/types/provider";
import { getGroupTeeType } from "@src/utils/confidentialCompute";
import { isLeaseLive } from "@src/utils/leaseUtils";
import { providerDisplayName } from "@src/utils/providerUtils";
import { getClosedLeaseLabel, isClosingVolume, isMovedVolumeLease, isMovingVolume, isProviderReclaimed, isReclaiming } from "@src/utils/reclamationUtils";
import { UrlService } from "@src/utils/urlUtils";
import { isBucketVolume, volumeClassOf, volumeOf } from "@src/utils/volumeUtils";
import { ConfidentialComputeResources } from "../../ConfidentialComputeResources";
import { DownloadAttestationEvidence } from "../../DownloadAttestationEvidence";
import { ReclamationCard } from "../../ReclamationCard/ReclamationCard";
import { StatusBadge } from "../DeploymentStatusBadge";
import { BucketAccess } from "./BucketAccess/BucketAccess";
import type { ManifestServiceDetail } from "./placementModel";
import { getPlacementGpuModels, getPlacementName, getProviderRegion, resolveLeaseGpus } from "./placementModel";
import { PlacementServiceRow } from "./PlacementServiceRow";
import { buildPlacementStats, buildVolumeStats, PlacementStats } from "./PlacementStats";
import { VolumeAttachment } from "./VolumeAttachment";

export const DEPENDENCIES = {
  useLeaseStatus,
  useTeeResourceCarveouts,
  ReclamationCard,
  ConfidentialComputeResources,
  DownloadAttestationEvidence,
  PlacementServiceRow,
  VolumeAttachment,
  BucketAccess
};

export interface PlacementCardProps {
  index: number;
  lease: LeaseDto;
  provider?: ApiProviderList;
  manifestServices: Record<string, ManifestServiceDetail>;
  placementServices?: Record<string, ManifestServiceDetail>;
  dseq: string;
  isLoadingLeaseGpus?: boolean;
  onClosed: () => void;
  dependencies?: typeof DEPENDENCIES;
}

export const PlacementCard: FC<PlacementCardProps> = ({
  index,
  lease,
  provider,
  manifestServices,
  placementServices,
  dseq,
  isLoadingLeaseGpus = false,
  onClosed,
  dependencies: d = DEPENDENCIES
}) => {
  const isLeaseActive = isLeaseLive(lease);
  const {
    data: leaseStatus,
    error: leaseStatusError,
    isLoading
  } = d.useLeaseStatus({ provider, lease, enabled: isLeaseActive && !!provider, refetchInterval: 30_000 });
  /** isLoading, not isPending: useLeaseStatus also gates `enabled` on provider.hostUri and usable provider credentials, so the query can stay disabled forever with isPending stuck true, while isLoading is false for a query that never fetches. */
  const isLeaseStatusPending = isLeaseActive && !!provider && isLoading;
  const isProviderUnreachable = isLeaseActive && isProviderUnavailableError(leaseStatusError);
  const carveouts = d.useTeeResourceCarveouts(lease);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const volume = volumeOf(lease.group);
  const hasVolumeMovedOn = !!volume && isMovedVolumeLease(lease);
  const isReclaimed = isProviderReclaimed(lease) && !hasVolumeMovedOn;
  const teeType = getGroupTeeType(lease.group);
  const name = getPlacementName(lease.group, index);
  const region = getProviderRegion(provider);
  const gpuModels = getPlacementGpuModels(lease.group);
  const resolvedGpus = resolveLeaseGpus(lease);
  const services = placementServices ?? manifestServices;
  const serviceNames = leaseStatus ? Object.keys(leaseStatus.services) : Object.keys(services);
  const providerName = provider ? providerDisplayName(provider) : undefined;
  const allExpanded = serviceNames.length > 0 && serviceNames.every(serviceName => expanded.has(serviceName));

  function toggleAll() {
    setExpanded(allExpanded ? new Set() : new Set(serviceNames));
  }

  function handleOpenChange(serviceName: string, next: boolean) {
    setExpanded(current => {
      const nextSet = new Set(current);
      if (next) nextSet.add(serviceName);
      else nextSet.delete(serviceName);
      return nextSet;
    });
  }

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-6 border-b p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div
              aria-label={`Placement ${index + 1}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-sm font-medium text-muted-foreground"
            >
              {index + 1}
            </div>
            <h3 className="text-2xl font-medium tracking-tight">{name}</h3>
            {isReclaiming(lease) && <StatusBadge label={reclaimingLabelOf(lease)} tone="warning" />}
            {isProviderUnreachable && <StatusBadge label="Provider not responding" tone="warning" />}
          </div>
          {(region || providerName) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {region && (
                <span className="inline-flex items-center gap-2">
                  <MapPin className="h-3 w-3" />
                  {region}
                </span>
              )}
              {region && providerName && <ChevronRight className="h-3 w-3" />}
              {providerName && provider && (
                <Link href={UrlService.providerDetail(provider.owner)} className="inline-flex items-center gap-2 hover:text-foreground">
                  <Server className="h-3 w-3" />
                  {providerName}
                </Link>
              )}
            </div>
          )}
        </div>
        <div className="lg:shrink-0">
          <PlacementStats
            stats={
              volume
                ? buildVolumeStats(lease, { vid: volume.vid, storageClass: volumeClassOf(lease.group) })
                : buildPlacementStats(lease, serviceNames.length, { models: gpuModels, resolved: resolvedGpus, isLoading: isLoadingLeaseGpus })
            }
          />
        </div>
      </div>

      {hasVolumeMovedOn && (
        <div className="px-6 pt-6">
          <MovedVolumeNotice lease={lease} providerName={providerName} />
        </div>
      )}

      {(isReclaimed || carveouts.length > 0 || (isLeaseActive && !!provider && !!teeType)) && (
        <div className="space-y-4 px-6 pt-6">
          {isReclaimed && <d.ReclamationCard lease={lease} dseq={dseq} onClosed={onClosed} />}
          <d.ConfidentialComputeResources carveouts={carveouts} />
          <d.DownloadAttestationEvidence lease={lease} provider={provider} />
        </div>
      )}

      {volume ? (
        isBucketVolume(volume) ? (
          isLeaseLive(lease) && <d.BucketAccess lease={lease} provider={provider} />
        ) : (
          lease.state === "active" && <d.VolumeAttachment vid={volume.vid} owner={lease.owner} dseq={dseq} />
        )
      ) : (
        <div className="p-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <span>Services in this placement</span>
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px]">{serviceNames.length}</span>
            </div>
            {isLeaseActive && !isReclaimed && serviceNames.length > 0 && (
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={toggleAll}>
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
            )}
          </div>
          {serviceNames.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services found for this placement.</p>
          ) : (
            <div className="space-y-2">
              {serviceNames.map(serviceName => (
                <d.PlacementServiceRow
                  key={serviceName}
                  serviceName={serviceName}
                  service={leaseStatus?.services?.[serviceName]}
                  leaseState={lease.state}
                  isReclaimed={isReclaimed}
                  detail={services[serviceName]}
                  uris={leaseStatus?.services?.[serviceName]?.uris}
                  forwardedPorts={leaseStatus?.forwarded_ports?.[serviceName]}
                  ips={leaseStatus?.ips?.[serviceName]}
                  isLeaseStatusPending={isLeaseStatusPending}
                  open={expanded.has(serviceName)}
                  onOpenChange={next => handleOpenChange(serviceName, next)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function reclaimingLabelOf(lease: LeaseDto): string {
  if (isClosingVolume(lease)) return "Closing";
  if (isMovingVolume(lease)) return "Moving";
  return "Reclaiming";
}

const MovedVolumeNotice: FC<{ lease: LeaseDto; providerName?: string }> = ({ lease, providerName }) => (
  <Alert className="p-4">
    <AlertTitle>{getClosedLeaseLabel(lease)}</AlertTitle>
    <AlertDescription>
      Its lease with {providerName ?? "this provider"} has ended. The provider it is leased from next copies its data, and the{" "}
      <Link href={UrlService.volumes()} className="underline">
        Volumes
      </Link>{" "}
      page shows where it is now.
    </AlertDescription>
  </Alert>
);
