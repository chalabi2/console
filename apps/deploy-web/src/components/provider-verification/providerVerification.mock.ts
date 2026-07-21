import type { AuditorFact, ProviderVerificationMock, VerificationRequirement } from "./providerVerification.types";

export const REVIEW_NOW = new Date("2026-07-20T12:00:00Z");

const northstar: AuditorFact = {
  address: "akash1northstar9m8d4k7y6v5w3s2p0q8r7t6u5e4",
  name: "Northstar Assurance",
  status: "active",
  bondStatus: "bonded"
};

const openCompute: AuditorFact = {
  address: "akash1opencompute8q7w6e5r4t3y2u1i9o8p7a6s5d4",
  name: "Open Compute Audit",
  status: "active",
  bondStatus: "bonded"
};

const atlasVerification: AuditorFact = {
  address: "akash1atlasverify7u6y5t4r3e2w1q9p8o7i6u5y4t3",
  name: "Atlas Verification",
  status: "active",
  bondStatus: "bonded"
};

export const mockAuditors = [northstar, openCompute, atlasVerification];

export const defaultVerificationRequirement: VerificationRequirement = {
  minTier: "L2",
  requiredCapabilities: ["persistent_storage"],
  requiredAuditors: [],
  auditorMode: "any",
  minAuditorCount: 1
};

