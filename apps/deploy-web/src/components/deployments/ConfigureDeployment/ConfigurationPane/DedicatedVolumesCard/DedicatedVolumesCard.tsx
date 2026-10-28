import type { FC } from "react";
import { useCallback, useState } from "react";
import { useController, useFieldArray, useFormContext, useWatch } from "react-hook-form";
import {
  Button,
  Checkbox,
  CollapsibleCard,
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@akashnetwork/ui/components";
import { DatabaseIcon, PlusIcon, TrashIcon } from "lucide-react";

import { type CreatedVolume, CreateVolumeDialog } from "@src/components/volumes/CreateVolumeDialog/CreateVolumeDialog";
import { type OwnedVolume, useOwnedVolumes, volumeKeyOf } from "@src/queries/useOwnedVolumes";
import { useProvidersByAddresses } from "@src/queries/useProvidersQuery";
import type { AttachedVolumeType, SdlBuilderFormValuesType } from "@src/types";
import { providerDisplayName } from "@src/utils/providerUtils";
import { formatByteSize } from "@src/utils/unitUtils";
import { dedicatedVolumesTooltip } from "../cardTooltips";
import { SELECT_TRUNCATE_VALUE } from "../selectStyles";

export const DEPENDENCIES = { CollapsibleCard, CreateVolumeDialog, useOwnedVolumes, useProvidersByAddresses };

const DEFAULT_MOUNT = "/data";

type Props = {
  serviceIndex: number;
  locked?: boolean;
  dependencies?: typeof DEPENDENCIES;
};

/** A disk is offered while it holds a lease and nothing else mounts it, since a disk takes one attachment at a time; a bucket is never mounted. */
export const DedicatedVolumesCard: FC<Props> = ({ serviceIndex, locked = false, dependencies: d = DEPENDENCIES }) => {
  const { control, getValues } = useFormContext<SdlBuilderFormValuesType>();
  const { fields, append, remove, update } = useFieldArray({ control, name: `services.${serviceIndex}.volumes`, keyName: "key" });
  const services = useWatch({ control, name: "services" });
  const placements = useWatch({ control, name: "placements" });
  const { volumes: ownedVolumes } = d.useOwnedVolumes();
  const [isCreatingVolume, setIsCreatingVolume] = useState(false);

  const isEnabled = fields.length > 0;
  const placement = placements?.find(candidate => candidate.id === services?.[serviceIndex]?.placementId);
  const mountedHere = services?.[serviceIndex]?.volumes ?? [];
  const mountedByOtherServices = new Set(
    (services ?? []).flatMap((service, index) => (index === serviceIndex ? [] : (service.volumes ?? []).map(volume => volumeKeyOf(volume))))
  );
  const free = ownedVolumes.filter(volume => volume.state === "available" && volume.access === "mount" && !mountedByOtherServices.has(volumeKeyOf(volume)));
  const providerAddresses = [...new Set(mountedHere.flatMap(volume => ownedVolumes.find(owned => volumeKeyOf(owned) === volumeKeyOf(volume))?.provider ?? []))];
  const { data: providers } = d.useProvidersByAddresses(providerAddresses);

  const appendVolume = useCallback(() => {
    const mounts = new Set((getValues(`services.${serviceIndex}.volumes`) ?? []).map(volume => volume.mount));
    append({ name: "", dseq: "", mount: nextAvailableMount(mounts), isReadOnly: false }, { shouldFocus: false });
  }, [append, getValues, serviceIndex]);

  const mountCreatedVolume = useCallback(
    (volume: CreatedVolume) => {
      const rows = getValues(`services.${serviceIndex}.volumes`) ?? [];
      const emptyIndex = rows.findIndex(row => !row.dseq);
      if (emptyIndex >= 0) update(emptyIndex, { ...rows[emptyIndex], ...volume });
      else append({ ...volume, mount: nextAvailableMount(new Set(rows.map(row => row.mount))), isReadOnly: false }, { shouldFocus: false });
    },
    [append, getValues, serviceIndex, update]
  );

  const toggleVolumes = useCallback(
    (checked: boolean) => {
      if (checked && !isEnabled) appendVolume();
      else if (!checked && isEnabled) remove();
    },
    [appendVolume, isEnabled, remove]
  );

  const providerName = (address: string) => {
    const provider = providers.find(candidate => candidate.owner === address);
    return provider ? providerDisplayName(provider) : address;
  };

  return (
    <d.CollapsibleCard
      locked={locked}
      title="Dedicated Volumes"
      icon={<DatabaseIcon className="h-4 w-4" />}
      infoTooltip={dedicatedVolumesTooltip}
      isToggled={isEnabled}
      onToggle={toggleVolumes}
      toggleAriaLabel="Mount a dedicated volume"
      toggleDisabled={locked}
    >
      {isEnabled ? (
        <>
          {fields.map((field, index) => (
            <VolumeMountFields
              key={field.key}
              serviceIndex={serviceIndex}
              volumeIndex={index}
              options={optionsFor(free, mountedHere, index)}
              disabled={locked}
              onRemove={fields.length > 1 ? () => remove(index) : undefined}
            />
          ))}

          {free.length === 0 && mountedHere.every(volume => !volume.dseq) && (
            <p className="text-sm text-muted-foreground">You have no volume free to mount. A volume is leased as its own deployment.</p>
          )}

          {providerAddresses.length === 1 && (
            <p className="text-sm text-muted-foreground">This service runs on {providerName(providerAddresses[0])}, the provider holding its volumes.</p>
          )}

          {providerAddresses.length > 1 && (
            <p className="text-sm text-destructive">
              These volumes are leased from different providers, and a service can only run where every volume it mounts is.
            </p>
          )}

          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setIsCreatingVolume(true)} disabled={locked || !placement}>
            Create a volume
          </Button>

          <div className="flex justify-end">
            <button
              type="button"
              aria-label="Mount another volume"
              onClick={appendVolume}
              disabled={locked}
              className="flex w-full items-center justify-center rounded-md py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <PlusIcon className="h-4 w-4" />
            </button>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No dedicated volume is mounted.</p>
      )}

      {isCreatingVolume && placement && (
        <d.CreateVolumeDialog
          open
          onOpenChange={setIsCreatingVolume}
          placement={placement}
          takenNames={ownedVolumes.map(volume => volume.name)}
          onCreated={mountCreatedVolume}
        />
      )}
    </d.CollapsibleCard>
  );
};

