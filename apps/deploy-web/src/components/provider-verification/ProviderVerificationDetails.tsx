import { Alert, AlertDescription, AlertTitle, Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@akashnetwork/ui/components";
import { AlertTriangle, CalendarClock, CheckCircle2, Database, ShieldCheck, WalletCards } from "lucide-react";

import { CAPABILITY_LABELS, deriveMaintenanceStatus, deriveProviderVerification } from "./providerVerification";
import type { AuditEscrowFact, ProviderVerificationMock } from "./providerVerification.types";
import { VerificationTierBadge } from "./VerificationTierBadge";

interface Props {
  provider: ProviderVerificationMock;
  now: Date;
}

export function ProviderVerificationDetails({ provider, now }: Props) {
  const summary = deriveProviderVerification(provider, now);
  const maintenanceStatus = deriveMaintenanceStatus(provider.maintenance, now);

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <header className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{provider.name}</h2>
            <VerificationTierBadge tier={summary.policyTier} />
          </div>
          <p className="text-sm text-muted-foreground">{provider.hostUri}</p>
          <p className="mt-1 max-w-[520px] truncate font-mono text-xs text-muted-foreground">{provider.owner}</p>
        </div>
        <Badge variant="outline" className="w-fit rounded-md uppercase">
          {provider.region}
        </Badge>
      </header>

      {provider.discrepancy.kind !== "none" && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>
            {provider.discrepancy.kind === "under-review"
              ? `Discrepancy #${provider.discrepancy.id} is under governance review`
              : `Verification grace #${provider.discrepancy.id} is active`}
          </AlertTitle>
          <AlertDescription>
            {provider.discrepancy.kind === "under-review"
              ? `${provider.discrepancy.preservedTier} is preserved while governance reviews the conflicting attestations.`
              : `A prior discrepancy is resolved. Marketplace tier checks continue to use ${provider.discrepancy.preservedTier} through ${formatUtc(provider.discrepancy.graceEndsAt)}, avoiding an immediate eligibility drop.`}{" "}
            Snapshot, bond, capability, and auditor requirements still apply. After grace expires, matching uses current valid attestations.
          </AlertDescription>
        </Alert>
      )}

      {provider.maintenance.kind === "window" && (maintenanceStatus === "scheduled" || maintenanceStatus === "active") && (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>
            {provider.maintenance.maintenanceType} maintenance {maintenanceStatus}
          </AlertTitle>
          <AlertDescription>
            {formatUtc(provider.maintenance.startsAt)} to {formatUtc(provider.maintenance.expectedEndsAt)} UTC
          </AlertDescription>
        </Alert>
      )}

      <section className="grid border-b sm:grid-cols-2 xl:grid-cols-4">
        <SummaryItem icon={ShieldCheck} label="Effective tier" value={`${summary.policyTier} · ${summary.validAttestations.length} auditors`} />
        <SummaryItem
          icon={Database}
          label="Snapshot"
          value={provider.snapshot.kind === "current" ? `Current · ${relativeTime(provider.snapshot.postedAt, now)}` : sentenceCase(provider.snapshot.kind)}
        />
        <SummaryItem
          icon={WalletCards}
          label="Provider bond"
          value={provider.bond.kind === "bonded" ? `${provider.bond.amount} · required ${provider.bond.required}` : sentenceCase(provider.bond.kind)}
        />
        <SummaryItem
          icon={CheckCircle2}
          label="Capabilities"
          value={summary.capabilities.length > 0 ? `${summary.capabilities.length} attested` : "None attested"}
        />
      </section>

      <section className="border-b p-5">
        <h3 className="mb-3 text-sm font-semibold">Attested capabilities</h3>
        <div className="flex flex-wrap gap-2">
          {summary.capabilities.length === 0 ? (
            <span className="text-sm text-muted-foreground">No capabilities are present in valid attestations.</span>
          ) : (
            summary.capabilities.map(capability => (
              <Badge key={capability} variant="secondary" className="rounded-md font-normal">
                {CAPABILITY_LABELS[capability]}
              </Badge>
            ))
          )}
        </div>
      </section>

      {provider.snapshot.kind !== "not-posted" && (
        <section className="border-b p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Latest inventory snapshot</h3>
              <p className="mt-1 text-xs text-muted-foreground">Posted {formatUtc(provider.snapshot.postedAt)} UTC</p>
            </div>
            <Badge variant={provider.snapshot.kind === "current" ? "success" : "destructive"} className="rounded-md">
              {sentenceCase(provider.snapshot.kind)}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="vCPU" value={provider.snapshot.resources.cpu.toString()} />
            <Metric label="GPU" value={provider.snapshot.resources.gpu.toString()} />
            <Metric label="Memory" value={`${provider.snapshot.resources.memoryGi} GiB`} />
            <Metric label="Storage" value={`${provider.snapshot.resources.storageTi} TiB`} />
          </div>
          <p className="mt-4 truncate font-mono text-xs text-muted-foreground">{provider.snapshot.hash}</p>
        </section>
      )}

      <section className="border-b">
        <div className="p-5 pb-3">
          <h3 className="text-sm font-semibold">Attestations</h3>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Auditor</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {provider.attestations.map(attestation => (
                <TableRow key={`${attestation.auditor.address}-${attestation.createdAt}`}>
                  <TableCell>
                    <p className="font-medium">{attestation.auditor.name}</p>
                    <p className="max-w-[220px] truncate font-mono text-xs text-muted-foreground">{attestation.auditor.address}</p>
                  </TableCell>
                  <TableCell>
                    <VerificationTierBadge tier={attestation.tier} compact />
                  </TableCell>
                  <TableCell>
                    <Badge variant={attestation.status === "valid" ? "success" : "outline"} className="rounded-md capitalize">
                      {attestation.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(attestation.expiresAt)}</TableCell>
                  <TableCell className="max-w-[180px] truncate font-mono text-xs">{attestation.evidenceHash}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section>
        <div className="p-5 pb-3">
          <h3 className="text-sm font-semibold">Audit escrow lifecycle</h3>
        </div>
        <div className="overflow-x-auto">
          <Table className="min-w-[680px]">
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Requested tier</TableHead>
                <TableHead>Auditor</TableHead>
                <TableHead>Audit fee</TableHead>
                <TableHead>Provider deposit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {provider.auditEscrows.map(escrow => (
                <AuditEscrowRow key={escrow.id} escrow={escrow} />
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function SummaryItem({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <div className="min-w-0 border-b p-5 last:border-b-0 xl:border-b-0 xl:border-r xl:last:border-r-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
        <Icon className="h-4 w-4" aria-hidden="true" /> {label}
      </div>
      <p className="truncate text-sm font-semibold" title={value}>
        {value}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function AuditEscrowRow({ escrow }: { escrow: AuditEscrowFact }) {
  return (
    <TableRow>
      <TableCell className="font-mono">#{escrow.id}</TableCell>
      <TableCell>
        <VerificationTierBadge tier={escrow.requestedTier} compact />
      </TableCell>
      <TableCell>{escrow.auditorName ?? "Awaiting auditor"}</TableCell>
      <TableCell>{escrow.fee}</TableCell>
      <TableCell>{escrow.providerDeposit}</TableCell>
      <TableCell>
        <Badge variant={escrow.status === "settled" ? "success" : escrow.status === "expired" ? "destructive" : "outline"} className="rounded-md capitalize">
          {escrow.status}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

function formatUtc(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(value));
}

function relativeTime(value: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} hr ago`;
}

function sentenceCase(value: string): string {
  const text = value.replaceAll("-", " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
