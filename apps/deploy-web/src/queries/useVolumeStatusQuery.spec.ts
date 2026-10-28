import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { UseProviderCredentialsResult } from "@src/hooks/useProviderCredentials/useProviderCredentials";
import type { ProviderProxyService } from "@src/services/provider-proxy/provider-proxy.service";
import type { VolumeStatus } from "@src/types/volumeStatus";
import type { VolumeLeaseRef } from "./useVolumeStatusQuery";
import { DEPENDENCIES, IMPORTING_POLL_INTERVAL, useVolumeStatus } from "./useVolumeStatusQuery";

import { setupQuery } from "@tests/unit/query-client";

const PROVIDER = { owner: "akash1provider", hostUri: "https://provider.test" };
const LEASE: VolumeLeaseRef = { provider: PROVIDER, dseq: "123", gseq: 1, oseq: 2 };
const IMPORTING: VolumeStatus = { phase: "Importing", size_bytes: 1024, import_from: "akash1previous" };
const PARKED: VolumeStatus = { phase: "Provisioned", size_bytes: 1024 };

describe(useVolumeStatus.name, () => {
  it("reads where the lease's volume stands from its provider", async () => {
    const { result, providerProxy } = setup({ statuses: [PARKED] });

    await vi.waitFor(() => expect(result.current.data).toEqual(PARKED));
    expect(providerProxy.fetchVolumeStatus).toHaveBeenCalledWith(expect.objectContaining({ provider: PROVIDER, dseq: "123", gseq: 1, oseq: 2 }));
  });

  it("reads it with a token for this deployment's status on the provider", async () => {
    const { result, providerProxy, ensureToken } = setup({ statuses: [PARKED] });

    await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
    await expect(providerProxy.fetchVolumeStatus.mock.calls[0][0].ensureToken()).resolves.toBe("status-jwt");
    expect(ensureToken).toHaveBeenCalledWith({ access: { provider: "akash1provider", dseqs: ["123"], scope: ["status"] } });
  });

  it("reads it again while the volume's data is copied in, until it arrived", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result, providerProxy } = setup({ statuses: [IMPORTING, PARKED] });
      await vi.waitFor(() => expect(result.current.data).toEqual(IMPORTING));

      await vi.advanceTimersByTimeAsync(IMPORTING_POLL_INTERVAL);
      await vi.waitFor(() => expect(result.current.data).toEqual(PARKED));
      await vi.advanceTimersByTimeAsync(IMPORTING_POLL_INTERVAL * 3);

      expect(providerProxy.fetchVolumeStatus).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the lease's provider", () => {
    const { result, providerProxy } = setup({ lease: { ...LEASE, provider: undefined } });

    expect(result.current.fetchStatus).toBe("idle");
    expect(providerProxy.fetchVolumeStatus).not.toHaveBeenCalled();
  });

  it("reads nothing while turned off", () => {
    const { result, providerProxy } = setup({ enabled: false });

    expect(result.current.fetchStatus).toBe("idle");
    expect(providerProxy.fetchVolumeStatus).not.toHaveBeenCalled();
  });

  it("reads as soon as it is turned on", () => {
    const { result } = setup({ enabled: true });

    expect(result.current.fetchStatus).toBe("fetching");
  });

  function setup(input: { statuses?: VolumeStatus[]; lease?: VolumeLeaseRef; enabled?: boolean }) {
    const statuses = [...(input.statuses ?? [PARKED])];
    const providerProxy = mock<ProviderProxyService>({
      fetchVolumeStatus: vi.fn(() => Promise.resolve(statuses.length > 1 ? statuses.shift()! : statuses[0]))
    });
    const ensureToken = vi.fn().mockResolvedValue("status-jwt");
    const useProviderCredentials = () => mock<UseProviderCredentialsResult>({ ensureToken });
    const dependencies = { ...DEPENDENCIES, useProviderCredentials };

    const { result } = setupQuery(() => useVolumeStatus(input.lease ?? LEASE, { enabled: input.enabled }, dependencies), {
      services: { providerProxy: () => providerProxy }
    });

    return { result, providerProxy, ensureToken };
  }
});
