"use client";
import type { FC, FormEvent } from "react";
import { useState } from "react";
import { Alert, Button, Input, Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@akashnetwork/ui/components";
import { HardDrive } from "lucide-react";

import { useCancelDeploymentResize } from "@src/hooks/useCancelDeploymentResize/useCancelDeploymentResize";
import { useFailedDeploymentUpdate } from "@src/hooks/useFailedDeploymentUpdate/useFailedDeploymentUpdate";
import { useFlag } from "@src/hooks/useFlag";
import { usePendingDeploymentResize } from "@src/hooks/usePendingDeploymentResize/usePendingDeploymentResize";
import { useUpdatingDeployments } from "@src/hooks/useUpdatingDeployments/useUpdatingDeployments";
import type { DeploymentDto, LeaseDto } from "@src/types/deployment";
import { storageUnits } from "@src/utils/akash/units";
import { formatByteSize } from "@src/utils/unitUtils";
import { DeploymentTabHeader } from "../DeploymentTabHeader";
import { useVolumeGrowSubmit } from "./useVolumeGrowSubmit";
import { bytesOf, type DeclaredVolume, sizeTextOf, type VolumeSize, volumeSizeOf } from "./volumeDeclarations";

export const DEPENDENCIES = {
  useFlag,
  useUpdatingDeployments,
  useFailedDeploymentUpdate,
  usePendingDeploymentResize,
  useCancelDeploymentResize,
  useVolumeGrowSubmit
};

const GROW_HELPER = "Growing a volume asks your provider to resize its lease in place. A volume can only grow, and it keeps its size if the provider declines.";
const GROW_UNAVAILABLE_NOTICE = "Growing a volume in place is not available yet, so a volume keeps the size it was created with.";
const RESIZE_PENDING_NOTICE =
  "Your provider has yet to grow the volume. Nothing else about this deployment can change until it answers or you cancel the resize.";
const NOT_APPLIED_NOTICE = "The volume didn't grow to the size this deployment asks for, so it keeps the size it holds.";
const APPLYING_NOTICE = "The volume is being grown. You'll get a notification when it's done.";
const CLOSED_NOTICE = "This volume's deployment is closed, so its size can no longer change.";

export interface VolumeUpdateProps {
  deployment: DeploymentDto;
  leases: LeaseDto[] | null | undefined;
  volumes: DeclaredVolume[];
  manifestVersion: string;
  onUpdated: () => void;
  dependencies?: typeof DEPENDENCIES;
}

/** A volume's own deployment runs no service, so the one thing an update can change about it is the size of the volumes it declares. */
export const VolumeUpdate: FC<VolumeUpdateProps> = ({ deployment, leases, volumes, manifestVersion, onUpdated, dependencies: d = DEPENDENCIES }) => {
  const canResize = d.useFlag("lease_resize");
  const declaredSizes = Object.fromEntries(volumes.map(volume => [volume.name, volumeSizeOf(volume.size)]));
  const [sizes, setSizes] = useState(declaredSizes);
  const [shrinkRefusal, setShrinkRefusal] = useState<string | null>(null);
  const [hasWithdrawnResize, setHasWithdrawnResize] = useState(false);
  const isApplyingInBackground = d.useUpdatingDeployments().has(deployment.dseq);
  const failedUpdate = d.useFailedDeploymentUpdate(deployment.dseq);
  const pendingResize = d.usePendingDeploymentResize(deployment.dseq);
  const { cancel: cancelResize, isCanceling: isCancelingResize } = d.useCancelDeploymentResize(deployment.dseq);
  const { submit, isSubmitting, refusal, isHeldByPendingResize } = d.useVolumeGrowSubmit({ dseq: deployment.dseq, manifestVersion, onSubmitted: onUpdated });

  const isClosed = deployment.state !== "active";
  const isBusy = isSubmitting || isApplyingInBackground;
  const isResizeAwaited = !isClosed && !hasWithdrawnResize && (isHeldByPendingResize || !!pendingResize);
  const heldBytes = Object.fromEntries(volumes.map(volume => [volume.name, heldBytesOf(leases, volume.name)]));
  const targets = volumes.flatMap(volume => targetOf(volume.name, sizes[volume.name], heldBytes[volume.name], declaredSizes[volume.name]));
  const isAhead = volumes.some(volume => isAheadOfLease(declaredSizes[volume.name], heldBytes[volume.name]));
  const isEdited = volumes.some(volume => !isSameSize(sizes[volume.name], declaredSizes[volume.name]));
  const isLocked = !canResize || isClosed || isBusy || isResizeAwaited;

  const withdrawTheResize = async () => {
    if (await cancelResize()) setHasWithdrawnResize(true);
  };

  const growTheVolumes = (event: FormEvent) => {
    event.preventDefault();
    const shrunk = volumes.find(volume => isShrunk(sizes[volume.name], heldBytes[volume.name]));
    if (shrunk) {
      setShrinkRefusal(`Volume "${shrunk.name}" holds ${formatByteSize(heldBytes[shrunk.name] ?? 0)} and can only grow, so set a larger size.`);
      return;
    }

    setShrinkRefusal(null);
    setHasWithdrawnResize(false);
    void submit(Object.fromEntries(targets));
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={growTheVolumes}>
      <DeploymentTabHeader
        title="Volumes"
        actions={
          <span className="text-sm text-muted-foreground">
            {volumes.length} {volumes.length === 1 ? "volume" : "volumes"}
          </span>
        }
      />

      {volumes.map(volume => (
        <section key={volume.name} role="group" aria-label={`Volume ${volume.name}`} className="rounded-xl border bg-card">
          <div className="flex flex-col gap-4 border-b p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <HardDrive className="h-4 w-4" aria-hidden="true" />
              </div>
              <h3 className="text-2xl font-medium tracking-tight">{volume.name}</h3>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <VolumeFact label="Holds" value={heldBytes[volume.name] === undefined ? "—" : formatByteSize(heldBytes[volume.name]!)} />
              <VolumeFact label="Class" value={volume.storageClass ?? "default"} />
              <VolumeFact label="After close" value={lifecycleOf(volume)} />
            </dl>
          </div>
          <div className="flex flex-col gap-3 p-6">
            <VolumeSizeField
              label="Size"
              size={sizes[volume.name]}
              declared={volume.size}
              disabled={isLocked}
              onChange={size => setSizes(current => ({ ...current, [volume.name]: size }))}
            />
            <p className="text-sm text-muted-foreground">{canResize ? GROW_HELPER : GROW_UNAVAILABLE_NOTICE}</p>
          </div>
        </section>
      ))}

      {isAhead && failedUpdate && !isResizeAwaited && !isClosed && (
        <Alert variant="destructive">
          {NOT_APPLIED_NOTICE} {failedUpdate.meta.error?.message}
        </Alert>
      )}

      {isResizeAwaited && (
        <Alert className="flex flex-wrap items-center justify-between gap-3">
          <span>{RESIZE_PENDING_NOTICE}</span>
          <Button type="button" variant="outline" size="sm" disabled={isCancelingResize} onClick={withdrawTheResize}>
            Cancel resize
          </Button>
        </Alert>
      )}

      {(shrinkRefusal ?? refusal) && <Alert variant="destructive">{shrinkRefusal ?? refusal}</Alert>}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-muted/95 py-4 backdrop-blur">
        {isClosed ? (
          <p className="mr-auto text-sm text-muted-foreground">{CLOSED_NOTICE}</p>
        ) : (
          <>
            {isApplyingInBackground && <p className="mr-auto text-sm text-muted-foreground">{APPLYING_NOTICE}</p>}
            <Button type="button" variant="outline" disabled={!isEdited || isBusy} onClick={() => setSizes(declaredSizes)}>
              Discard changes
            </Button>
            <Button type="submit" disabled={isLocked || targets.length === 0 || !(isEdited || isAhead)}>
              {isBusy ? "Growing…" : volumes.length === 1 ? "Grow volume" : "Grow volumes"}
            </Button>
          </>
        )}
      </div>
    </form>
  );
};

const VolumeFact: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col gap-0.5">
    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="font-medium">{value}</dd>
  </div>
);

