import { useState } from "react";
import { Alert, AlertDescription, AlertTitle, Badge, CheckboxWithLabel } from "@akashnetwork/ui/components";
import { AlertTriangle, BellRing, CalendarClock, CheckCircle2, Server, ShieldCheck } from "lucide-react";

import { deriveMaintenanceStatus, deriveProviderVerification, evaluateVerificationRequirement, TIER_LABELS } from "./providerVerification";
import type { ActiveLeaseFact, ProviderVerificationMock, VerificationRequirement } from "./providerVerification.types";
import { VerificationTierBadge } from "./VerificationTierBadge";

interface Props {
  provider: ProviderVerificationMock;
  lease: Extract<ActiveLeaseFact, { kind: "active" }>;
  requirement: VerificationRequirement;
  now: Date;
}

export function LeaseVerificationView({ provider, lease, requirement, now }: Props) {
  const [maintenanceAlerts, setMaintenanceAlerts] = useState(true);
  const [verificationAlerts, setVerificationAlerts] = useState(true);
  const summary = deriveProviderVerification(provider, now);
  const eligibility = evaluateVerificationRequirement(provider, requirement, now);
  const maintenanceStatus = deriveMaintenanceStatus(provider.maintenance, now);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">Deployment #{lease.dseq}</h2>
            <Badge variant="success" className="rounded-md">
              Active
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Lease {lease.dseq}/{lease.gseq}/{lease.oseq}/{lease.bseq} · {lease.price}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-medium">{provider.name}</span>
        </div>
      </header>

      {provider.maintenance.kind === "window" && (maintenanceStatus === "scheduled" || maintenanceStatus === "active") && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>
            Provider {provider.maintenance.maintenanceType} maintenance {maintenanceStatus}
          </AlertTitle>
          <AlertDescription>
            This provider-wide window runs from {formatUtc(provider.maintenance.startsAt)} to {formatUtc(provider.maintenance.expectedEndsAt)} UTC.
          </AlertDescription>
        </Alert>
      )}

      {provider.discrepancy.kind !== "none" && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>
            {provider.discrepancy.kind === "under-review" ? "Provider verification is under review" : "Provider verification grace is active"}
          </AlertTitle>
          <AlertDescription>
            {provider.discrepancy.kind === "under-review"
              ? `Governance discrepancy #${provider.discrepancy.id} is open. ${provider.discrepancy.preservedTier} remains available for tier checks while it is reviewed. `
              : `A prior discrepancy is resolved. ${provider.discrepancy.preservedTier} remains available for tier checks through ${formatUtc(provider.discrepancy.graceEndsAt)}. `}
            Existing workloads continue. New bids must still satisfy snapshot, bond, capability, and auditor requirements.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid border-b md:grid-cols-2">
        <div className="border-b p-5 md:border-b-0 md:border-r">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Lease verification</h3>
          </div>
          <dl className="space-y-3 text-sm">
            <Definition label="Provider tier">
              <VerificationTierBadge tier={summary.policyTier} />
            </Definition>
            <Definition label="Deployment minimum">
              {requirement.minTier === "L0" ? "None" : `${requirement.minTier} ${TIER_LABELS[requirement.minTier]}`}
            </Definition>
            <Definition label="Snapshot">{provider.snapshot.kind === "current" ? "Current" : provider.snapshot.kind}</Definition>
            <Definition label="Policy result">
              {eligibility.kind === "eligible" ? (
                <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Meets requirement
                </span>
              ) : (
                <span className="text-destructive">Does not meet current requirement</span>
              )}
            </Definition>
          </dl>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <BellRing className="h-4 w-4" aria-hidden="true" />
            <h3 className="text-sm font-semibold">Notifications</h3>
          </div>
          <div className="space-y-4">
            <CheckboxWithLabel label="Provider maintenance" checked={maintenanceAlerts} onCheckedChange={checked => setMaintenanceAlerts(checked === true)} />
            <CheckboxWithLabel
              label="Verification status changes"
              checked={verificationAlerts}
              onCheckedChange={checked => setVerificationAlerts(checked === true)}
            />
          </div>
        </div>
      </section>

      <section className="p-5">
        <h3 className="mb-4 text-sm font-semibold">Recent verification activity</h3>
        <ol className="space-y-4">
          {provider.snapshot.kind !== "not-posted" && (
            <Activity
              title="Provider inventory snapshot posted"
              detail="The current inventory snapshot hash is recorded on chain."
              time={relativeTime(provider.snapshot.postedAt, now)}
            />
          )}
          <Activity
            title={`${summary.policyTier} verification remains valid`}
            detail={`${summary.validAttestations.length} qualified auditor records are active.`}
            time="Valid now"
          />
          {provider.maintenance.kind === "window" && (
            <Activity
              title="Provider maintenance notice opened"
              detail={`${provider.maintenance.maintenanceType} maintenance window #${provider.maintenance.id}`}
              time="4 hours ago"
            />
          )}
        </ol>
      </section>
    </div>
  );
}

function Definition({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

function Activity({ title, detail, time }: { title: string; detail: string; time: string }) {
  return (
    <li className="grid grid-cols-[12px_minmax(0,1fr)] gap-3">
      <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-green-600" aria-hidden="true" />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">{detail}</p>
        </div>
        <time className="shrink-0 text-xs text-muted-foreground">{time}</time>
      </div>
    </li>
  );
}

function formatUtc(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

function relativeTime(value: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}
