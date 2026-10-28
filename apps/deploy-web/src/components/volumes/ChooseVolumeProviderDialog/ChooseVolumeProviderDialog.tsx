"use client";
import type { FC } from "react";
import { useId, useState } from "react";
import { extractApiErrorMessage } from "@akashnetwork/openapi-sdk";
import {
  Alert,
  Button,
  DialogV2,
  DialogV2Body,
  DialogV2Content,
  DialogV2Description,
  DialogV2Footer,
  DialogV2Header,
  DialogV2Title,
  LoadingButton,
  RadioGroup,
  Spinner
} from "@akashnetwork/ui/components";

import { PricePerTimeUnit } from "@src/components/shared/PricePerTimeUnit";
import { VolumeBidOption } from "@src/components/volumes/VolumeBidOption/VolumeBidOption";
import { useHasWaited } from "@src/hooks/useHasWaited/useHasWaited";
import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import { useProvidersByAddresses } from "@src/queries/useProvidersQuery";
import { useLeaseVolume, useVolumeBids } from "@src/queries/useVolumeMoveQueries";

export const DEPENDENCIES = { useVolumeBids, useLeaseVolume, useProvidersByAddresses, useHasWaited, PricePerTimeUnit };

/** A provider bids within a few blocks of seeing an order, so silence past this means none will. */
const NO_BID_HINT_DELAY_MS = 30_000;

type Props = {
  volume: OwnedVolume;
  onClose: () => void;
  dependencies?: typeof DEPENDENCIES;
};

export const ChooseVolumeProviderDialog: FC<Props> = ({ volume, onClose, dependencies: d = DEPENDENCIES }) => {
  const descriptionId = useId();
  const bids = d.useVolumeBids(volume.dseq);
  const lease = d.useLeaseVolume();
  const [provider, setProvider] = useState("");
  const { data: providers } = d.useProvidersByAddresses(bids.map(bid => bid.provider));
  const hasWaitedForBids = d.useHasWaited(bids.length === 0, NO_BID_HINT_DELAY_MS);
  const chosen = bids.find(bid => bid.provider === provider);
  const isBucket = volume.access === "bucket";

  const leaseTheVolume = () => {
    if (!chosen) return;
    lease.mutate({ leases: [{ dseq: volume.dseq, gseq: chosen.gseq, oseq: chosen.oseq, provider: chosen.provider }] }, { onSuccess: onClose });
  };

  return (
    <DialogV2 open onOpenChange={isOpen => !isOpen && !lease.isPending && onClose()}>
      <DialogV2Content className="max-w-lg" aria-describedby={descriptionId}>
        <DialogV2Header>
          <DialogV2Title>Choose a provider for {volume.name}</DialogV2Title>
          <DialogV2Description id={descriptionId}>
            {isBucket
              ? "Its last lease has ended. The provider you lease it from now copies its objects from the previous one, then gives out new access keys from the bucket's page."
              : "Its last lease has ended. The provider you lease it from now copies its data from the previous one before anything can mount it, and deployments that mount it run there."}
          </DialogV2Description>
        </DialogV2Header>
        <DialogV2Body className="flex flex-col gap-4">
          {bids.length === 0 ? (
            <>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner size="small" /> Waiting for providers to bid…
              </p>
              {hasWaitedForBids && (
                <p className="text-sm text-muted-foreground">
                  No provider has bid yet. Providers cap how large a volume they take and how long they keep its data after it closes.
                </p>
              )}
            </>
          ) : (
            <RadioGroup aria-label="Provider" value={provider} onValueChange={setProvider} className="flex flex-col gap-2">
              {bids.map(bid => (
                <VolumeBidOption
                  key={bid.provider}
                  id={`${descriptionId}-${bid.provider}`}
                  bid={bid}
                  provider={providers.find(candidate => candidate.owner === bid.provider)}
                  dependencies={d}
                />
              ))}
            </RadioGroup>
          )}
          {lease.isError && (
            <Alert variant="destructive">
              {extractApiErrorMessage(lease.error) ?? "The volume could not be leased from this provider. Choose another or try again."}
            </Alert>
          )}
        </DialogV2Body>
        <DialogV2Footer className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={lease.isPending}>
            Cancel
          </Button>
          <LoadingButton type="button" loading={lease.isPending} onClick={leaseTheVolume} disabled={!chosen}>
            {isBucket ? "Lease bucket" : "Lease volume"}
          </LoadingButton>
        </DialogV2Footer>
      </DialogV2Content>
    </DialogV2>
  );
};
