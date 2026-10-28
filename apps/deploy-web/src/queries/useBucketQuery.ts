import type { JwtTokenAccessScope } from "@akashnetwork/chain-sdk/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useServices } from "@src/context/ServicesProvider";
import { BUCKET_KEYS_SCOPE, BUCKET_SCOPE, useProviderCredentials } from "@src/hooks/useProviderCredentials/useProviderCredentials";
import { useProviderJwt } from "@src/hooks/useProviderJwt/useProviderJwt";
import type { ProviderIdentity } from "@src/services/provider-proxy/provider-proxy.service";
import type { BucketInfo, BucketKey, BucketKeyAccess } from "@src/types/bucket";
import { QueryKeys } from "./queryKeys";

export const DEPENDENCIES = {
  useServices,
  useProviderJwt,
  useProviderCredentials,
  useQueryClient
};

export interface BucketLease {
  provider: ProviderIdentity | undefined | null;
  dseq: string;
  gseq: number;
  oseq: number;
}

export function useBucketInfo(lease: BucketLease, options: { enabled?: boolean } = {}, dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { providerProxy } = dependencies.useServices();
  const tokenFor = useBucketToken(lease, dependencies);

  return useQuery<BucketInfo, Error>({
    queryKey: QueryKeys.getBucketInfoKey(lease.dseq, lease.gseq, lease.oseq),
    queryFn: () => {
      const provider = providerOf(lease);
      return providerProxy.fetchBucketInfo({ ...lease, provider, ensureToken: () => tokenFor(provider, BUCKET_SCOPE) });
    },
    enabled: !!lease.provider && options.enabled !== false
  });
}

export function useCreateBucketKey(lease: BucketLease, dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { providerProxy } = dependencies.useServices();
  const queryClient = dependencies.useQueryClient();
  const tokenFor = useBucketToken(lease, dependencies);

  return useMutation<BucketKey, Error, { name: string; access: BucketKeyAccess }>({
    mutationFn: ({ name, access }) => {
      const provider = providerOf(lease);
      return providerProxy.createBucketKey({ ...lease, provider, name, access, ensureToken: () => tokenFor(provider, BUCKET_KEYS_SCOPE) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QueryKeys.getBucketInfoKey(lease.dseq, lease.gseq, lease.oseq) })
  });
}

export function useRevokeBucketKey(lease: BucketLease, dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { providerProxy } = dependencies.useServices();
  const queryClient = dependencies.useQueryClient();
  const tokenFor = useBucketToken(lease, dependencies);

  return useMutation<void, Error, string>({
    mutationFn: name => {
      const provider = providerOf(lease);
      return providerProxy.revokeBucketKey({ ...lease, provider, name, ensureToken: () => tokenFor(provider, BUCKET_KEYS_SCOPE) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QueryKeys.getBucketInfoKey(lease.dseq, lease.gseq, lease.oseq) })
  });
}

/** The shared token carries no bucket scope, so its holder gets one for this provider alone, as for attestation. */
function useBucketToken(lease: BucketLease, dependencies: typeof DEPENDENCIES) {
  const { generateScopedProviderToken } = dependencies.useProviderJwt();
  const { tokenMode, ensureToken } = dependencies.useProviderCredentials();

  return (provider: ProviderIdentity, scope: readonly JwtTokenAccessScope[]) =>
    tokenMode === "shared"
      ? generateScopedProviderToken({ provider: provider.owner, scope })
      : ensureToken({ access: { provider: provider.owner, dseqs: [lease.dseq], scope } });
}

function providerOf(lease: BucketLease): ProviderIdentity {
  if (!lease.provider) throw new Error("Provider is not available for this lease.");
  return lease.provider;
}
