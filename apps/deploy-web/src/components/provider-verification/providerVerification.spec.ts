import { describe, expect, it } from "vitest";

import {
  deriveMaintenanceStatus,
  deriveProviderVerification,
  evaluateVerificationRequirement,
  prescreenProviders,
  verificationRequirementToYaml
} from "./providerVerification";
import { mockProviders, REVIEW_NOW } from "./providerVerification.mock";
import type { VerificationRequirement } from "./providerVerification.types";

const baseRequirement: VerificationRequirement = {
  minTier: "L2",
  requiredCapabilities: ["persistent_storage"],
  requiredAuditors: [],
  auditorMode: "any",
  minAuditorCount: 1
};

describe(deriveProviderVerification.name, () => {
  it("derives the highest tier from active, bonded, unexpired attestations", () => {
    const summary = deriveProviderVerification(mockProviders[0], REVIEW_NOW);

    expect(summary.bestTier).toBe("L3");
    expect(summary.validAttestations).toHaveLength(2);
    expect(summary.capabilities).toEqual(["bare_metal", "persistent_storage", "tee_hardware_attestation"]);
  });

  it("excludes expired attestations even when their chain status is still valid", () => {
    const provider = {
      ...mockProviders[0],
      attestations: mockProviders[0].attestations.map((attestation, index) =>
        index === 0 ? { ...attestation, expiresAt: "2026-07-19T12:00:00Z" } : attestation
      )
    };

    expect(deriveProviderVerification(provider, REVIEW_NOW).validAttestations).toHaveLength(1);
  });

  it("uses the preserved grace tier while a discrepancy is under review", () => {
    const summary = deriveProviderVerification(mockProviders[3], REVIEW_NOW);

    expect(summary.bestTier).toBe("L3");
    expect(summary.policyTier).toBe("L3");
  });
});

describe(evaluateVerificationRequirement.name, () => {
  it("accepts a provider that meets tier, snapshot, bond, capability, and auditor requirements", () => {
    expect(evaluateVerificationRequirement(mockProviders[0], baseRequirement, REVIEW_NOW)).toEqual({ kind: "eligible" });
  });

  it("reports every unmet requirement", () => {
    const result = evaluateVerificationRequirement(
      mockProviders[2],
      { ...baseRequirement, requiredCapabilities: ["confidential_computing"], minAuditorCount: 2 },
      REVIEW_NOW
    );

    expect(result).toEqual({
      kind: "ineligible",
      failures: [
        { code: "snapshot", state: "not-posted" },
        { code: "bond", state: "not-required" },
        { code: "tier", actual: "L1", required: "L2" },
        { code: "capability", capability: "confidential_computing" },
        { code: "auditor-count", actual: 0, required: 2 }
      ]
    });
  });

  it("keeps a snapshot-suspended provider ineligible during discrepancy grace", () => {
    expect(evaluateVerificationRequirement(mockProviders[3], baseRequirement, REVIEW_NOW)).toMatchObject({
      kind: "ineligible",
      failures: [{ code: "snapshot", state: "suspended" }]
    });
  });

  it("does not enforce verification fields when the minimum tier is L0", () => {
    expect(
      evaluateVerificationRequirement(
        mockProviders[2],
        {
          minTier: "L0",
          requiredCapabilities: ["confidential_computing"],
          requiredAuditors: ["akash1missing"],
          auditorMode: "all",
          minAuditorCount: 4
        },
        REVIEW_NOW
      )
    ).toEqual({ kind: "eligible" });
  });

  it("applies any and all named-auditor modes independently of auditor count", () => {
    const addresses = mockProviders[0].attestations.map(attestation => attestation.auditor.address);

    expect(evaluateVerificationRequirement(mockProviders[0], { ...baseRequirement, requiredAuditors: [addresses[0], "akash1missing"] }, REVIEW_NOW)).toEqual({
      kind: "eligible"
    });
    expect(
      evaluateVerificationRequirement(
        mockProviders[0],
        { ...baseRequirement, requiredAuditors: [addresses[0], "akash1missing"], auditorMode: "all" },
        REVIEW_NOW
      )
    ).toMatchObject({ kind: "ineligible", failures: [{ code: "required-auditor", mode: "all" }] });
  });
});

describe(prescreenProviders.name, () => {
  it("ranks only providers that pass the placement requirements", () => {
    const results = prescreenProviders({ providers: mockProviders, requirement: baseRequirement, now: REVIEW_NOW, region: "all", sortBy: "best-match" });

    expect(results.map(result => ({ name: result.provider.name, kind: result.kind, rank: result.kind === "eligible" ? result.rank : null }))).toEqual([
      { name: "Nebula Compute", kind: "eligible", rank: 1 },
      { name: "Atlas Cloud", kind: "eligible", rank: 2 },
      { name: "Stratus Systems", kind: "filtered", rank: null },
      { name: "Cinder GPU", kind: "filtered", rank: null }
    ]);
  });

  it("supports price ranking without changing hard eligibility", () => {
    const results = prescreenProviders({ providers: mockProviders, requirement: baseRequirement, now: REVIEW_NOW, region: "all", sortBy: "price" });

    expect(results.filter(result => result.kind === "eligible").map(result => [result.rank, result.provider.name])).toEqual([
      [1, "Atlas Cloud"],
      [2, "Nebula Compute"]
    ]);
  });

  it("treats the placement region as a hard prescreen filter", () => {
    const results = prescreenProviders({ providers: mockProviders, requirement: baseRequirement, now: REVIEW_NOW, region: "us-west", sortBy: "best-match" });
    const atlas = results.find(result => result.provider.name === "Atlas Cloud");

    expect(results.filter(result => result.kind === "eligible").map(result => result.provider.name)).toEqual(["Nebula Compute"]);
    expect(atlas).toMatchObject({ kind: "filtered", regionMatches: false });
  });
});

describe(deriveMaintenanceStatus.name, () => {
  it("derives scheduled, active, elapsed, and closed from window timestamps", () => {
    const scheduled = mockProviders[1].maintenance;
    expect(deriveMaintenanceStatus(scheduled, REVIEW_NOW)).toBe("scheduled");
    if (scheduled.kind !== "window") throw new Error("Expected a maintenance window fixture");

    expect(deriveMaintenanceStatus({ ...scheduled, startsAt: "2026-07-20T11:00:00Z" }, REVIEW_NOW)).toBe("active");
    expect(deriveMaintenanceStatus({ ...scheduled, startsAt: "2026-07-20T10:00:00Z", expectedEndsAt: "2026-07-20T11:30:00Z" }, REVIEW_NOW)).toBe("elapsed");
    expect(deriveMaintenanceStatus({ ...scheduled, closedAt: "2026-07-20T11:45:00Z" }, REVIEW_NOW)).toBe("closed");
  });
});

describe(verificationRequirementToYaml.name, () => {
  it("emits the canonical SDL verification block", () => {
    expect(verificationRequirementToYaml({ ...baseRequirement, minAuditorCount: 2 })).toContain(
      "verification:\n  min_tier: 2\n  min_auditor_count: 2\n  capabilities:\n    - persistent_storage"
    );
  });

  it("omits the verification block for L0", () => {
    expect(verificationRequirementToYaml({ ...baseRequirement, minTier: "L0" })).toBe("# No verification requirement");
  });
});