export const mockProviders: ProviderVerificationMock[] = [
  {
    owner: "akash1nebula8d4k7y6v5w3s2p0q8r7t6u5e4m3n2c",
    name: "Nebula Compute",
    hostUri: "https://provider.nebula.example",
    region: "us-west",
    uptime: 0.9997,
    monthlyPrice: 8.42,
    attestations: [
      {
        auditor: northstar,
        tier: "L3",
        capabilities: ["persistent_storage", "bare_metal"],
        status: "valid",
        createdAt: "2026-06-18T14:20:00Z",
        expiresAt: "2026-09-16T14:20:00Z",
        evidenceHash: "sha256:9a7d5f37a4886731d4889fa7ea5e112af9adf2569d0f4dc1f07c1182cf615d3e"
      },
      {
        auditor: openCompute,
        tier: "L3",
        capabilities: ["persistent_storage", "tee_hardware_attestation"],
        status: "valid",
        createdAt: "2026-06-21T09:10:00Z",
        expiresAt: "2026-09-19T09:10:00Z",
        evidenceHash: "sha256:5700b9cb6224873eb056aef68a1f90017b5e4b4124d0fc64d5ad0234084fcae0"
      }
    ],
    snapshot: {
      kind: "current",
      postedAt: "2026-07-20T11:46:00Z",
      hash: "sha256:10748eab45a2f298e30a7e4c209086f8f441252d113a33a98f0d2ce76ebd92d8",
      resources: { cpu: 128, gpu: 8, memoryGi: 512, storageTi: 40 }
    },
    bond: { kind: "bonded", amount: "5,500 AKT", required: "5,200 AKT" },
    discrepancy: { kind: "none" },
    maintenance: { kind: "none" },
    activeLease: { kind: "none" },
    auditEscrows: [
      { id: "42", requestedTier: "L3", fee: "200 AKT", providerDeposit: "100 AKT", status: "consumed", auditorName: northstar.name },
      { id: "39", requestedTier: "L2", fee: "50 AKT", providerDeposit: "100 AKT", status: "settled", auditorName: openCompute.name }
    ]
  },
  {
    owner: "akash1atlas6v5w3s2p0q8r7t6u5e4m3n2c1x9z8a",
    name: "Atlas Cloud",
    hostUri: "https://provider.atlas.example",
    region: "eu-central",
    uptime: 0.9979,
    monthlyPrice: 7.96,
    attestations: [
      {
        auditor: northstar,
        tier: "L2",
        capabilities: ["persistent_storage"],
        status: "valid",
        createdAt: "2026-05-30T10:00:00Z",
        expiresAt: "2026-11-26T10:00:00Z",
        evidenceHash: "sha256:4ef0d0e753a53ea676b5337091f587f5cb437110c117ef077067c3b78ca46f8b"
      },
      {
        auditor: atlasVerification,
        tier: "L2",
        capabilities: ["persistent_storage"],
        status: "valid",
        createdAt: "2026-06-03T08:30:00Z",
        expiresAt: "2026-11-30T08:30:00Z",
        evidenceHash: "sha256:ca1f09fffd996cf4cff82e3c8669edf820e2ebf23acc39cc47a7903dc201798d"
      }
    ],
    snapshot: {
      kind: "current",
      postedAt: "2026-07-20T11:38:00Z",
      hash: "sha256:e55afbdd8d7eaee793c14c11e1e35259fbf18f8d29f5dcbf148ebd4a20e6d559",
      resources: { cpu: 72, gpu: 2, memoryGi: 256, storageTi: 24 }
    },
    bond: { kind: "bonded", amount: "2,400 AKT", required: "2,180 AKT" },
    discrepancy: { kind: "none" },
    maintenance: {
      kind: "window",
      id: "18",
      maintenanceType: "network",
      startsAt: "2026-07-20T16:00:00Z",
      expectedEndsAt: "2026-07-20T18:00:00Z"
    },
    activeLease: {
      kind: "active",
      owner: "akash1tenant7y6v5w3s2p0q8r7t6u5e4m3n2c1x9",
      provider: "akash1atlas6v5w3s2p0q8r7t6u5e4m3n2c1x9z8a",
      dseq: "741923",
      gseq: 1,
      oseq: 1,
      bseq: 1,
      price: "1.68672 uACT/block",
      createdAt: "1182047",
      region: "us-west",
      verificationRequirement: defaultVerificationRequirement
    },
    auditEscrows: [{ id: "38", requestedTier: "L2", fee: "50 AKT", providerDeposit: "100 AKT", status: "consumed", auditorName: northstar.name }]
  },
  {
    owner: "akash1cinder3s2p0q8r7t6u5e4m3n2c1x9z8a7b6d",
    name: "Cinder GPU",
    hostUri: "https://provider.cinder.example",
    region: "us-east",
    uptime: 0.9921,
    monthlyPrice: 6.88,
    attestations: [
      {
        auditor: atlasVerification,
        tier: "L1",
        capabilities: [],
        status: "valid",
        createdAt: "2026-06-29T16:40:00Z",
        expiresAt: "2027-06-29T16:40:00Z",
        evidenceHash: "sha256:45e1207b9d4e48b9c5ee76524564d62b83c882dc7526c20805f88072ef4fb878"
      }
    ],
    snapshot: { kind: "not-posted" },
    bond: { kind: "not-required" },
    discrepancy: { kind: "none" },
    maintenance: { kind: "none" },
    activeLease: { kind: "none" },
    auditEscrows: [{ id: "44", requestedTier: "L2", fee: "50 AKT", providerDeposit: "100 AKT", status: "open" }]
  },
  {
    owner: "akash1stratus0q8r7t6u5e4m3n2c1x9z8a7b6d5f4g",
    name: "Stratus Systems",
    hostUri: "https://provider.stratus.example",
    region: "ap-southeast",
    uptime: 0.9988,
    monthlyPrice: 9.14,
    attestations: [
      {
        auditor: openCompute,
        tier: "L3",
        capabilities: ["persistent_storage", "confidential_computing"],
        status: "valid",
        createdAt: "2026-07-01T07:15:00Z",
        expiresAt: "2026-09-29T07:15:00Z",
        evidenceHash: "sha256:2f61cb8d906860cd43e233d5c93ef19b68d9d138b20276fbf83ed74acbd48c11"
      },
      {
        auditor: northstar,
        tier: "L2",
        capabilities: ["persistent_storage"],
        status: "valid",
        createdAt: "2026-06-27T11:20:00Z",
        expiresAt: "2026-12-24T11:20:00Z",
        evidenceHash: "sha256:6c7f3c8eb315bf44245cff9b6f04e32cc3baa71452f702f9960f0bb60614a66c"
      }
    ],
    snapshot: {
      kind: "suspended",
      postedAt: "2026-07-20T10:52:00Z",
      hash: "sha256:74d05ea824bd9468ff86c731cd26f1a047a20d148531810118ffadb2957dc160",
      resources: { cpu: 96, gpu: 4, memoryGi: 384, storageTi: 32 }
    },
    bond: { kind: "bonded", amount: "3,800 AKT", required: "3,640 AKT" },
    discrepancy: {
      kind: "under-review",
      id: "7",
      preservedTier: "L3",
      openedAt: "2026-07-20T10:54:00Z",
      graceEndsAt: "2026-07-21T10:54:00Z"
    },
    maintenance: { kind: "none" },
    activeLease: { kind: "none" },
    auditEscrows: [{ id: "46", requestedTier: "L3", fee: "200 AKT", providerDeposit: "100 AKT", status: "consumed", auditorName: openCompute.name }]
  }
];
