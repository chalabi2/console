"use client";
import type { FC } from "react";
import { useController, useFormContext, useWatch } from "react-hook-form";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@akashnetwork/ui/components";
import { ChevronDown, ChevronRight, LockIcon } from "lucide-react";

import type { SdlBuilderFormValuesType, ServiceType } from "@src/types";
import { memoryUnits, storageUnits } from "@src/utils/akash/units";
import { UpdateImageSection } from "./UpdateImageSection";
import { UpdateNetworkingSection } from "./UpdateNetworkingSection";
import { UpdateSectionRule } from "./UpdateSectionRule";

export interface UpdateServiceSectionProps {
  serviceIndex: number;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locked: boolean;
  /** Set where the provider can resize the lease in place, which makes the hardware editable. */
  canResize?: boolean;
}

const RESIZE_HELPER =
  "Changing the hardware or instances asks your provider to resize the lease in place. The new hardware applies once the provider accepts it, and the deployment keeps what it runs if the provider declines.";
const MOUNTED_VOLUME_HELPER = "This service mounts a persistent volume, so it keeps its instance count.";

type AmountName =
  | `services.${number}.profile.cpu`
  | `services.${number}.profile.ram`
  | `services.${number}.profile.gpu`
  | `services.${number}.profile.storage.${number}.size`
  | `services.${number}.count`;

type UnitName = `services.${number}.profile.ramUnit` | `services.${number}.profile.storage.${number}.unit`;