const VolumeSizeField: FC<{ label: string; size: VolumeSize | null; declared: string; disabled: boolean; onChange: (size: VolumeSize) => void }> = ({
  label,
  size,
  declared,
  disabled,
  onChange
}) => {
  if (!size) return <Input aria-label={label} value={declared} disabled readOnly inputClassName="h-10 border-dashed font-mono" />;

  return (
    <div className="flex max-w-xs flex-col gap-1">
      <span className="text-sm">{label}</span>
      <div className="flex gap-1">
        <Input
          aria-label={label}
          type="number"
          min={1}
          step={1}
          value={Number.isNaN(size.amount) ? "" : size.amount}
          disabled={disabled}
          onChange={event => onChange({ ...size, amount: event.target.value === "" ? NaN : Number(event.target.value) })}
          className="min-w-0 flex-1"
          inputClassName="h-10 font-mono"
        />
        <Select value={size.unit} disabled={disabled} onValueChange={unit => onChange({ ...size, unit })}>
          <SelectTrigger aria-label={`${label} unit`} className="h-10 w-[75px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {storageUnits.map(option => (
                <SelectItem key={option.id} value={option.suffix}>
                  {option.suffix}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};

/** A volume's own lease holds exactly one storage entry, named after the volume. */
function heldBytesOf(leases: LeaseDto[] | null | undefined, volumeName: string): number | undefined {
  const lease = leases?.find(candidate =>
    candidate.group?.group_spec.resources.some(unit => unit.resource.storage.some(storage => storage.name === volumeName))
  );

  return lease?.storageAmount;
}

/** The size to send: an edited size, or the size the definition holds ahead of a lease that never grew to it. */
function targetOf(name: string, edited: VolumeSize | null, held: number | undefined, declared: VolumeSize | null): Array<[string, string]> {
  if (!edited || Number.isNaN(edited.amount) || edited.amount <= 0) return [];
  if (!isSameSize(edited, declared) || isAheadOfLease(declared, held)) return [[name, sizeTextOf(edited)]];

  return [];
}

function isAheadOfLease(declared: VolumeSize | null, held: number | undefined): boolean {
  return !!declared && held !== undefined && bytesOf(declared) > held;
}

function isShrunk(size: VolumeSize | null, held: number | undefined): boolean {
  return !!size && held !== undefined && bytesOf(size) < held;
}

function isSameSize(left: VolumeSize | null, right: VolumeSize | null): boolean {
  return left?.amount === right?.amount && left?.unit === right?.unit;
}

function lifecycleOf({ reclaim, retention }: DeclaredVolume): string {
  if (reclaim === "delete") return "Deleted";

  return retention ? `Kept ${retention}` : "Kept";
}
