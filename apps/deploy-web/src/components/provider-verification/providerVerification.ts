import yaml from "js-yaml";

import type {
  AttestationFact,
  AttestedTier,
  EligibilityFailure,
  MaintenanceFact,
  MaintenanceStatus,
  ProviderPrescreeningResult,
  ProviderRankSort,
  ProviderVerificationMock,
  ProviderVerificationSummary,
  VerificationCapability,
  VerificationEligibility,
  VerificationRequirement,
  VerificationTier
} from "./providerVerification.types";

const TIER_RANK: Record<VerificationTier, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
  L4: 4
};

export const TIER_LABELS: Record<VerificationTier, string> = {
  L0: "Permissionless",
  L1: "Identified",
  L2: "Verified",
  L3: "Established",
  L4: "Trusted"
};

export const TIER_DESCRIPTIONS: Record<VerificationTier, string> = {
  L0: "Registered and reachable; operator claims are not independently verified.",
  L1: "Provider software identity and operator identity are verified.",
  L2: "Resources, network, location, and inventory are independently checked.",
  L3: "Sustained availability, performance, and lease completion history are verified.",
  L4: "A physical audit, SLA, and the strongest ongoing compliance requirements apply."
};

export const CAPABILITY_LABELS: Record<VerificationCapability, string> = {
  tee_hardware_attestation: "TEE hardware attestation",
  confidential_computing: "Confidential computing",
  persistent_storage: "Persistent storage",
  bare_metal: "Bare metal"
};

export function deriveProviderVerification(provider: ProviderVerificationMock, now: Date): ProviderVerificationSummary {
  const validAttestations = provider.attestations.filter(attestation => isQualifiedAttestation(attestation, now));
  const bestTier = validAttestations.reduce<VerificationTier>(
    (best, attestation) => (TIER_RANK[attestation.tier] > TIER_RANK[best] ? attestation.tier : best),
    "L0"
  );
  const policyTier = provider.discrepancy.kind !== "none" && new Date(provider.discrepancy.graceEndsAt) > now ? provider.discrepancy.preservedTier : bestTier;
  const capabilities = [...new Set(validAttestations.flatMap(attestation => attestation.capabilities))].sort();

  return { bestTier, policyTier, validAttestations, capabilities };
}

export function evaluateVerificationRequirement(provider: ProviderVerificationMock, requirement: VerificationRequirement, now: Date): VerificationEligibility {
  if (requirement.minTier === "L0") return { kind: "eligible" };

  const summary = deriveProviderVerification(provider, now);
  const failures: EligibilityFailure[] = [];
  const requiresSnapshotAndBond = TIER_RANK[requirement.minTier] >= TIER_RANK.L2;

  if (requiresSnapshotAndBond && provider.snapshot.kind !== "current") {
    failures.push({ code: "snapshot", state: provider.snapshot.kind });
  }

  if (requiresSnapshotAndBond && provider.bond.kind !== "bonded") {
    failures.push({ code: "bond", state: provider.bond.kind });
  }

  if (TIER_RANK[summary.policyTier] < TIER_RANK[requirement.minTier]) {
    failures.push({ code: "tier", actual: summary.policyTier, required: requirement.minTier });
  }

  for (const capability of requirement.requiredCapabilities) {
    if (!summary.capabilities.includes(capability)) failures.push({ code: "capability", capability });
  }

  const qualifiedAuditors = new Set(
    summary.validAttestations
      .filter(attestation => TIER_RANK[attestation.tier] >= TIER_RANK[requirement.minTier])
      .map(attestation => attestation.auditor.address)
  );
  if (qualifiedAuditors.size < requirement.minAuditorCount) {
    failures.push({ code: "auditor-count", actual: qualifiedAuditors.size, required: requirement.minAuditorCount });
  }

  if (requirement.requiredAuditors.length > 0) {
    const matches = requirement.requiredAuditors.filter(address => qualifiedAuditors.has(address)).length;
    const satisfiesNamedAuditors = requirement.auditorMode === "all" ? matches === requirement.requiredAuditors.length : matches > 0;
    if (!satisfiesNamedAuditors) failures.push({ code: "required-auditor", mode: requirement.auditorMode });
  }

  return failures.length === 0 ? { kind: "eligible" } : { kind: "ineligible", failures };
}

interface PrescreenProvidersInput {
  providers: ProviderVerificationMock[];
  requirement: VerificationRequirement;
  now: Date;
  region: string;
  sortBy: ProviderRankSort;
}

