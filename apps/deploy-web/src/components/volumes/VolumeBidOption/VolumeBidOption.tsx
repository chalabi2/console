"use client";
import type { FC } from "react";
import { Label, RadioGroupItem } from "@akashnetwork/ui/components";

import { getProviderRegion } from "@src/components/deployments/DeploymentDetail/DeploymentPlacements/placementModel";
import type { PricePerTimeUnit } from "@src/components/shared/PricePerTimeUnit";
import type { ApiProviderList } from "@src/types/provider";
import { PRICE_DISPLAY_PRECISION, udenomToDenom } from "@src/utils/mathHelpers";
import { providerDisplayName } from "@src/utils/providerUtils";

export type VolumeBidPrice = { provider: string; perBlockAmount: string; denom: string };

type Props = {
  id: string;
  bid: VolumeBidPrice;
  provider?: ApiProviderList;
  dependencies: { PricePerTimeUnit: typeof PricePerTimeUnit };
};

/** One provider's offer for a volume, chosen as an item of the provider radio group. */
export const VolumeBidOption: FC<Props> = ({ id, bid, provider, dependencies: d }) => (
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
