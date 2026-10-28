"use client";
import type { FC } from "react";
import { useId } from "react";
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
  LoadingButton
} from "@akashnetwork/ui/components";

import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import { useMoveVolume } from "@src/queries/useVolumeMoveQueries";

export const DEPENDENCIES = { useMoveVolume };

type Props = {
  volume: OwnedVolume;
  providerName: string;
  onClose: () => void;
  dependencies?: typeof DEPENDENCIES;
};

export const MoveVolumeDialog: FC<Props> = ({ volume, providerName, onClose, dependencies: d = DEPENDENCIES }) => {
  const descriptionId = useId();
  const move = d.useMoveVolume();
  const isBucket = volume.access === "bucket";

  const moveTheVolume = () => {
    move.mutate({ dseq: volume.dseq }, { onSuccess: onClose });
  };

  return (
    <DialogV2 open onOpenChange={isOpen => !isOpen && !move.isPending && onClose()}>
      <DialogV2Content className="max-w-lg" aria-describedby={descriptionId}>
        <DialogV2Header>
          <DialogV2Title>Move {volume.name} to another provider</DialogV2Title>
          <DialogV2Description id={descriptionId}>
            {isBucket
              ? `Its lease with ${providerName} ends after its reclamation window, and its access keys stop working then. Providers then bid to take it: choose one here, and it copies the bucket's objects from ${providerName} before it gives out new keys.`
              : `Its lease with ${providerName} ends after its reclamation window. Providers then bid to take it: choose one here, and it copies the volume's data from ${providerName} before anything can mount it.`}
          </DialogV2Description>
        </DialogV2Header>
        <DialogV2Body className="flex flex-col gap-3">
          {isBucket && (
            <Alert>
              The bucket gets a new endpoint and new access keys at its new provider. Deployments connected to it lose access when the lease ends, so connect
              them again once the move is done.
            </Alert>
          )}
          {volume.mountedBy && (
            <Alert>
              Deployment {volume.mountedBy} mounts it. It keeps running until the lease ends and then stops, so deploy it again on the new provider once the
              move is done.
            </Alert>
          )}
          {move.isError && <Alert variant="destructive">{extractApiErrorMessage(move.error) ?? "Couldn't start the move. Please try again."}</Alert>}
        </DialogV2Body>
        <DialogV2Footer className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={move.isPending}>
            Cancel
          </Button>
          <LoadingButton type="button" loading={move.isPending} onClick={moveTheVolume}>
            {isBucket ? "Move bucket" : "Move volume"}
          </LoadingButton>
        </DialogV2Footer>
      </DialogV2Content>
    </DialogV2>
  );
};