export function prescreenProviders({ providers, requirement, now, region, sortBy }: PrescreenProvidersInput): ProviderPrescreeningResult[] {
  const evaluated = providers.map(provider => ({
    provider,
    summary: deriveProviderVerification(provider, now),
    eligibility: evaluateVerificationRequirement(provider, requirement, now),
    regionMatches: region === "all" || provider.region === region
  }));
  const compare = providerComparator(sortBy);
  const eligible = evaluated
    .filter(result => result.eligibility.kind === "eligible" && result.regionMatches)
    .sort(compare)
    .map(
      (result, index) =>
        ({
          kind: "eligible",
          rank: index + 1,
          provider: result.provider,
          summary: result.summary,
          eligibility: { kind: "eligible" }
        }) satisfies ProviderPrescreeningResult
    );
  const filtered = evaluated
    .filter(result => result.eligibility.kind === "ineligible" || !result.regionMatches)
    .sort(compare)
    .map(
      result =>
        ({
          kind: "filtered",
          provider: result.provider,
          summary: result.summary,
          eligibility: result.eligibility,
          regionMatches: result.regionMatches
        }) satisfies ProviderPrescreeningResult
    );

  return [...eligible, ...filtered];
}

export function deriveMaintenanceStatus(maintenance: MaintenanceFact, now: Date): MaintenanceStatus {
  if (maintenance.kind === "none") return "none";
  if (maintenance.closedAt) return "closed";
  if (now < new Date(maintenance.startsAt)) return "scheduled";
  if (now < new Date(maintenance.expectedEndsAt)) return "active";
  return "elapsed";
}

export function verificationRequirementToYaml(requirement: VerificationRequirement): string {
  if (requirement.minTier === "L0") return "# No verification requirement";

  const verification: Record<string, unknown> = {
    min_tier: TIER_RANK[requirement.minTier]
  };
  if (requirement.minAuditorCount > 0) verification.min_auditor_count = requirement.minAuditorCount;
  if (requirement.requiredAuditors.length > 0) verification.auditor_mode = requirement.auditorMode;
  if (requirement.requiredCapabilities.length > 0) verification.capabilities = requirement.requiredCapabilities;
  if (requirement.requiredAuditors.length > 0) verification.auditors = requirement.requiredAuditors;

  return yaml.dump({ verification }, { lineWidth: -1, noRefs: true }).trim();
}

export function describeEligibilityFailure(failure: EligibilityFailure): string {
  switch (failure.code) {
    case "tier":
      return `Requires ${failure.required}; provider is ${failure.actual}`;
    case "snapshot":
      return failure.state === "not-posted" ? "No snapshot posted" : `Snapshot ${failure.state}`;
    case "bond":
      return failure.state === "not-required" ? "Provider bond not posted" : `Provider bond ${failure.state}`;
    case "capability":
      return `Missing ${CAPABILITY_LABELS[failure.capability]}`;
    case "auditor-count":
      return `Requires ${failure.required} qualified auditor${failure.required === 1 ? "" : "s"}; found ${failure.actual}`;
    case "required-auditor":
      return `Does not satisfy ${failure.mode} named-auditor policy`;
    default: {
      const exhaustive: never = failure;
      return exhaustive;
    }
  }
}

export function tierAtLeast(actual: VerificationTier, required: VerificationTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

function providerComparator(sortBy: ProviderRankSort) {
  return (
    left: { provider: ProviderVerificationMock; summary: ProviderVerificationSummary },
    right: { provider: ProviderVerificationMock; summary: ProviderVerificationSummary }
  ): number => {
    const bestMatch = compareBestMatch(left, right);
    switch (sortBy) {
      case "price":
        return compareAscending(left.provider.monthlyPrice, right.provider.monthlyPrice) || bestMatch;
      case "uptime":
        return compareDescending(left.provider.uptime, right.provider.uptime) || bestMatch;
      case "tier":
        return TIER_RANK[right.summary.policyTier] - TIER_RANK[left.summary.policyTier] || bestMatch;
      case "best-match":
        return bestMatch;
      default: {
        const exhaustive: never = sortBy;
        return exhaustive;
      }
    }
  };
}

function compareBestMatch(
  left: { provider: ProviderVerificationMock; summary: ProviderVerificationSummary },
  right: { provider: ProviderVerificationMock; summary: ProviderVerificationSummary }
): number {
  return (
    TIER_RANK[right.summary.policyTier] - TIER_RANK[left.summary.policyTier] ||
    right.summary.validAttestations.length - left.summary.validAttestations.length ||
    compareDescending(left.provider.uptime, right.provider.uptime) ||
    compareAscending(left.provider.monthlyPrice, right.provider.monthlyPrice) ||
    left.provider.name.localeCompare(right.provider.name)
  );
}

function compareAscending(left: number | undefined, right: number | undefined): number {
  return (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);
}

function compareDescending(left: number | undefined, right: number | undefined): number {
  return (right ?? Number.NEGATIVE_INFINITY) - (left ?? Number.NEGATIVE_INFINITY);
}

function isQualifiedAttestation(attestation: AttestationFact, now: Date): boolean {
  return (
    attestation.status === "valid" &&
    attestation.auditor.status === "active" &&
    attestation.auditor.bondStatus === "bonded" &&
    new Date(attestation.expiresAt) > now
  );
}

export function attestedTier(value: VerificationTier): AttestedTier | null {
  return value === "L0" ? null : value;
}
