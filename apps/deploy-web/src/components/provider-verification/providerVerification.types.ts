export const VERIFICATION_TIERS = ["L0", "L1", "L2", "L3", "L4"] as const;

export type VerificationTier = (typeof VERIFICATION_TIERS)[number];
export type AttestedTier = Exclude<VerificationTier, "L0">;

export const VERIFICATION_CAPABILITIES = ["tee_hardware_attestation", "confidential_computing", "persistent_storage", "bare_metal"] as const;

export type VerificationCapability = (typeof VERIFICATION_CAPABILITIES)[number];
export type AuditorMode = "any" | "all";
export type ProviderRankSort = "best-match" | "price" | "uptime" | "tier";

export interface VerificationRequirement {
  minTier: VerificationTier;
  requiredCapabilities: VerificationCapability[];
  requiredAuditors: string[];
  auditorMode: AuditorMode;
  minAuditorCount: number;
}

export interface AuditorFact {
  address: string;
  name: string;
  status: "pending-bond" | "active" | "frozen" | "lapsed" | "resigned" | "removed";
  bondStatus: "bonded" | "frozen" | "unbonding" | "unbonded";
}

export interface AttestationFact {
  auditor: AuditorFact;
  tier: AttestedTier;
  capabilities: VerificationCapability[];
  status: "unspecified" | "valid" | "expired" | "removed" | "revoked" | "voided";
  createdAt: string;
  expiresAt: string;
  evidenceHash: string;
}

export type SnapshotFact =
  | { kind: "not-posted" }
  | {
      kind: "current" | "stale" | "suspended";
      postedAt: string;
      hash: string;
      resources: SnapshotResources;
    };

export interface SnapshotResources {
  cpu: number;
  gpu: number;
  memoryGi: number;
  storageTi: number;
}

export type ProviderBondFact = { kind: "not-required" } | { kind: "bonded" | "insufficient" | "unbonding"; amount: string; required: string };

export type DiscrepancyFact =
  | { kind: "none" }
  | {
      kind: "under-review" | "grace";
      id: string;
      preservedTier: AttestedTier;
      openedAt: string;
      graceEndsAt: string;
    };

export type MaintenanceFact =
  | { kind: "none" }
  | {
      kind: "window";
      id: string;
      maintenanceType: "planned" | "emergency" | "security" | "network" | "capacity";
      startsAt: string;
      expectedEndsAt: string;
      closedAt?: string;
    };

export interface AuditEscrowFact {
  id: string;
  requestedTier: AttestedTier;
  fee: string;
  providerDeposit: string;
  status: "unspecified" | "open" | "consumed" | "settled" | "cancelled" | "expired";
  auditorName?: string;
}

export type ActiveLeaseFact =
  | { kind: "none" }
  | {
      kind: "active";
      owner: string;
      provider: string;
      dseq: string;
      gseq: number;
      oseq: number;
      bseq: number;
      price: string;
      createdAt: string;
    };

export interface ProviderVerificationMock {
  owner: string;
  name: string;
  hostUri: string;
  region: string;
  uptime?: number;
  monthlyPrice?: number;
  attestations: AttestationFact[];
  snapshot: SnapshotFact;
  bond: ProviderBondFact;
  discrepancy: DiscrepancyFact;
  maintenance: MaintenanceFact;
  auditEscrows: AuditEscrowFact[];
  activeLease: ActiveLeaseFact;
}

export type EligibilityFailure =
  | { code: "tier"; actual: VerificationTier; required: VerificationTier }
  | { code: "snapshot"; state: SnapshotFact["kind"] }
  | { code: "bond"; state: ProviderBondFact["kind"] }
  | { code: "capability"; capability: VerificationCapability }
  | { code: "auditor-count"; actual: number; required: number }
  | { code: "required-auditor"; mode: AuditorMode };

export type VerificationEligibility = { kind: "eligible" } | { kind: "ineligible"; failures: EligibilityFailure[] };

export interface ProviderVerificationSummary {
  bestTier: VerificationTier;
  policyTier: VerificationTier;
  validAttestations: AttestationFact[];
  capabilities: VerificationCapability[];
}

interface ProviderPrescreeningBase {
  provider: ProviderVerificationMock;
  summary: ProviderVerificationSummary;
}

export type ProviderPrescreeningResult =
  | (ProviderPrescreeningBase & {
      kind: "eligible";
      rank: number;
      eligibility: { kind: "eligible" };
    })
  | (ProviderPrescreeningBase & {
      kind: "filtered";
      eligibility: VerificationEligibility;
      regionMatches: boolean;
    });

export type MaintenanceStatus = "scheduled" | "active" | "elapsed" | "closed" | "none";

export interface ProviderVerificationFeed {
  chainId: string;
  moduleActive: boolean;
  observedAt: string;
  providers: ProviderVerificationMock[];
}
