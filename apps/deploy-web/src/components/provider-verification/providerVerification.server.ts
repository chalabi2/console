import { z } from "zod";

import type {
  ActiveLeaseFact,
  AttestationFact,
  AttestedTier,
  AuditEscrowFact,
  AuditorFact,
  MaintenanceFact,
  ProviderBondFact,
  ProviderVerificationFeed,
  ProviderVerificationMock,
  SnapshotFact,
  VerificationCapability,
  VerificationTier
} from "./providerVerification.types";

const coinSchema = z.object({ denom: z.string(), amount: z.string() });
const providerSchema = z.object({
  owner: z.string(),
  host_uri: z.string(),
  attributes: z.array(z.object({ key: z.string(), value: z.string() })).default([])
});
const auditorSchema = z.object({
  address: z.string(),
  status: z.string(),
  bond_status: z.string()
});
const attestationSchema = z.object({
  auditor: z.string(),
  tier: z.string(),
  capabilities: z.array(z.string()).default([]),
  evidence_hash: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  status: z.string()
});
const snapshotSchema = z.object({
  snapshot_hash: z.string(),
  resource_summary: z.object({
    total_gpus: z.number(),
    total_vcpus: z.number(),
    total_memory_mb: z.string(),
    total_storage_mb: z.string()
  }),
  posted_at: z.string(),
  compliance_deadline: z.string(),
  suspended: z.boolean()
});
const bondSchema = z.object({
  bonded_amount: coinSchema,
  unbonding_entries: z.array(z.unknown()).default([])
});
const escrowSchema = z.object({
  id: z.string(),
  consumed_by_auditor: z.string(),
  requested_tier: z.string(),
  fee: coinSchema,
  provider_deposit: coinSchema,
  status: z.string()
});
const graceSchema = z.object({
  id: z.string(),
  preserved_tier: z.string(),
  started_at: z.string(),
  expires_at: z.string(),
  status: z.string()
});
const discrepancySchema = z.object({
  id: z.string(),
  provider: z.string(),
  resolution_status: z.string()
});
const maintenanceSchema = z.object({
  record: z.object({
    id: z.string(),
    maintenance_type: z.string(),
    starts_at: z.string(),
    expected_ends_at: z.string(),
    closed_at: z.string().nullish()
  }),
  status: z.string()
});
const leaseSchema = z.object({
  lease: z.object({
    id: z.object({
      owner: z.string(),
      dseq: z.string(),
      gseq: z.number(),
      oseq: z.number(),
      provider: z.string(),
      bseq: z.number()
    }),
    state: z.string(),
    price: coinSchema,
    created_at: z.string()
  })
});

const providersResponseSchema = z.object({ providers: z.array(providerSchema) });
const auditorsResponseSchema = z.object({ auditors: z.array(auditorSchema) });
const attestationsResponseSchema = z.object({ attestations: z.array(attestationSchema) });
const snapshotResponseSchema = z.object({ snapshot: snapshotSchema });
const bondResponseSchema = z.object({ bond: bondSchema, required_for_current_tier: coinSchema });
const escrowsResponseSchema = z.object({ escrows: z.array(escrowSchema) });
const graceResponseSchema = z.object({ grace: graceSchema });
const discrepanciesResponseSchema = z.object({ discrepancies: z.array(discrepancySchema) });
const maintenanceResponseSchema = z.object({ maintenance: z.array(maintenanceSchema) });
const leasesResponseSchema = z.object({ leases: z.array(leaseSchema) });
const paramsResponseSchema = z.object({ params: z.object({ verification_module_active: z.boolean() }) });
const nodeInfoResponseSchema = z.object({ default_node_info: z.object({ network: z.string() }) });

interface ProviderResponses {
  attestations: z.infer<typeof attestationsResponseSchema>;
  snapshot: z.infer<typeof snapshotResponseSchema> | null;
  bond: z.infer<typeof bondResponseSchema> | null;
  escrows: z.infer<typeof escrowsResponseSchema>;
  grace: z.infer<typeof graceResponseSchema> | null;
  maintenance: z.infer<typeof maintenanceResponseSchema>;
  leases: z.infer<typeof leasesResponseSchema>;
}

