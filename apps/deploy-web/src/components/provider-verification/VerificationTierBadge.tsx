import { Badge } from "@akashnetwork/ui/components";
import { cn } from "@akashnetwork/ui/utils";

import { TIER_LABELS } from "./providerVerification";
import type { VerificationTier } from "./providerVerification.types";

interface Props {
  tier: VerificationTier;
  compact?: boolean;
  className?: string;
}

export function VerificationTierBadge({ tier, compact = false, className }: Props) {
  return (
    <Badge
      variant={tier === "L2" ? "info" : tier === "L3" ? "success" : tier === "L0" || tier === "L1" ? "outline" : "default"}
      className={cn("rounded-md", tier === "L1" && "border-sky-500 text-sky-700 dark:text-sky-300", className)}
    >
      {compact ? tier : `${tier} ${TIER_LABELS[tier]}`}
    </Badge>
  );
}
