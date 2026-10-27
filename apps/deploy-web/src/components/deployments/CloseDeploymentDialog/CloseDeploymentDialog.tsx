"use client";
import type { FC } from "react";
import { useId, useState } from "react";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  DialogV2,
  DialogV2Body,
  DialogV2Content,
  DialogV2Description,
  DialogV2Footer,
  DialogV2Header,
  DialogV2Title,
  Field,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from "@akashnetwork/ui/components";
import { TriangleAlertIcon } from "lucide-react";

import { type OwnedVolume, useOwnedVolumes } from "@src/queries/useOwnedVolumes";
import { volumeAfterCloseOf } from "@src/utils/volumeUtils";
import type { DeploymentCloseReason, DeploymentCloseReasonInput } from "./closeDeploymentReasons";
import { DEPLOYMENT_CLOSE_REASONS, MAX_CLOSE_REASON_DETAILS_LENGTH, toCloseReasonInput } from "./closeDeploymentReasons";

export const DEPENDENCIES = { useOwnedVolumes };

export type CloseDeploymentTarget = { dseqs: string[]; name?: string | null };

/** The volumes the closing deployments mount stay leased unless their owner chooses to close them too. */
export type CloseDeploymentConfirmation = { reason: DeploymentCloseReasonInput; volumeDseqs: string[] };

type Props = {
  target: CloseDeploymentTarget;
  onConfirm: (confirmation: CloseDeploymentConfirmation) => void;
  onCancel: () => void;
  dependencies?: typeof DEPENDENCIES;
};