export const UpdateServiceSection: FC<UpdateServiceSectionProps> = ({ serviceIndex, title, open, onOpenChange, locked, canResize = false }) => {
  const image = useWatch<SdlBuilderFormValuesType, `services.${number}.image`>({ name: `services.${serviceIndex}.image` }) ?? "";

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="overflow-hidden rounded-lg border bg-background">
      <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {open ? <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />}
        <span className="text-base font-medium">{title}</span>
        <LockIcon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="ml-auto truncate font-mono text-sm text-muted-foreground">{imageTagOf(image)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div role="region" aria-label={title} className="flex flex-col gap-6 border-t px-4 py-5">
          <UpdateImageSection serviceIndex={serviceIndex} locked={locked} />
          {canResize ? <ResizableHardwareSection serviceIndex={serviceIndex} locked={locked} /> : <HardwareSection serviceIndex={serviceIndex} />}
          <UpdateNetworkingSection serviceIndex={serviceIndex} locked={locked} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

function imageTagOf(image: string): string {
  return image.split("/").pop() ?? image;
}

const HardwareSection: FC<{ serviceIndex: number }> = ({ serviceIndex }) => {
  const service = useWatch<SdlBuilderFormValuesType, `services.${number}`>({ name: `services.${serviceIndex}` });
  const storage = service?.profile?.storage?.[0];

  return (
    <div className="flex flex-col gap-3">
      <UpdateSectionRule
        title="Hardware"
        trailing={
          <span className="flex items-center gap-1">
            <LockIcon className="h-3 w-3" aria-hidden="true" />
            Fixed for this lease
          </span>
        }
      />
      <div className="grid gap-3 md:grid-cols-4">
        <FixedField label="vCPU" value={String(service?.profile?.cpu ?? "")} />
        <FixedField label="Memory" value={`${service?.profile?.ram ?? ""} ${service?.profile?.ramUnit ?? ""}`.trim()} />
        <FixedField label="Ephemeral storage" value={storage ? `${storage.size} ${storage.unit}` : ""} />
        <FixedField label="Instances" value={String(service?.count ?? "")} />
      </div>
    </div>
  );
};

/** A service that mounts a persistent volume keeps its instance count, which is how the chain resizes a lease that mounts one. */
const ResizableHardwareSection: FC<{ serviceIndex: number; locked: boolean }> = ({ serviceIndex, locked }) => {
  const service = useWatch<SdlBuilderFormValuesType, `services.${number}`>({ name: `services.${serviceIndex}` });
  const mountsVolume = mountsPersistentVolume(service);

  return (
    <div className="flex flex-col gap-3">
      <UpdateSectionRule title="Hardware" trailing="Resized in place" />
      <fieldset disabled={locked} className="m-0 grid min-w-0 gap-3 border-0 p-0 md:grid-cols-4">
        <AmountField label="vCPU" name={`services.${serviceIndex}.profile.cpu`} min={0.1} step={0.1} />
        <SizeField
          label="Memory"
          amountName={`services.${serviceIndex}.profile.ram`}
          unitName={`services.${serviceIndex}.profile.ramUnit`}
          units={memoryUnits}
        />
        <SizeField
          label="Ephemeral storage"
          amountName={`services.${serviceIndex}.profile.storage.0.size`}
          unitName={`services.${serviceIndex}.profile.storage.0.unit`}
          units={storageUnits}
        />
        {mountsVolume ? (
          <FixedField label="Instances" value={String(service?.count ?? "")} />
        ) : (
          <AmountField label="Instances" name={`services.${serviceIndex}.count`} min={1} step={1} />
        )}
        {service?.profile?.hasGpu && <AmountField label="GPUs" name={`services.${serviceIndex}.profile.gpu`} min={1} step={1} />}
      </fieldset>
      <p className="text-sm text-muted-foreground">{mountsVolume ? `${RESIZE_HELPER} ${MOUNTED_VOLUME_HELPER}` : RESIZE_HELPER}</p>
    </div>
  );
};

function mountsPersistentVolume(service: ServiceType | undefined): boolean {
  return !!service?.profile?.storage?.some(volume => volume.isPersistent);
}

const AmountField: FC<{ label: string; name: AmountName; min: number; step: number }> = ({ label, name, min, step }) => {
  const { control } = useFormContext<SdlBuilderFormValuesType>();
  const { field, fieldState } = useController({ control, name });

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <Input
        aria-label={label}
        type="number"
        min={min}
        step={step}
        value={field.value ?? ""}
        onChange={event => field.onChange(amountOf(event.target.value))}
        onBlur={field.onBlur}
        error={!!fieldState.error}
        inputClassName="h-10 font-mono"
      />
      {fieldState.error && <p className="text-xs text-destructive">{fieldState.error.message}</p>}
    </div>
  );
};

const SizeField: FC<{ label: string; amountName: AmountName; unitName: UnitName; units: Array<{ id: number; suffix: string }> }> = ({
  label,
  amountName,
  unitName,
  units
}) => {
  const { control } = useFormContext<SdlBuilderFormValuesType>();
  const amount = useController({ control, name: amountName });
  const unit = useController({ control, name: unitName });

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      <div className="flex gap-1">
        <Input
          aria-label={label}
          type="number"
          min={1}
          step={1}
          value={amount.field.value ?? ""}
          onChange={event => amount.field.onChange(amountOf(event.target.value))}
          onBlur={amount.field.onBlur}
          error={!!amount.fieldState.error}
          className="min-w-0 flex-1"
          inputClassName="h-10 font-mono"
        />
        <Select value={unit.field.value?.toLowerCase() ?? ""} onValueChange={unit.field.onChange}>
          <SelectTrigger aria-label={`${label} unit`} className="h-10 w-[75px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {units.map(option => (
                <SelectItem key={option.id} value={option.suffix.toLowerCase()}>
                  {option.suffix}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
      {amount.fieldState.error && <p className="text-xs text-destructive">{amount.fieldState.error.message}</p>}
    </div>
  );
};

/** An emptied box holds null, because the form reads an undefined field as unset and puts the loaded amount back. */
function amountOf(value: string): number | null {
  return value === "" ? null : Number(value);
}

const FixedField: FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex flex-col gap-1">
    <span className="text-sm">{label}</span>
    <Input aria-label={label} value={value} disabled readOnly inputClassName="h-10 border-dashed font-mono" />
  </div>
);
