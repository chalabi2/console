import { TIER_DESCRIPTIONS, TIER_LABELS } from "./providerVerification";
import { VERIFICATION_TIERS } from "./providerVerification.types";
import { VerificationTierBadge } from "./VerificationTierBadge";

export function VerificationTierGuide() {
  return (
    <section aria-labelledby="verification-levels-title" className="border-y">
      <div className="border-b px-5 py-3">
        <h2 id="verification-levels-title" className="text-sm font-semibold">
          Verification levels
        </h2>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-5">
        {VERIFICATION_TIERS.map(tier => (
          <div
            key={tier}
            className="border-b p-5 last:border-b-0 sm:border-r xl:border-b-0 xl:last:border-r-0 sm:[&:nth-child(even)]:border-r-0 xl:[&:nth-child(even)]:border-r"
          >
            <div className="mb-3 flex items-center gap-2">
              <VerificationTierBadge tier={tier} compact />
              <span className="text-sm font-semibold">{TIER_LABELS[tier]}</span>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{TIER_DESCRIPTIONS[tier]}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