type VolumeOption = Pick<OwnedVolume, "name" | "owner" | "dseq"> & Partial<Pick<OwnedVolume, "sizeBytes" | "storageClass">>;

type VolumeMountFieldsProps = {
  serviceIndex: number;
  volumeIndex: number;
  options: VolumeOption[];
  disabled: boolean;
  onRemove?: () => void;
};

const VolumeMountFields: FC<VolumeMountFieldsProps> = ({ serviceIndex, volumeIndex, options, disabled, onRemove }) => {
  const { control, setValue } = useFormContext<SdlBuilderFormValuesType>();
  const basePath = `services.${serviceIndex}.volumes.${volumeIndex}` as const;
  const name = useController({ control, name: `${basePath}.name` });
  const mount = useController({ control, name: `${basePath}.mount` });
  const isReadOnly = useController({ control, name: `${basePath}.isReadOnly` });
  const owner = useWatch({ control, name: `${basePath}.owner` });
  const dseq = useWatch({ control, name: `${basePath}.dseq` });
  const label = `Volume ${volumeIndex + 1}`;

  const chooseVolume = (key: string) => {
    const volume = options.find(option => volumeKeyOf(option) === key);
    if (!volume) return;
    setValue(`${basePath}.owner`, volume.owner);
    setValue(`${basePath}.dseq`, volume.dseq);
    name.field.onChange(volume.name);
  };

  return (
    <div role="group" aria-label={label} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase text-muted-foreground">{label}</span>
        {onRemove && (
          <Button size="icon" type="button" variant="ghost" className="h-6 w-6" aria-label={`Remove ${label}`} onClick={onRemove} disabled={disabled}>
            <TrashIcon className="h-4 w-4" />
          </Button>
        )}
      </div>

      <Field className="gap-2">
        <FieldLabel>Volume</FieldLabel>
        <FieldContent>
          <Select value={dseq ? volumeKeyOf({ owner, dseq }) : ""} onValueChange={chooseVolume} disabled={disabled}>
            <SelectTrigger aria-label="Volume" className={`h-9 ${SELECT_TRUNCATE_VALUE}`}>
              <SelectValue placeholder="Choose a volume" />
            </SelectTrigger>
            <SelectContent>
              {options.map(option => (
                <SelectItem key={volumeKeyOf(option)} value={volumeKeyOf(option)}>
                  {optionLabelOf(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError>{name.fieldState.error?.message}</FieldError>
        </FieldContent>
      </Field>

      <Field className="gap-2">
        <FieldLabel htmlFor={`volume-${serviceIndex}-${volumeIndex}-mount`}>Mount</FieldLabel>
        <FieldContent>
          <Input
            id={`volume-${serviceIndex}-${volumeIndex}-mount`}
            aria-label="Volume mount"
            value={mount.field.value ?? ""}
            onChange={mount.field.onChange}
            disabled={disabled}
            inputClassName="h-9"
          />
          {mount.fieldState.error && <p className="pl-1 text-xs text-destructive">{mount.fieldState.error.message}</p>}
        </FieldContent>
      </Field>

      <div className="flex items-center gap-2">
        <Checkbox
          id={`volume-${serviceIndex}-${volumeIndex}-readonly`}
          checked={!!isReadOnly.field.value}
          onCheckedChange={isReadOnly.field.onChange}
          disabled={disabled}
        />
        <Label htmlFor={`volume-${serviceIndex}-${volumeIndex}-readonly`}>Read only</Label>
      </div>
    </div>
  );
};

/** A row offers the free volumes no other row of the service took, and keeps the one it holds even when that one no longer reads as free. */
function optionsFor(free: OwnedVolume[], mountedHere: AttachedVolumeType[], rowIndex: number): VolumeOption[] {
  const takenByOtherRows = new Set(mountedHere.flatMap((volume, index) => (index === rowIndex || !volume.dseq ? [] : [volumeKeyOf(volume)])));
  const options: VolumeOption[] = free.filter(volume => !takenByOtherRows.has(volumeKeyOf(volume)));
  const held = mountedHere[rowIndex];

  if (held?.dseq && !options.some(option => volumeKeyOf(option) === volumeKeyOf(held))) {
    options.push({ name: held.name, owner: held.owner ?? "", dseq: held.dseq });
  }

  return options;
}

function optionLabelOf(option: VolumeOption): string {
  return [option.name, option.sizeBytes ? formatByteSize(option.sizeBytes) : undefined, option.storageClass].filter(Boolean).join(" · ");
}

function nextAvailableMount(taken: Set<string>): string {
  if (!taken.has(DEFAULT_MOUNT)) return DEFAULT_MOUNT;

  let suffix = 1;
  while (taken.has(`${DEFAULT_MOUNT}-${suffix}`)) suffix++;
  return `${DEFAULT_MOUNT}-${suffix}`;
}
