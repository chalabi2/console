"use client";
import type { FC } from "react";
import { useState } from "react";
import { Badge, Button, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@akashnetwork/ui/components";
import { HardDrive, Plus, RefreshCw } from "lucide-react";
import Link from "next/link";
import { NextSeo } from "next-seo";

import { useCountdown } from "@src/components/deployments/ReclamationBanner/useCountdown";
import Layout from "@src/components/layout/Layout";
import { PricePerTimeUnit } from "@src/components/shared/PricePerTimeUnit";
import { ChooseVolumeProviderDialog } from "@src/components/volumes/ChooseVolumeProviderDialog/ChooseVolumeProviderDialog";
import { CreateVolumeDialog } from "@src/components/volumes/CreateVolumeDialog/CreateVolumeDialog";
import { MoveVolumeDialog } from "@src/components/volumes/MoveVolumeDialog/MoveVolumeDialog";
import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import { useOwnedVolumes } from "@src/queries/useOwnedVolumes";
import { useProvidersByAddresses } from "@src/queries/useProvidersQuery";
import { IMPORTING_PHASE, useVolumeStatus } from "@src/queries/useVolumeStatusQuery";
import type { ApiProviderList } from "@src/types/provider";
import { persistentStorageTypes } from "@src/utils/akash/units";
import { PRICE_DISPLAY_PRECISION, udenomToDenom } from "@src/utils/mathHelpers";
import { providerDisplayName } from "@src/utils/providerUtils";
import { defaultPlacement } from "@src/utils/sdl/data";
import { formatByteSize } from "@src/utils/unitUtils";
import { UrlService } from "@src/utils/urlUtils";

export const DEPENDENCIES = {
  useOwnedVolumes,
  useProvidersByAddresses,
  useCountdown,
  useVolumeStatus,
  Layout,
  NextSeo,
  CreateVolumeDialog,
  MoveVolumeDialog,
  ChooseVolumeProviderDialog,
  PricePerTimeUnit
};

const STANDALONE_PLACEMENT = defaultPlacement({ name: "dcloud" });
const LOADING_ROWS = ["first", "second", "third"];

export const VolumesPage: FC<{ dependencies?: typeof DEPENDENCIES }> = ({ dependencies: d = DEPENDENCIES }) => {
  const { volumes, isLoading, isError, refetch } = d.useOwnedVolumes();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [volumeToMove, setVolumeToMove] = useState<OwnedVolume>();
  const [volumeToLease, setVolumeToLease] = useState<OwnedVolume>();
  const { data: providers } = d.useProvidersByAddresses(volumes.flatMap(volume => volume.provider ?? []));
  const openCreate = () => setIsCreateOpen(true);
  const hasNoVolumes = !isLoading && volumes.length === 0;

  return (
    <d.Layout background="dots" isLoading={isLoading} disableContainer>
      <d.NextSeo title="Volumes" />

      <div className="flex min-h-[60px] shrink-0 items-center border-b border-border bg-background py-2">
        <div className="container flex flex-wrap items-center gap-3 px-4 sm:px-6">
          <h1 className="mr-auto whitespace-nowrap text-xl font-bold leading-7 tracking-[-0.02em]">Volumes</h1>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Create volume
          </Button>
        </div>
      </div>

      <div className="container flex flex-col gap-4 px-4 py-6 sm:px-6">
        <p className="text-sm text-muted-foreground">
          A volume is storage leased on its own from one provider, so its data outlives your deployments. A disk is mounted by deployments on that provider; a
          bucket is served over S3 to your deployments on any provider.
        </p>

        {isError && (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <p className="text-muted-foreground">Couldn&apos;t load volumes.</p>
            <Button variant="outline" size="sm" onClick={refetch}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        )}

        {!isError && hasNoVolumes && (
          <div className="flex flex-col items-center justify-center gap-3 rounded-md border bg-card py-12 text-center">
            <HardDrive className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
            <p className="font-medium">No volumes yet</p>
            <p className="max-w-md text-sm text-muted-foreground">Create one here, or from a service&apos;s hardware when you configure a deployment.</p>
            <Button size="sm" onClick={openCreate}>
              Create volume
            </Button>
          </div>
        )}

        {!isError && !hasNoVolumes && (
          <div className="overflow-x-auto rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Volume</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading
                  ? LOADING_ROWS.map(key => <RowPlaceholder key={key} />)
                  : volumes.map(volume => (
                      <VolumeRow
                        key={volume.dseq}
                        volume={volume}
                        provider={providers.find(candidate => candidate.owner === volume.provider)}
                        onMove={() => setVolumeToMove(volume)}
                        onChooseProvider={() => setVolumeToLease(volume)}
                        dependencies={d}
                      />
                    ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {isCreateOpen && (
        <d.CreateVolumeDialog
          open
          onOpenChange={setIsCreateOpen}
          placement={STANDALONE_PLACEMENT}
          takenNames={volumes.map(volume => volume.name)}
          onCreated={refetch}
          offersBuckets
        />
      )}

      {volumeToMove && (
        <d.MoveVolumeDialog volume={volumeToMove} providerName={providerNameOf(volumeToMove, providers)} onClose={() => setVolumeToMove(undefined)} />
      )}

      {volumeToLease && <d.ChooseVolumeProviderDialog volume={volumeToLease} onClose={() => setVolumeToLease(undefined)} />}
    </d.Layout>
  );
};

const VolumeRow: FC<{
  volume: OwnedVolume;
  provider?: ApiProviderList;
  onMove: () => void;
  onChooseProvider: () => void;
  dependencies: typeof DEPENDENCIES;
}> = ({ volume, provider, onMove, onChooseProvider, dependencies: d }) => {
  const storageType = persistentStorageTypes.find(type => type.className === volume.storageClass)?.name;
  const isDisk = volume.access === "mount";
  const isLive = volume.state === "available" || volume.state === "mounted";
  const { data: status } = d.useVolumeStatus(
    { provider: provider && { owner: provider.owner, hostUri: provider.hostUri }, dseq: volume.dseq, gseq: volume.gseq ?? 1, oseq: volume.oseq ?? 1 },
    { enabled: isDisk && isLive && wasMoved(volume) }
  );
  const isCopyingIn = status?.phase === IMPORTING_PHASE;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Link href={UrlService.deploymentDetails(volume.dseq)} className="font-medium">
            {volume.name}
          </Link>
          {volume.access === "bucket" && <Badge variant="outline">S3 bucket</Badge>}
        </div>
        <div className="font-mono text-xs text-muted-foreground">{volume.dseq}</div>
      </TableCell>
      <TableCell>
        <VolumeStateLabel volume={volume} isCopyingIn={isCopyingIn} dependencies={d} />
      </TableCell>
      <TableCell>{storageType ? `${formatByteSize(volume.sizeBytes)} · ${storageType}` : formatByteSize(volume.sizeBytes)}</TableCell>
      <TableCell>{provider ? providerDisplayName(provider) : volume.provider}</TableCell>
      <TableCell>
        {volume.pricePerBlock && (
          <d.PricePerTimeUnit
            className="text-sm"
            perBlockValue={udenomToDenom(volume.pricePerBlock.amount, PRICE_DISPLAY_PRECISION)}
            denom={volume.pricePerBlock.denom}
          />
        )}
      </TableCell>
      <TableCell className="text-right">
        {isDisk && isLive && !isCopyingIn && (
          <Button variant="outline" size="sm" onClick={onMove} aria-label={`Move ${volume.name}`}>
            Move
          </Button>
        )}
        {isDisk && volume.state === "unleased" && (
          <Button size="sm" onClick={onChooseProvider} aria-label={`Choose a provider for ${volume.name}`}>
            Choose provider
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
};

const VolumeStateLabel: FC<{ volume: OwnedVolume; isCopyingIn: boolean; dependencies: typeof DEPENDENCIES }> = ({ volume, isCopyingIn, dependencies: d }) => {
  const countdown = d.useCountdown(volume.reclamationDeadline ?? null);

  if (isCopyingIn) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant="info">Copying in</Badge>
        <span className="text-xs text-muted-foreground">From its previous provider</span>
      </div>
    );
  }

  switch (volume.state) {
    case "available":
      return <Badge variant="success">Available</Badge>;
    case "mounted":
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="info">Mounted</Badge>
          {volume.mountedBy && (
            <Link href={UrlService.deploymentDetails(volume.mountedBy)} className="text-xs">
              by deployment {volume.mountedBy}
            </Link>
          )}
        </div>
      );
    case "closing":
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="secondary">Closing</Badge>
          <span className="text-xs text-muted-foreground">{countdown ? `Finishes closing in ${countdown}` : "Finishing closing now"}</span>
        </div>
      );
    case "moving":
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="secondary">Moving</Badge>
          <span className="text-xs text-muted-foreground">{countdown ? `Providers bid in ${countdown}` : "Providers bid now"}</span>
        </div>
      );
    case "reclaiming":
      return (
        <div className="flex flex-col items-start gap-1">
          <Badge variant="destructive">Reclaiming</Badge>
          <span className="text-xs text-muted-foreground">{countdown ? `Lease ends in ${countdown}` : "Lease ending now"}</span>
        </div>
      );
    default:
      return <Badge variant="outline">Not leased</Badge>;
  }
};

/** A volume's order re-lists under the next sequence each time a move or an eviction ends its lease. */
function wasMoved(volume: OwnedVolume): boolean {
  return (volume.oseq ?? 1) > 1;
}

function providerNameOf(volume: OwnedVolume, providers: ApiProviderList[]): string {
  const provider = providers.find(candidate => candidate.owner === volume.provider);
  return provider ? providerDisplayName(provider) : volume.provider ?? "its provider";
}

const RowPlaceholder: FC = () => (
  <TableRow data-testid="volume-placeholder">
    {["volume", "state", "size", "provider", "cost", "actions"].map(column => (
      <TableCell key={column}>
        <Skeleton className="h-4 w-24" />
      </TableCell>
    ))}
  </TableRow>
);