export async function fetchProviderVerificationFeed(restApiUrl: string, now = new Date()): Promise<ProviderVerificationFeed> {
  const baseUrl = restApiUrl.replace(/\/$/, "");
  const [providers, auditors, discrepancies, params, nodeInfo] = await Promise.all([
    fetchRequired(baseUrl, "/akash/provider/v1beta4/providers?pagination.limit=100", providersResponseSchema),
    fetchRequired(baseUrl, "/akash/verification/v1/auditors?pagination.limit=100", auditorsResponseSchema),
    fetchRequired(baseUrl, "/akash/verification/v1/discrepancies?pagination.limit=100", discrepanciesResponseSchema),
    fetchRequired(baseUrl, "/akash/verification/v1/params", paramsResponseSchema),
    fetchRequired(baseUrl, "/cosmos/base/tendermint/v1beta1/node_info", nodeInfoResponseSchema)
  ]);
  const auditorsByAddress = new Map(auditors.auditors.map(auditor => [auditor.address, mapAuditor(auditor)]));

  const mappedProviders = await Promise.all(
    providers.providers.map(async provider => {
      const encodedOwner = encodeURIComponent(provider.owner);
      const [attestations, snapshot, bond, escrows, grace, maintenance, leases] = await Promise.all([
        fetchRequired(baseUrl, `/akash/verification/v1/providers/${encodedOwner}/attestations?pagination.limit=100`, attestationsResponseSchema),
        fetchOptional(baseUrl, `/akash/verification/v1/providers/${encodedOwner}/snapshot`, snapshotResponseSchema),
        fetchOptional(baseUrl, `/akash/verification/v1/providers/${encodedOwner}/bond`, bondResponseSchema),
        fetchRequired(baseUrl, `/akash/verification/v1/providers/${encodedOwner}/audit-escrows?pagination.limit=100`, escrowsResponseSchema),
        fetchOptional(baseUrl, `/akash/verification/v1/providers/${encodedOwner}/grace`, graceResponseSchema),
        fetchRequired(baseUrl, `/akash/provider/v1beta4/providers/${encodedOwner}/maintenance?pagination.limit=100`, maintenanceResponseSchema),
        fetchRequired(
          baseUrl,
          `/akash/market/v1beta5/leases/list?filters.provider=${encodedOwner}&filters.state=active&pagination.limit=1`,
          leasesResponseSchema
        )
      ]);
      const responses: ProviderResponses = { attestations, snapshot, bond, escrows, grace, maintenance, leases };

      return mapProvider(provider, responses, auditorsByAddress, discrepancies.discrepancies, now);
    })
  );

  return {
    chainId: nodeInfo.default_node_info.network,
    moduleActive: params.params.verification_module_active,
    observedAt: now.toISOString(),
    providers: mappedProviders
  };
}

async function fetchRequired<TSchema extends z.ZodTypeAny>(baseUrl: string, path: string, schema: TSchema): Promise<z.output<TSchema>> {
  const response = await fetch(baseUrl + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`AEP-86 REST request failed: ${path} returned ${response.status}`);
  return schema.parse(await response.json());
}