export const CloseDeploymentDialog: FC<Props> = ({ target, onConfirm, onCancel, dependencies: d = DEPENDENCIES }) => {
  const [closeReason, setCloseReason] = useState<DeploymentCloseReason>();
  const [details, setDetails] = useState("");
  const [volumeDseqsToClose, setVolumeDseqsToClose] = useState<string[]>([]);
  const fieldIds = { reason: useId(), details: useId(), volumes: useId() };
  const { volumes } = d.useOwnedVolumes();
  const count = target.dseqs.length;
  const isClosingSeveral = count > 1;
  const closingVolume = isClosingSeveral ? undefined : volumes.find(volume => volume.dseq === target.dseqs[0]);
  const mountedVolumes = volumes.filter(volume => !!volume.mountedBy && target.dseqs.includes(volume.mountedBy));

  function confirmWithReason() {
    if (closeReason) onConfirm({ reason: toCloseReasonInput(closeReason, details), volumeDseqs: volumeDseqsToClose });
  }

  function chooseToClose(volume: OwnedVolume, isClosing: boolean) {
    setVolumeDseqsToClose(dseqs => (isClosing ? [...dseqs, volume.dseq] : dseqs.filter(dseq => dseq !== volume.dseq)));
  }

  if (closingVolume) {
    return (
      <DialogV2 open onOpenChange={isOpen => (!isOpen ? onCancel() : undefined)}>
        <DialogV2Content className="max-w-md">
          <DialogV2Header>
            <DialogV2Title>Close this volume?</DialogV2Title>
            <DialogV2Description>
              <span className="font-semibold text-foreground">{closingVolume.name}</span> stays leased through its reclamation window, then closes, and no
              deployment can mount it again. This can&apos;t be undone.
            </DialogV2Description>
          </DialogV2Header>

          <DialogV2Body className="flex flex-col gap-4">
            {volumeAfterCloseOf(closingVolume) && (
              <Alert variant="destructive" className="bg-destructive/10 p-4 text-foreground">
                <TriangleAlertIcon className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{volumeAfterCloseOf(closingVolume)}</AlertDescription>
              </Alert>
            )}

            <CloseReasonFields
              closeReason={closeReason}
              onCloseReasonChange={setCloseReason}
              details={details}
              onDetailsChange={setDetails}
              label="Why are you closing this volume?"
              ids={fieldIds}
            />
          </DialogV2Body>

          <DialogV2Footer className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={!closeReason} onClick={confirmWithReason}>
              Close volume
            </Button>
          </DialogV2Footer>
        </DialogV2Content>
      </DialogV2>
    );
  }

  return (
    <DialogV2 open onOpenChange={isOpen => (!isOpen ? onCancel() : undefined)}>
      <DialogV2Content className="max-w-md">
        <DialogV2Header>
          <DialogV2Title>{isClosingSeveral ? `Close ${count} deployments?` : "Close this deployment?"}</DialogV2Title>
          <DialogV2Description>
            {isClosingSeveral ? (
              <>Closing these {count} deployments settles their leases and permanently tears them down. This can&apos;t be undone.</>
            ) : (
              <>
                Closing <span className="font-semibold text-foreground">{target.name || `deployment ${target.dseqs[0]}`}</span> settles its leases and
                permanently tears it down. This can&apos;t be undone.
              </>
            )}
          </DialogV2Description>
        </DialogV2Header>

        <DialogV2Body className="flex flex-col gap-4">
          <Alert variant="destructive" className="bg-destructive/10 p-4 text-foreground">
            <TriangleAlertIcon className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>
              {isClosingSeveral
                ? "All services stop immediately and the deployment URLs stop resolving. Any unspent balance is returned to your wallet. You'll need to create new deployments to run these workloads again."
                : "All services stop immediately and the deployment URL stops resolving. Any unspent balance is returned to your wallet. You'll need to create a new deployment to run this workload again."}
            </AlertDescription>
          </Alert>

          {mountedVolumes.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{isClosingSeveral ? "Volumes they mount" : "Volumes it mounts"}</legend>
              <p className="text-sm text-muted-foreground">
                A volume outlives the deployments that mount it and stays leased until you close it. Keep it to mount it in another deployment.
              </p>
              {mountedVolumes.map(volume => (
                <div key={volume.dseq} className="flex items-start gap-3">
                  <Checkbox
                    id={`${fieldIds.volumes}-${volume.dseq}`}
                    checked={volumeDseqsToClose.includes(volume.dseq)}
                    onCheckedChange={checked => chooseToClose(volume, checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor={`${fieldIds.volumes}-${volume.dseq}`} className="cursor-pointer text-sm">
                    Also close {volume.name}
                    {volumeAfterCloseOf(volume) && <span className="block text-xs text-muted-foreground">{volumeAfterCloseOf(volume)}</span>}
                  </label>
                </div>
              ))}
            </fieldset>
          )}

          <CloseReasonFields
            closeReason={closeReason}
            onCloseReasonChange={setCloseReason}
            details={details}
            onDetailsChange={setDetails}
            label={isClosingSeveral ? "Why are you closing these deployments?" : "Why are you closing this deployment?"}
            ids={fieldIds}
          />
        </DialogV2Body>

        <DialogV2Footer className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={!closeReason} onClick={confirmWithReason}>
            {isClosingSeveral ? `Close ${count} deployments` : "Close deployment"}
          </Button>
        </DialogV2Footer>
      </DialogV2Content>
    </DialogV2>
  );
};

const CloseReasonFields: FC<{
  closeReason: DeploymentCloseReason | undefined;
  onCloseReasonChange: (reason: DeploymentCloseReason) => void;
  details: string;
  onDetailsChange: (details: string) => void;
  label: string;
  ids: { reason: string; details: string };
}> = ({ closeReason, onCloseReasonChange, details, onDetailsChange, label, ids }) => (
  <>
    <Field className="gap-2">
      <FieldLabel htmlFor={ids.reason}>{label}</FieldLabel>
      <Select value={closeReason} onValueChange={value => onCloseReasonChange(value as DeploymentCloseReason)}>
        <SelectTrigger id={ids.reason}>
          <SelectValue placeholder="Select a reason" />
        </SelectTrigger>
        <SelectContent>
          {DEPLOYMENT_CLOSE_REASONS.map(option => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>

    {closeReason === "other" && (
      <Field className="gap-2">
        <FieldLabel htmlFor={ids.details}>Tell us more (optional)</FieldLabel>
        <Textarea
          id={ids.details}
          rows={3}
          maxLength={MAX_CLOSE_REASON_DETAILS_LENGTH}
          value={details}
          onChange={event => onDetailsChange(event.target.value)}
        />
      </Field>
    )}
  </>
);
