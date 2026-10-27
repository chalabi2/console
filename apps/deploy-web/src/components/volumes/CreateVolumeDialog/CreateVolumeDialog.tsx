"use client";
import type { FC } from "react";
import { useId, useState } from "react";
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
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Label,
  NumberUnitInput,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner
} from "@akashnetwork/ui/components";

import { SELECT_TRUNCATE_VALUE } from "@src/components/deployments/ConfigureDeployment/ConfigurationPane/selectStyles";
import { getProviderRegion } from "@src/components/deployments/DeploymentDetail/DeploymentPlacements/placementModel";
import { PricePerTimeUnit } from "@src/components/shared/PricePerTimeUnit";
import { useWallet } from "@src/context/WalletProvider";
import { useHasWaited } from "@src/hooks/useHasWaited/useHasWaited";
import { useProvidersByAddresses } from "@src/queries/useProvidersQuery";
import type { PlacementType } from "@src/types";
import type { ApiProviderList } from "@src/types/provider";
import { persistentStorageTypes, storageUnits } from "@src/utils/akash/units";
import { PRICE_DISPLAY_PRECISION, udenomToDenom } from "@src/utils/mathHelpers";
import { providerDisplayName } from "@src/utils/providerUtils";
import { defaultPricing } from "@src/utils/sdl/data";
import { volumeSdlOf } from "@src/utils/sdl/volumeSdl";
import { useCreateVolume, type VolumeBid } from "./useCreateVolume";

export const DEPENDENCIES = { useCreateVolume, useWallet, useProvidersByAddresses, useHasWaited, NumberUnitInput, PricePerTimeUnit };

/** A provider bids within a few blocks of seeing an order, so silence past this means none will. */
const NO_BID_HINT_DELAY_MS = 30_000;

/** The chain names a volume with a DNS label, which also keys the service's storage params. */
const VOLUME_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

const DELETE_AT_CLOSE = "delete";

/** Retention runs up to the chain's `max_volume_retention`, which is 30 days. */
const AFTER_CLOSE_OPTIONS = [
  { value: DELETE_AT_CLOSE, label: "Delete its data" },
  { value: "24h", label: "Keep its data for 1 day" },
  { value: "168h", label: "Keep its data for 7 days" },
  { value: "720h", label: "Keep its data for 30 days" }
];

export interface CreatedVolume {
  name: string;
  owner: string;
  dseq: string;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placement: PlacementType;
  takenNames: string[];
  onCreated: (volume: CreatedVolume) => void;
  dependencies?: typeof DEPENDENCIES;
};