async function fetchOptional<TSchema extends z.ZodTypeAny>(baseUrl: string, path: string, schema: TSchema): Promise<z.output<TSchema> | null> {
  const response = await fetch(baseUrl + path, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (response.status === 500) {
    const body = await response
      .clone()
      .json()
      .catch(() => null);
    if (z.object({ code: z.number() }).safeParse(body).data?.code === 5) return null;
  }
  if (!response.ok) throw new Error(`AEP-86 REST request failed: ${path} returned ${response.status}`);
  return schema.parse(await response.json());
}

function mapProvider(
  provider: z.infer<typeof providerSchema>,
  responses: ProviderResponses,
  auditors: Map<string, AuditorFact>,
  discrepancies: Array<z.infer<typeof discrepancySchema>>,
  now: Date
): ProviderVerificationMock {
  const attributes = new Map(provider.attributes.map(attribute => [attribute.key, attribute.value]));
  const attestations = responses.attestations.attestations.map(attestation => mapAttestation(attestation, auditors));
  const activeDiscrepancy = discrepancies.find(
    discrepancy => discrepancy.provider === provider.owner && discrepancy.resolution_status === "discrepancy_status_pending"
  );

  return {
    owner: provider.owner,
    name: formatProviderName(attributes.get("organization") ?? provider.owner.slice(0, 16)),
    hostUri: provider.host_uri,
    region: attributes.get("region") ?? "unknown",
    attestations,
    snapshot: mapSnapshot(responses.snapshot, now),
    bond: mapBond(responses.bond, highestTier(attestations)),
    discrepancy:
      responses.grace?.grace.status === "verification_grace_status_active"
        ? {
            kind: activeDiscrepancy ? "under-review" : "grace",
            id: activeDiscrepancy?.id ?? responses.grace.grace.id,
            preservedTier: mapAttestedTier(responses.grace.grace.preserved_tier),
            openedAt: responses.grace.grace.started_at,
            graceEndsAt: responses.grace.grace.expires_at
          }
        : { kind: "none" },
    maintenance: mapMaintenance(responses.maintenance),
    activeLease: mapActiveLease(responses.leases),
    auditEscrows: responses.escrows.escrows
      .slice()
      .sort((left, right) => Number(right.id) - Number(left.id))
      .slice(0, 5)
      .map(escrow => mapEscrow(escrow, auditors))
  };
}

function mapActiveLease(response: ProviderResponses["leases"]): ActiveLeaseFact {
  const active = response.leases.find(item => item.lease.state === "active");
  if (!active) return { kind: "none" };

  return {
    kind: "active",
    owner: active.lease.id.owner,
    provider: active.lease.id.provider,
    dseq: active.lease.id.dseq,
    gseq: active.lease.id.gseq,
    oseq: active.lease.id.oseq,
    bseq: active.lease.id.bseq,
    price: formatLeasePrice(active.lease.price),
    createdAt: active.lease.created_at
  };
}

function mapAuditor(auditor: z.infer<typeof auditorSchema>): AuditorFact {
  return {
    address: auditor.address,
    name: `Auditor ${shortAddress(auditor.address)}`,
    status: mapAuditorStatus(auditor.status),
    bondStatus: mapAuditorBondStatus(auditor.bond_status)
  };
}

function mapAttestation(attestation: z.infer<typeof attestationSchema>, auditors: Map<string, AuditorFact>): AttestationFact {
  return {
    auditor:
      auditors.get(attestation.auditor) ??
      ({ address: attestation.auditor, name: `Auditor ${shortAddress(attestation.auditor)}`, status: "removed", bondStatus: "unbonded" } satisfies AuditorFact),
    tier: mapAttestedTier(attestation.tier),
    capabilities: attestation.capabilities.map(mapCapability).filter((value): value is VerificationCapability => value !== null),
    status: mapAttestationStatus(attestation.status),
    createdAt: attestation.created_at,
    expiresAt: attestation.expires_at,
    evidenceHash: `base64:${attestation.evidence_hash}`
  };
}

function mapSnapshot(response: ProviderResponses["snapshot"], now: Date): SnapshotFact {
  if (!response) return { kind: "not-posted" };
  const snapshot = response.snapshot;
  const kind = snapshot.suspended ? "suspended" : new Date(snapshot.compliance_deadline) <= now ? "stale" : "current";
  return {
    kind,
    postedAt: snapshot.posted_at,
    hash: `base64:${snapshot.snapshot_hash}`,
    resources: {
      cpu: snapshot.resource_summary.total_vcpus,
      gpu: snapshot.resource_summary.total_gpus,
      memoryGi: Math.round(Number(snapshot.resource_summary.total_memory_mb) / 1024),
      storageTi: Number((Number(snapshot.resource_summary.total_storage_mb) / 1024 / 1024).toFixed(2))
    }
  };
}

function mapBond(response: ProviderResponses["bond"], tier: VerificationTier): ProviderBondFact {
  if (!response) {
    return tier === "L0" || tier === "L1" ? { kind: "not-required" } : { kind: "insufficient", amount: "0 AKT", required: "Unknown" };
  }
  const amount = BigInt(response.bond.bonded_amount.amount);
  const required = BigInt(response.required_for_current_tier.amount);
  const values = { amount: formatCoin(response.bond.bonded_amount), required: formatCoin(response.required_for_current_tier) };
  if (response.bond.unbonding_entries.length > 0) return { kind: "unbonding", ...values };
  return amount >= required ? { kind: "bonded", ...values } : { kind: "insufficient", ...values };
}

function mapMaintenance(response: ProviderResponses["maintenance"]): MaintenanceFact {
  const maintenance = response.maintenance.find(item => item.status !== "provider_maintenance_status_closed") ?? response.maintenance[0];
  if (!maintenance) return { kind: "none" };
  return {
    kind: "window",
    id: maintenance.record.id,
    maintenanceType: mapMaintenanceType(maintenance.record.maintenance_type),
    startsAt: maintenance.record.starts_at,
    expectedEndsAt: maintenance.record.expected_ends_at,
    ...(maintenance.record.closed_at ? { closedAt: maintenance.record.closed_at } : {})
  };
}

function mapEscrow(escrow: z.infer<typeof escrowSchema>, auditors: Map<string, AuditorFact>): AuditEscrowFact {
  return {
    id: escrow.id,
    requestedTier: mapAttestedTier(escrow.requested_tier),
    fee: formatCoin(escrow.fee),
    providerDeposit: formatCoin(escrow.provider_deposit),
    status: mapEscrowStatus(escrow.status),
    ...(escrow.consumed_by_auditor
      ? { auditorName: auditors.get(escrow.consumed_by_auditor)?.name ?? `Auditor ${shortAddress(escrow.consumed_by_auditor)}` }
      : {})
  };
}

function mapAttestedTier(value: string): AttestedTier {
  switch (value) {
    case "verification_tier_verified":
      return "L2";
    case "verification_tier_established":
      return "L3";
    case "verification_tier_trusted":
      return "L4";
    case "verification_tier_identified":
      return "L1";
    default:
      throw new Error(`Unsupported attested tier: ${value}`);
  }
}

function mapCapability(value: string): VerificationCapability | null {
  switch (value) {
    case "capability_tee_hardware_attestation":
      return "tee_hardware_attestation";
    case "capability_confidential_computing":
      return "confidential_computing";
    case "capability_persistent_storage":
      return "persistent_storage";
    case "capability_bare_metal":
      return "bare_metal";
    default:
      return null;
  }
}

function mapAuditorStatus(value: string): AuditorFact["status"] {
  switch (value) {
    case "auditor_status_active":
      return "active";
    case "auditor_status_frozen":
      return "frozen";
    case "auditor_status_lapsed":
      return "lapsed";
    case "auditor_status_resigned":
      return "resigned";
    case "auditor_status_removed":
      return "removed";
    default:
      return "pending-bond";
  }
}

function mapAuditorBondStatus(value: string): AuditorFact["bondStatus"] {
  switch (value) {
    case "bond_status_bonded":
      return "bonded";
    case "bond_status_frozen":
      return "frozen";
    case "bond_status_unbonding":
      return "unbonding";
    default:
      return "unbonded";
  }
}

function mapAttestationStatus(value: string): AttestationFact["status"] {
  switch (value) {
    case "attestation_status_valid":
      return "valid";
    case "attestation_status_expired":
      return "expired";
    case "attestation_status_revoked":
      return "revoked";
    case "attestation_status_removed":
      return "removed";
    case "attestation_status_voided":
      return "voided";
    default:
      return "unspecified";
  }
}

function mapEscrowStatus(value: string): AuditEscrowFact["status"] {
  switch (value) {
    case "audit_escrow_status_open":
      return "open";
    case "audit_escrow_status_consumed":
      return "consumed";
    case "audit_escrow_status_settled":
      return "settled";
    case "audit_escrow_status_cancelled":
      return "cancelled";
    case "audit_escrow_status_expired":
      return "expired";
    default:
      return "unspecified";
  }
}

function mapMaintenanceType(value: string): Exclude<MaintenanceFact, { kind: "none" }>["maintenanceType"] {
  switch (value) {
    case "provider_maintenance_type_emergency":
      return "emergency";
    case "provider_maintenance_type_security":
      return "security";
    case "provider_maintenance_type_network":
      return "network";
    case "provider_maintenance_type_capacity":
      return "capacity";
    default:
      return "planned";
  }
}

function highestTier(attestations: AttestationFact[]): VerificationTier {
  const ranks: Record<VerificationTier, number> = { L0: 0, L1: 1, L2: 2, L3: 3, L4: 4 };
  return attestations
    .filter(attestation => attestation.status === "valid")
    .reduce<VerificationTier>((tier, attestation) => (ranks[attestation.tier] > ranks[tier] ? attestation.tier : tier), "L0");
}

function formatCoin(coin: z.infer<typeof coinSchema>): string {
  if (coin.denom !== "uakt") return `${coin.amount} ${coin.denom}`;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(Number(coin.amount) / 1_000_000)} AKT`;
}

function formatLeasePrice(coin: z.infer<typeof coinSchema>): string {
  if (coin.denom !== "uact") return `${coin.amount} ${coin.denom}/block`;
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 18 }).format(Number(coin.amount))} uACT/block`;
}

function formatProviderName(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => (part.toLowerCase() === "aep86" ? "AEP-86" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

function shortAddress(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-5)}`;
}
