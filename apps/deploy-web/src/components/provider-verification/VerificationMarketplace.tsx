import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  CheckboxWithLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@akashnetwork/ui/components";
import { cn } from "@akashnetwork/ui/utils";
import { CheckCircle2, CircleAlert, Eye, FileCode2, SlidersHorizontal } from "lucide-react";

import {
  CAPABILITY_LABELS,
  deriveMaintenanceStatus,
  describeEligibilityFailure,
  prescreenProviders,
  TIER_LABELS,
  verificationRequirementToYaml
} from "./providerVerification";
import type {
  ProviderRankSort,
  ProviderVerificationMock,
  VerificationCapability,
  VerificationRequirement,
  VerificationTier
} from "./providerVerification.types";
import { VERIFICATION_CAPABILITIES, VERIFICATION_TIERS } from "./providerVerification.types";
import { VerificationTierBadge } from "./VerificationTierBadge";

interface Props {
  providers: ProviderVerificationMock[];
  requirement: VerificationRequirement;
  selectedOwner: string;
  now: Date;
  onRequirementChange: (value: VerificationRequirement) => void;
  onInspect: (owner: string) => void;
}

export function VerificationMarketplace({ providers, requirement, selectedOwner, now, onRequirementChange, onInspect }: Props) {
  const [showFiltered, setShowFiltered] = useState(true);
  const [region, setRegion] = useState("all");
  const [sortBy, setSortBy] = useState<ProviderRankSort>("best-match");
  const prescreenedProviders = useMemo(
    () => prescreenProviders({ providers, requirement, now, region, sortBy }),
    [now, providers, region, requirement, sortBy]
  );
  const eligibleCount = prescreenedProviders.filter(item => item.kind === "eligible").length;
  const filteredCount = prescreenedProviders.length - eligibleCount;
  const visibleProviders = showFiltered ? prescreenedProviders : prescreenedProviders.filter(item => item.kind === "eligible");
  const namedAuditorsEnabled = requirement.requiredAuditors.length > 0;
  const availableRegions = useMemo(() => [...new Set(providers.map(provider => provider.region))].sort(), [providers]);
  const availableAuditors = useMemo(
    () => [...new Map(providers.flatMap(provider => provider.attestations).map(attestation => [attestation.auditor.address, attestation.auditor])).values()],
    [providers]
  );

  const updateCapability = (capability: VerificationCapability, checked: boolean) => {
    const requiredCapabilities = checked
      ? [...requirement.requiredCapabilities, capability]
      : requirement.requiredCapabilities.filter(item => item !== capability);
    onRequirementChange({ ...requirement, requiredCapabilities });
  };

  const setNamedAuditorsEnabled = (checked: boolean) => {
    onRequirementChange({
      ...requirement,
      requiredAuditors: checked ? availableAuditors.slice(0, 2).map(auditor => auditor.address) : []
    });
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-lg border bg-card">
        <ol className="grid border-b text-xs sm:grid-cols-3">
          <li className="border-b px-5 py-3 text-muted-foreground sm:border-b-0 sm:border-r">1. Deployment</li>
          <li className="border-b px-5 py-3 text-muted-foreground sm:border-b-0 sm:border-r">2. Configuration</li>
          <li className="px-5 py-3 font-semibold">3. Compute marketplace</li>
        </ol>
        <div className="grid border-b lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="p-5">
            <div className="mb-5 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
              <h2 className="text-base font-semibold">Verification requirements</h2>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <label className="space-y-1 text-sm font-medium">
                <span>Minimum tier</span>
                <Select value={requirement.minTier} onValueChange={value => onRequirementChange({ ...requirement, minTier: parseVerificationTier(value) })}>
                  <SelectTrigger aria-label="Minimum tier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VERIFICATION_TIERS.map(tier => (
                      <SelectItem key={tier} value={tier}>
                        {tier === "L0" ? "Any provider" : `${tier} ${TIER_LABELS[tier]}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              <Input
                label="Minimum auditors"
                type="number"
                min={0}
                max={4}
                value={requirement.minAuditorCount}
                disabled={requirement.minTier === "L0"}
                onChange={event =>
                  onRequirementChange({
                    ...requirement,
                    minAuditorCount: clampAuditorCount(event.currentTarget.valueAsNumber)
                  })
                }
              />

              <label className="space-y-1 text-sm font-medium">
                <span>Named auditor mode</span>
                <Select
                  value={requirement.auditorMode}
                  disabled={!namedAuditorsEnabled || requirement.minTier === "L0"}
                  onValueChange={value => onRequirementChange({ ...requirement, auditorMode: value === "all" ? "all" : "any" })}
                >
                  <SelectTrigger aria-label="Named auditor mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any listed auditor</SelectItem>
                    <SelectItem value="all">All listed auditors</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            </div>

            <div className="mt-5 border-t pt-4">
              <p className="mb-3 text-sm font-medium">Required capabilities</p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {VERIFICATION_CAPABILITIES.map(capability => (
                  <CheckboxWithLabel
                    key={capability}
                    label={CAPABILITY_LABELS[capability]}
                    checked={requirement.requiredCapabilities.includes(capability)}
                    disabled={requirement.minTier === "L0"}
                    onCheckedChange={checked => updateCapability(capability, checked === true)}
                  />
                ))}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t pt-4">
              <CheckboxWithLabel
                label="Restrict to approved auditors"
                checked={namedAuditorsEnabled}
                disabled={requirement.minTier === "L0"}
                onCheckedChange={checked => setNamedAuditorsEnabled(checked === true)}
              />
              {namedAuditorsEnabled && (
                <span className="text-xs text-muted-foreground">
                  {availableAuditors
                    .slice(0, 2)
                    .map(auditor => auditor.name)
                    .join(" and ")}
                </span>
              )}
            </div>
          </div>

          <div className="border-t bg-muted/30 p-5 lg:border-l lg:border-t-0">
            <div className="mb-3 flex items-center gap-2">
              <FileCode2 className="h-4 w-4" aria-hidden="true" />
              <h2 className="text-sm font-semibold">Placement SDL</h2>
            </div>
            <pre className="min-h-[168px] overflow-x-auto rounded-md border bg-background p-4 text-xs leading-5">
              <code>{verificationRequirementToYaml(requirement)}</code>
            </pre>
          </div>
        </div>

        <div className="grid gap-4 border-b px-5 py-4 sm:grid-cols-[180px_180px_minmax(0,1fr)] sm:items-end">
          <label className="space-y-1 text-sm font-medium">
            <span>Region</span>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger aria-label="Provider region">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All regions</SelectItem>
                {availableRegions.map(value => (
                  <SelectItem key={value} value={value}>
                    {value.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="space-y-1 text-sm font-medium">
            <span>Rank by</span>
            <Select value={sortBy} onValueChange={value => setSortBy(parseProviderRankSort(value))}>
              <SelectTrigger aria-label="Provider ranking">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="best-match">Best match</SelectItem>
                <SelectItem value="price">Lowest price</SelectItem>
                <SelectItem value="uptime">Highest uptime</SelectItem>
                <SelectItem value="tier">Highest tier</SelectItem>
              </SelectContent>
            </Select>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
            <p className="text-sm">
              <span className="font-semibold">{eligibleCount}</span> eligible · {filteredCount} filtered
            </p>
            <CheckboxWithLabel label="Show filtered" checked={showFiltered} onCheckedChange={checked => setShowFiltered(checked === true)} />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table className="min-w-[980px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[68px]">Rank</TableHead>
                <TableHead>Provider</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Verification</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead>Snapshot</TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="w-[150px]">Match</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleProviders.map(result => {
                const { provider, summary, eligibility } = result;
                const maintenanceStatus = deriveMaintenanceStatus(provider.maintenance, now);
                const firstFailure = eligibility.kind === "ineligible" ? eligibility.failures[0] : null;
                const regionFailure = result.kind === "filtered" && !result.regionMatches;
                return (
                  <TableRow key={provider.owner} className={cn(selectedOwner === provider.owner && "bg-muted/50")}>
                    <TableCell className="font-mono text-sm font-semibold">{result.kind === "eligible" ? `#${result.rank}` : "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" className="h-auto justify-start p-0 text-left" onClick={() => onInspect(provider.owner)}>
                        <span>
                          <span className="block font-medium">{provider.name}</span>
                          <span className="block max-w-[210px] truncate text-xs font-normal text-muted-foreground">{provider.hostUri}</span>
                        </span>
                      </Button>
                      {maintenanceStatus === "scheduled" || maintenanceStatus === "active" ? (
                        <Badge variant="outline" className="mt-2 rounded-md border-amber-500 text-amber-700 dark:text-amber-300">
                          Maintenance {maintenanceStatus}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="uppercase">{provider.region}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <VerificationTierBadge tier={summary.policyTier} />
                        {provider.discrepancy.kind !== "none" && (
                          <Badge variant="outline" className="rounded-md border-amber-500 text-amber-700 dark:text-amber-300">
                            {provider.discrepancy.kind === "under-review" ? "Under review" : "Grace active"}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {summary.validAttestations.length} valid attestation{summary.validAttestations.length === 1 ? "" : "s"}
                      </p>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-[240px] flex-wrap gap-1">
                        {summary.capabilities.length === 0 ? (
                          <span className="text-xs text-muted-foreground">None attested</span>
                        ) : (
                          summary.capabilities.map(capability => (
                            <Badge key={capability} variant="secondary" className="rounded-md font-normal">
                              {CAPABILITY_LABELS[capability]}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <SnapshotStatus provider={provider} />
                    </TableCell>
                    <TableCell>{provider.uptime === undefined ? "—" : formatPercent(provider.uptime)}</TableCell>
                    <TableCell className="text-right font-medium">
                      {provider.monthlyPrice === undefined ? "—" : `$${provider.monthlyPrice.toFixed(2)}`}
                    </TableCell>
                    <TableCell>
                      {result.kind === "eligible" ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Eligible
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="inline-flex max-w-[180px] items-start gap-1.5 text-left text-xs text-destructive"
                          title={
                            regionFailure
                              ? `Outside ${region}`
                              : eligibility.kind === "ineligible"
                                ? eligibility.failures.map(describeEligibilityFailure).join("; ")
                                : "Filtered"
                          }
                          onClick={() => onInspect(provider.owner)}
                        >
                          <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>{regionFailure ? `Outside ${region}` : firstFailure ? describeEligibilityFailure(firstFailure) : "Filtered"}</span>
                        </button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => onInspect(selectedOwner)}>
          <Eye className="mr-2 h-4 w-4" aria-hidden="true" /> Inspect selected provider
        </Button>
      </div>
    </div>
  );
}

function SnapshotStatus({ provider }: { provider: ProviderVerificationMock }) {
  if (provider.snapshot.kind === "current") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> Current
      </span>
    );
  }
  if (provider.snapshot.kind === "suspended") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
        <CircleAlert className="h-4 w-4" aria-hidden="true" /> Suspended
      </span>
    );
  }
  return <span className="text-sm text-muted-foreground">{provider.snapshot.kind === "stale" ? "Stale" : "Not posted"}</span>;
}

function parseVerificationTier(value: string): VerificationTier {
  return VERIFICATION_TIERS.find(tier => tier === value) ?? "L0";
}

function parseProviderRankSort(value: string): ProviderRankSort {
  if (value === "price" || value === "uptime" || value === "tier") return value;
  return "best-match";
}

function clampAuditorCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(4, Math.round(value))) : 0;
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