export const CreateVolumeDialog: FC<Props> = ({ open, onOpenChange, placement, takenNames, onCreated, dependencies: d = DEPENDENCIES }) => {
  const descriptionId = useId();
  const { address } = d.useWallet();
  const { step, bids, create, lease, abandon } = d.useCreateVolume();
  const [name, setName] = useState("data");
  const [size, setSize] = useState<number | undefined>(10);
  const [unit, setUnit] = useState("Gi");
  const [storageClass, setStorageClass] = useState("beta3");
  const [afterClose, setAfterClose] = useState("168h");
  const [provider, setProvider] = useState("");
  const { data: providers } = d.useProvidersByAddresses(bids.map(bid => bid.provider));

  const nameError = volumeNameErrorOf(name, takenNames);
  const isBusy = step.kind === "creating" || step.kind === "leasing";

  const createTheVolume = () => {
    void create({
      name,
      sdl: volumeSdlOf({
        name,
        size: size ?? 0,
        unit,
        storageClass,
        retention: afterClose === DELETE_AT_CLOSE ? undefined : afterClose,
        placement,
        pricing: defaultPricing()
      })
    });
  };

  const leaseTheVolume = async () => {
    const dseq = await lease(provider);
    if (!dseq) return;
    onCreated({ name, owner: address, dseq });
    onOpenChange(false);
  };

  const hasWaitedForBids = d.useHasWaited(step.kind === "choosing" && bids.length === 0, NO_BID_HINT_DELAY_MS);

  const changeSettings = () => {
    void abandon();
  };

  const closeWithoutAVolume = () => {
    void abandon();
    onOpenChange(false);
  };

  return (
    <DialogV2 open={open} onOpenChange={next => (next ? onOpenChange(true) : !isBusy && closeWithoutAVolume())}>
      <DialogV2Content className="max-w-lg" aria-describedby={descriptionId}>
        <DialogV2Header>
          <DialogV2Title>Create a volume</DialogV2Title>
          <DialogV2Description id={descriptionId}>
            A volume is leased as its own deployment, so its data outlives the deployments that mount it. Whatever mounts it runs on the provider you lease it
            from.
          </DialogV2Description>
        </DialogV2Header>

        <DialogV2Body className="flex flex-col gap-4">
          {(step.kind === "editing" || step.kind === "creating") && (
            <>
              <Field className="gap-2">
                <FieldLabel htmlFor={`${descriptionId}-name`}>Name</FieldLabel>
                <FieldContent>
                  <Input
                    id={`${descriptionId}-name`}
                    aria-label="Volume name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    disabled={isBusy}
                    inputClassName="h-9"
                  />
                  {nameError && <p className="pl-1 text-xs text-destructive">{nameError}</p>}
                </FieldContent>
              </Field>

              <Field className="gap-2">
                <FieldLabel>Size</FieldLabel>
                <FieldContent>
                  <d.NumberUnitInput
                    label="Volume size"
                    units={storageUnits}
                    value={size}
                    unit={unit}
                    onValueChange={setSize}
                    onUnitChange={setUnit}
                    disabled={isBusy}
                  />
                </FieldContent>
              </Field>

              <Field className="gap-2">
                <FieldLabel>Type</FieldLabel>
                <FieldContent>
                  <Select value={storageClass} onValueChange={setStorageClass} disabled={isBusy}>
                    <SelectTrigger aria-label="Volume type" className={`h-9 ${SELECT_TRUNCATE_VALUE}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {persistentStorageTypes.map(option => (
                        <SelectItem key={option.className} value={option.className}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>

              <Field className="gap-2">
                <FieldLabel>After it closes</FieldLabel>
                <FieldContent>
                  <Select value={afterClose} onValueChange={setAfterClose} disabled={isBusy}>
                    <SelectTrigger aria-label="After it closes" className={`h-9 ${SELECT_TRUNCATE_VALUE}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AFTER_CLOSE_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>

              {step.kind === "editing" && step.error && <Alert variant="destructive">{step.error}</Alert>}
            </>
          )}

          {(step.kind === "choosing" || step.kind === "leasing") && (
            <>
              <p className="text-sm text-muted-foreground">Choose the provider to lease {name} from. Deployments that mount it run there too.</p>
              {bids.length === 0 ? (
                <>
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner size="small" /> Waiting for providers to bid…
                  </p>
                  {hasWaitedForBids && (
                    <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                      <p>
                        No provider has bid yet. Providers cap how long they keep a volume&apos;s data after it closes and how large a volume they take, so a
                        shorter period after close or a smaller size reaches more of them.
                      </p>
                      <Button variant="outline" size="sm" onClick={changeSettings}>
                        Change settings
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <RadioGroup aria-label="Provider" value={provider} onValueChange={setProvider} className="flex flex-col gap-2">
                  {bids.map(bid => (
                    <BidOption
                      key={bid.provider}
                      id={`${descriptionId}-${bid.provider}`}
                      bid={bid}
                      provider={providers.find(candidate => candidate.owner === bid.provider)}
                      dependencies={d}
                    />
                  ))}
                </RadioGroup>
              )}
              {step.kind === "choosing" && step.error && <Alert variant="destructive">{step.error}</Alert>}
            </>
          )}
        </DialogV2Body>

        <DialogV2Footer className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={closeWithoutAVolume} disabled={isBusy}>
            Cancel
          </Button>
          {step.kind === "editing" || step.kind === "creating" ? (
            <Button type="button" onClick={createTheVolume} disabled={isBusy || !!nameError || !size || size <= 0}>
              {step.kind === "creating" ? "Creating…" : "Create volume"}
            </Button>
          ) : (
            <Button type="button" onClick={leaseTheVolume} disabled={isBusy || !provider}>
              {step.kind === "leasing" ? "Leasing…" : "Lease volume"}
            </Button>
          )}
        </DialogV2Footer>
      </DialogV2Content>
    </DialogV2>
  );
};

const BidOption: FC<{ id: string; bid: VolumeBid; provider?: ApiProviderList; dependencies: typeof DEPENDENCIES }> = ({
  id,
  bid,
  provider,
  dependencies: d
}) => (
  <Label
    htmlFor={id}
    className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-border p-3 font-normal has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-muted/40"
  >
    <RadioGroupItem id={id} value={bid.provider} className="shrink-0" />
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate text-sm font-semibold">{provider ? providerDisplayName(provider) : bid.provider}</span>
      <span className="text-xs text-muted-foreground">{getProviderRegion(provider) ?? "Region unknown"}</span>
    </span>
    <d.PricePerTimeUnit className="text-sm" perBlockValue={udenomToDenom(bid.perBlockAmount, PRICE_DISPLAY_PRECISION)} denom={bid.denom} />
  </Label>
);

function volumeNameErrorOf(name: string, takenNames: string[]): string | undefined {
  if (!VOLUME_NAME_PATTERN.test(name)) return "Use lowercase letters, digits and dashes, starting and ending with a letter or digit.";
  if (takenNames.includes(name)) return `You already have a volume named ${name}.`;
}
