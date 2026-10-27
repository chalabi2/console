"use client";
import type { FC } from "react";
import { useWatch } from "react-hook-form";

import { PricePerTimeUnit } from "@src/components/shared/PricePerTimeUnit";
import type { SdlBuilderFormValuesType, ServiceType } from "@src/types";
import type { LeaseDto } from "@src/types/deployment";
import { PRICE_DISPLAY_PRECISION, udenomToDenom } from "@src/utils/mathHelpers";

export const DEPENDENCIES = { PricePerTimeUnit };

export interface ResizePricePreviewProps {
  lease: LeaseDto;
  loadedServices: ServiceType[];
  serviceIndexes: number[];
  dependencies?: typeof DEPENDENCIES;
}

/** A resize asks for at most each unit's placement price times its count, so new hardware moves that cap only through the instance count. */
export const ResizePricePreview: FC<ResizePricePreviewProps> = ({ lease, loadedServices, serviceIndexes, dependencies: d = DEPENDENCIES }) => {
  const services = useWatch<SdlBuilderFormValuesType, "services">({ name: "services" });
  const placementServices = serviceIndexes.map(index => ({ loaded: loadedServices[index], edited: services[index] }));

  if (!placementServices.some(({ loaded, edited }) => hardwareOf(loaded) !== hardwareOf(edited))) return null;

  const maxPricePerBlock = placementServices.reduce((total, { edited }) => total + edited.pricing.amount * edited.count, 0);

  return (
    <p className="text-sm text-muted-foreground" data-testid="resize-price-preview">
      Your provider prices the new hardware when it accepts it, at no more than{" "}
      <d.PricePerTimeUnit
        denom={placementServices[0].edited.pricing.denom}
        perBlockValue={udenomToDenom(maxPricePerBlock, PRICE_DISPLAY_PRECISION)}
        abbreviated
      />
      , the most this placement pays. It costs{" "}
      <d.PricePerTimeUnit denom={lease.price.denom} perBlockValue={udenomToDenom(lease.price.amount, PRICE_DISPLAY_PRECISION)} abbreviated /> today.
    </p>
  );
};

function hardwareOf({ profile, count }: ServiceType): string {
  return JSON.stringify([profile.cpu, profile.ram, profile.ramUnit, profile.gpu, profile.storage.map(({ size, unit }) => [size, unit]), count]);
}
