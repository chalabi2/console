import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchProviderVerificationFeed } from "./providerVerification.server";

const provider = "akash1provider";
const auditor = "akash1auditor";

describe(fetchProviderVerificationFeed.name, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes live chain records into the Console provider view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async input => jsonResponse(responseFor(new URL(String(input)).pathname)))
    );

    const feed = await fetchProviderVerificationFeed("http://testnet.example:1317/", new Date("2026-07-20T12:00:00Z"));

    expect(feed).toMatchObject({ chainId: "aep-86", moduleActive: true, observedAt: "2026-07-20T12:00:00.000Z" });
    expect(feed.providers).toHaveLength(1);
    expect(feed.providers[0]).toMatchObject({
      owner: provider,
      name: "Overclock Labs",
      region: "us-west",
      snapshot: { kind: "current", resources: { cpu: 4, gpu: 1, memoryGi: 16, storageTi: 1 } },
      bond: { kind: "bonded", amount: "1,000 AKT", required: "25 AKT" },
      discrepancy: { kind: "grace", id: "9", preservedTier: "L3" },
      activeLease: {
        kind: "active",
        dseq: "741923",
        provider,
        price: "520,000 uACT/block",
        region: "us-west",
        verificationRequirement: {
          minTier: "L2",
          requiredCapabilities: ["persistent_storage"],
          requiredAuditors: [auditor],
          auditorMode: "any",
          minAuditorCount: 1
        }
      }
    });
    expect(feed.providers[0].attestations[0]).toMatchObject({
      tier: "L3",
      status: "valid",
      capabilities: ["persistent_storage"],
      auditor: { status: "active", bondStatus: "bonded" }
    });
    expect(feed.providers[0].auditEscrows[0]).toMatchObject({ id: "12", status: "consumed", auditorName: "Auditor akash1audi…ditor" });
  });

  it("rejects a non-successful required query", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 }))
    );

    await expect(fetchProviderVerificationFeed("http://testnet.example:1317")).rejects.toThrow("returned 503");
  });
});

function responseFor(path: string): unknown {
  switch (path) {
    case "/akash/provider/v1beta4/providers":
      return {
        providers: [
          {
            owner: provider,
            host_uri: "https://provider.example",
            attributes: [
              { key: "organization", value: "overclock-labs" },
              { key: "region", value: "us-west" }
            ]
          }
        ]
      };
    case "/akash/verification/v1/auditors":
      return { auditors: [{ address: auditor, status: "auditor_status_active", bond_status: "bond_status_bonded" }] };
    case "/akash/verification/v1/discrepancies":
      return { discrepancies: [{ id: "7", provider, resolution_status: "discrepancy_status_resolved" }] };
    case "/akash/verification/v1/params":
      return { params: { verification_module_active: true } };
    case "/cosmos/base/tendermint/v1beta1/node_info":
      return { default_node_info: { network: "aep-86" } };
    case `/akash/verification/v1/providers/${provider}/attestations`:
      return {
        attestations: [
          {
            auditor,
            tier: "verification_tier_established",
            capabilities: ["capability_persistent_storage"],
            evidence_hash: "evidence",
            created_at: "2026-07-01T00:00:00Z",
            expires_at: "2026-10-01T00:00:00Z",
            status: "attestation_status_valid"
          }
        ]
      };
    case `/akash/verification/v1/providers/${provider}/snapshot`:
      return {
        snapshot: {
          snapshot_hash: "snapshot",
          resource_summary: { total_gpus: 1, total_vcpus: 4, total_memory_mb: "16384", total_storage_mb: "1048576" },
          posted_at: "2026-07-20T11:00:00Z",
          compliance_deadline: "2026-07-21T11:00:00Z",
          suspended: false
        }
      };
    case `/akash/verification/v1/providers/${provider}/bond`:
      return {
        bond: { bonded_amount: { denom: "uakt", amount: "1000000000" }, unbonding_entries: [] },
        required_for_current_tier: { denom: "uakt", amount: "25000000" }
      };
    case `/akash/verification/v1/providers/${provider}/audit-escrows`:
      return {
        escrows: [
          {
            id: "12",
            consumed_by_auditor: auditor,
            requested_tier: "verification_tier_established",
            fee: { denom: "uakt", amount: "200000000" },
            provider_deposit: { denom: "uakt", amount: "100000000" },
            status: "audit_escrow_status_consumed"
          }
        ]
      };
    case `/akash/verification/v1/providers/${provider}/grace`:
      return {
        grace: {
          id: "9",
          preserved_tier: "verification_tier_established",
          started_at: "2026-07-19T00:00:00Z",
          expires_at: "2026-07-29T00:00:00Z",
          status: "verification_grace_status_active"
        }
      };
    case `/akash/provider/v1beta4/providers/${provider}/maintenance`:
      return { maintenance: [] };
    case "/akash/market/v1beta5/leases/list":
      return {
        leases: [
          {
            lease: {
              id: { owner: "akash1tenant", dseq: "741923", gseq: 1, oseq: 1, provider, bseq: 1 },
              state: "active",
              price: { denom: "uact", amount: "520000" },
              created_at: "1182047"
            }
          }
        ]
      };
    case "/akash/market/v1beta5/orders/info":
      return {
        order: {
          spec: {
            requirements: {
              attributes: [{ key: "region", value: "us-west" }],
              verification: {
                min_tier: "verification_tier_verified",
                required_capabilities: ["capability_persistent_storage"],
                required_auditors: [auditor],
                auditor_mode: "auditor_selection_mode_any",
                min_auditor_count: 1
              }
            }
          }
        }
      };
    default:
      throw new Error(`Unhandled test URL: ${path}`);
  }
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}
