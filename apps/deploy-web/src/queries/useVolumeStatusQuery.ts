import { useQuery } from "@tanstack/react-query";

import { useServices } from "@src/context/ServicesProvider";
import { LEASE_STATUS_SCOPE, useProviderCredentials } from "@src/hooks/useProviderCredentials/useProviderCredentials";
import type { ProviderIdentity } from "@src/services/provider-proxy/provider-proxy.service";
import type { VolumeStatus } from "@src/types/volumeStatus";
import { QueryKeys } from "./queryKeys";

export const DEPENDENCIES = { useServices, useProviderCredentials };

export const IMPORTING_PHASE = "Importing";

/** A moved volume can mount once its data arrives, so it is checked on often enough to show that soon after. */
export const IMPORTING_POLL_INTERVAL = 5000;

export interface VolumeLeaseRef {
  provider: ProviderIdentity | undefined;
  dseq: string;
  gseq: number;
  oseq: number;
}

/** Where a volume stands on the provider holding its lease, read again while its data is still being copied in. */
export function useVolumeStatus(lease: VolumeLeaseRef, options: { enabled?: boolean } = {}, dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { providerProxy } = dependencies.useServices();
  const { ensureToken } = dependencies.useProviderCredentials();

  return useQuery<VolumeStatus, Error>({
    queryKey: QueryKeys.getVolumeStatusKey(lease.dseq, lease.gseq, lease.oseq),
    queryFn: () => {
      const provider = providerOf(lease);
      return providerProxy.fetchVolumeStatus({
        ...lease,
        provider,
        ensureToken: () => ensureToken({ access: { provider: provider.owner, dseqs: [lease.dseq], scope: LEASE_STATUS_SCOPE } })
      });
    },
    enabled: !!lease.provider && options.enabled !== false,
    refetchInterval: query => (query.state.data?.phase === IMPORTING_PHASE ? IMPORTING_POLL_INTERVAL : false)
  });
}

function providerOf(lease: VolumeLeaseRef): ProviderIdentity {
  if (!lease.provider) throw new Error("Provider is not available for this lease.");
  return lease.provider;
}
