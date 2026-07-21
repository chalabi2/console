# AEP-86 Console integration

This guide is the implementation path for adding provider verification to Akash Console. It complements the full
[AEP-86 specification](https://github.com/akash-network/AEP/tree/main/spec/aep-86) and focuses on the data Console must consume, the states it must derive, and the existing screens that change.

## Product surfaces

| Console surface          | Verification behavior                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider list            | Show effective tier, valid auditor count, capabilities, snapshot freshness, maintenance state, and discrepancy review state. Default browsing may require L2 or better.     |
| Deployment configuration | Add `min_tier`, capabilities, minimum auditor count, and optional named-auditor policy to the placement. New templates should recommend L3.                                 |
| Marketplace              | Hard-filter providers against placement requirements, explain exclusions, and rank only eligible providers using explicit user-selected criteria.                           |
| Provider detail          | Show the raw attestations, latest snapshot, provider bond, audit escrow lifecycle, maintenance windows, and open discrepancy state.                                         |
| Active lease             | Show the order's placement policy beside the provider's current verification facts and provider-wide maintenance notices. Tenant notification preferences remain off-chain. |

The prototype is available at `/provider-verification` and has two review modes:

- **Live testnet** reads the AEP-86 testnet through a same-origin Next API route and shows current provider,
  attestation, snapshot, bond, escrow, grace, discrepancy, maintenance, active-lease, and market-order records.
- **Product scenarios** uses typed fixtures for states that may not exist on the testnet when a review happens, such as
  an ineligible provider, a pending discrepancy, and active-lease maintenance.

The live route is a review bridge, not the production indexing design. It performs bounded REST queries on demand for
the small testnet and is configured with the server-only `AEP86_REST_API_URL` variable. Production provider lists must
use the normalized indexer view below rather than repeating those requests per browser session.

## Source of truth

`x/verification` stores raw records. It does not store a single Console trust score. Console or its indexer derives a
view from those facts and the current module parameters.

The chain query surface used by Console is:

| Module                         | Query                                          | Console use                                                                    |
| ------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `akash.verification.v1.Query`  | `Params`                                       | Activation flag, snapshot age, tier TTLs, and other current policy parameters. |
|                                | `ProviderAttestations`                         | Raw attestation history for one provider.                                      |
|                                | `ProviderSnapshot`                             | Latest on-chain snapshot hash, post time, and suspension state.                |
|                                | `ProviderBond`                                 | Current provider bond and required amount for its current tier.                |
|                                | `ProviderVerificationGrace`                    | Tier preserved during discrepancy review, when present.                        |
|                                | `ProviderAuditEscrows`                         | Audit request and settlement history.                                          |
|                                | `Discrepancy` / `Discrepancies`                | Governance review state. Index provider relationships from discrepancy events. |
| `akash.provider.v1beta4.Query` | `ProviderMaintenance` / `ProviderMaintenances` | Current and historical provider-wide maintenance windows.                      |
| `akash.market.v1beta5.Query`   | `ProviderLeaseStats`                           | Higher-tier lease history context when it is shown.                            |
|                                | `Leases`                                       | Active leases for provider and deployment operational views.                   |
|                                | `Order`                                        | Original region and verification requirements for an active lease.             |

## Verification levels

| Level | Name           | User-facing meaning                                                             |
| ----- | -------------- | ------------------------------------------------------------------------------- |
| L0    | Permissionless | Registered and reachable; operator claims are not independently verified.       |
| L1    | Identified     | Provider software identity and operator identity are verified.                  |
| L2    | Verified       | Resources, network, location, and inventory are independently checked.          |
| L3    | Established    | Sustained availability, performance, and lease completion history are verified. |
| L4    | Trusted        | A physical audit, SLA, and the strongest ongoing compliance requirements apply. |

These labels summarize policy; they are not a Console-generated trust score. The chain stores the underlying
attestations, bonds, snapshots, and discrepancy records from which the current policy tier is derived.

Use the generated chain SDK types at the boundary. Do not duplicate protobuf enums as arbitrary strings in production
API code. The prototype uses small string unions only because it is a review fixture with no network boundary.

## Indexed provider view

Do not issue six chain queries per provider from the browser. Ingest the records into the Console backend or indexer and
attach one normalized `verification` object to the existing provider list, provider detail, and bid-screening responses.
At minimum that view needs:

```ts
interface ProviderVerificationView {
  provider: string;
  bestTier: 0 | 1 | 2 | 3 | 4;
  policyTier: 0 | 1 | 2 | 3 | 4;
  validAttestationCount: number;
  capabilities: CapabilityFlag[];
  snapshot: {
    state: "not_posted" | "current" | "stale" | "suspended";
    postedAt?: string;
    hash?: string;
  };
  bond: {
    status: BondStatus;
    amount: Coin;
    required: Coin;
  };
  discrepancy?: {
    id: string;
    status: DiscrepancyStatus;
    preservedTier?: number;
    graceEndsAt?: string;
  };
  maintenance?: {
    id: string;
    type: ProviderMaintenanceType;
    status: "scheduled" | "active" | "elapsed" | "closed";
    startsAt: string;
    expectedEndsAt: string;
  };
}
```

The exact TypeScript names should be derived from the generated API schema when the backend contract lands.

## Deriving verification state

1. Start with attestations whose status is `Valid` and whose `expires_at` is later than the current block time.
2. Ignore attestations from auditors that are no longer active or bonded.
3. Pick the highest numeric tier from the remaining records. Proto value `0` is L0 / no attestation.
4. Union capabilities from valid attestations.
5. If an active discrepancy grace record exists, use its preserved tier for tier policy and label the provider as under review.
6. For L2 and above, independently require a current, non-suspended snapshot and a sufficient provider bond. Grace does not bypass either check.
7. Count distinct qualified auditors at the requested tier or better. Apply `min_auditor_count` independently from the named-auditor `any` / `all` rule.
8. If `min_tier` is absent or zero, do not enforce capabilities or auditor fields.

For lease creation, an on-chain open bid remains the authoritative evidence that the market handler accepted the
provider. The indexed policy result is for discovery, preflight, and explaining unavailable providers; it must not
invent a client-only eligibility rule that disagrees with `x/market`.

### Grace state

An active grace record means governance has preserved the provider's pre-discrepancy tier for a bounded period. It
prevents an immediate tier-only eligibility drop while a discrepancy is reviewed or after it is resolved. Grace does
not waive snapshot freshness, provider bond, capability, named-auditor, or minimum-auditor requirements. When grace
expires, policy falls back to the best currently valid attestation tier.

## Bid prescreening and ranking

Prescreening must keep eligibility and ranking separate:

1. Hard-filter by region and the SDL verification requirement: snapshot, bond, tier, capabilities, minimum auditor
   count, and named-auditor mode.
2. Show each filtered provider's first actionable failure and retain the full failure set for detail views.
3. Assign ranks only to eligible providers. Do not expose a rank for a provider that the market would reject.
4. For `Best match`, order by policy tier, qualified attestation count, uptime, price, then provider name. Alternate
   controls may order eligible providers by price, uptime, or tier.

This ordering is a Console presentation policy, not on-chain state. The bid produced by `x/market` remains the final
proof that the provider passed the placement requirements.

## SDL mapping

The placement profile accepts:

```yaml
profiles:
  placement:
    dcloud:
      verification:
        min_tier: 3
        min_auditor_count: 2
        auditor_mode: any
        capabilities:
          - persistent_storage
        auditors:
          - akash1auditor...
```

Supported capability values are:

- `tee_hardware_attestation`
- `confidential_computing`
- `persistent_storage`
- `bare_metal`

During the AEP-9 migration, preserve legacy `signedBy` behavior. If a placement contains both legacy audit attributes
and `verification`, the provider must satisfy both after `verification_module_active` is enabled. Before activation,
the verification block is accepted but not enforced by bid creation.

## Events and reconciliation

Ingest the typed events that can change a provider view:

- Attestations: `EventAttestationSubmitted`, `EventAttestationReplaced`, `EventAttestationExpired`,
  `EventAttestationRevoked`, `EventAttestationVoided`.
- Auditors: registered, bond posted, frozen, lapsed, resigned, renewed, and removed events.
- Provider state: provider bond posted/slashed/withdrawal events, snapshot posted/suspended/resumed events, and
  verification grace started/ended events.
- Audit lifecycle: escrow opened/settled, fee released/returned, and deposit returned/slashed events.
- Governance: discrepancy detected/resolved/timed-out events.
- Maintenance: `EventProviderMaintenanceOpened` and `EventProviderMaintenanceClosed` from `x/provider`.

Event ingestion must be idempotent. Store a chain event identity such as `(height, tx_hash, message_index,
event_index)`, then upsert the corresponding record. Events are a freshness path, not the only recovery path: reconcile
provider state from queries after startup, after indexer gaps, and periodically for time-derived expiry or maintenance
status.

## Maintenance alerts

Maintenance status is derived from `closed_at`, `starts_at`, `expected_ends_at`, and current block time:

- `Scheduled`: not closed and block time is before `starts_at`.
- `Active`: not closed and within the window.
- `Elapsed`: not closed and past `expected_ends_at`.
- `Closed`: `closed_at` is set.

When a maintenance-open event arrives, find active leases for that provider and create one alert per affected lease.
Deduplicate on `(provider, maintenance_id, lease_id)`. Closing the window resolves those alerts. Query current
maintenance records when provider and lease pages load so a missed event cannot hide a live window.

The chain does not store email, webhook, Slack, or acknowledgement preferences. Reuse Console's existing notification
channel and deployment-alert infrastructure for delivery.

## Implementation sequence

1. Add verification records and event ingestion to the indexer, including replay and reconciliation tests.
2. Extend the existing provider list/detail and bid-screening API schemas with the normalized view.
3. Replace both the review-only REST adapter and `providerVerification.mock.ts` with an adapter over generated Console
   API types.
4. Move the prototype components into the existing provider list, marketplace, provider detail, and lease surfaces.
5. Add SDL builder/import/generation support using the chain SDK's verification-enabled SDL parser.
6. Add maintenance alert persistence and delivery, then test a missed-event reconciliation path.
7. Gate rollout until the indexer is caught up and `verification_module_active` is intentionally enabled.

## Review cases

- L0 provider with no snapshot or bond.
- L2 provider with a current snapshot and sufficient bond.
- Real L2-filtered deployment whose provider bid, lease, manifest, and workload are active.
- Expired attestation that has not yet been removed from an indexed response.
- Frozen or unbonded auditor whose attestation must not count.
- Snapshot suspension during discrepancy grace.
- `any` and `all` named-auditor policies with an independent minimum count.
- Legacy-only, verification-only, and mixed placement requirements before and after activation.
- Scheduled, active, elapsed, and explicitly closed maintenance windows.
- Missed maintenance event recovered by query reconciliation.
