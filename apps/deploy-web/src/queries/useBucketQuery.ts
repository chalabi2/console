import type { JwtTokenAccessScope } from "@akashnetwork/chain-sdk/web";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useServices } from "@src/context/ServicesProvider";
import { BUCKET_KEYS_SCOPE, BUCKET_SCOPE, useProviderCredentials } from "@src/hooks/useProviderCredentials/useProviderCredentials";
import { useProviderJwt } from "@src/hooks/useProviderJwt/useProviderJwt";
import type { ProviderIdentity } from "@src/services/provider-proxy/provider-proxy.service";
import type { BucketInfo, BucketKey, BucketKeyAccess } from "@src/types/bucket";
import { bucketEnvOf, type BucketEnvVariable } from "@src/utils/bucketUtils";
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

export function useBucketInfo(
  lease: BucketLease,
  options: { enabled?: boolean; refetchInterval?: number | false } = {},
  dependencies: typeof DEPENDENCIES = DEPENDENCIES
) {
  const { providerProxy } = dependencies.useServices();
  const tokenFor = useBucketToken(dependencies);

  return useQuery<BucketInfo, Error>({
    queryKey: QueryKeys.getBucketInfoKey(lease.dseq, lease.gseq, lease.oseq),
    queryFn: () => {
      const provider = providerOf(lease);
      return providerProxy.fetchBucketInfo({ ...lease, provider, ensureToken: () => tokenFor(provider, lease.dseq, BUCKET_SCOPE) });
    },
    enabled: !!lease.provider && options.enabled !== false,
    refetchInterval: options.refetchInterval
  });
}

export function useCreateBucketKey(lease: BucketLease, dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { providerProxy } = dependencies.useServices();
  const queryClient = dependencies.useQueryClient();
  const tokenFor = useBucketToken(dependencies);

  return useMutation<BucketKey, Error, { name: string; access: BucketKeyAccess }>({
    mutationFn: ({ name, access }) => {
      const provider = providerOf(lease);
      return providerProxy.createBucketKey({ ...lease, provider, name, access, ensureToken: () => tokenFor(provider, lease.dseq, BUCKET_KEYS_SCOPE) });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QueryKeys.getBucketInfoKey(lease.dseq, lease.gseq, lease.oseq) })
  });
}

export function useRevokeBucketKey(lease: BucketLease, dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { providerProxy } = dependencies.useServices();
  const queryClient = dependencies.useQueryClient();
  const tokenFor = useBucketToken(dependencies);

  return useMutation<void, Error, string>({
    mutationFn: name => {
      const provider = providerOf(lease);
      return providerProxy.revokeBucketKey({ ...lease, provider, name, ensureToken: () => tokenFor(provider, lease.dseq, BUCKET_KEYS_SCOPE) });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QueryKeys.getBucketInfoKey(lease.dseq, lease.gseq, lease.oseq) })
  });
}

/** Gives a service a new key to a bucket, answering with the variables that hand it the bucket. */
export function useConnectBucket(dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { providerProxy } = dependencies.useServices();
  const queryClient = dependencies.useQueryClient();
  const tokenFor = useBucketToken(dependencies);

  return useMutation<BucketEnvVariable[], Error, { lease: BucketLease; name: string; access: BucketKeyAccess }>({
    mutationFn: async ({ lease, name, access }) => {
      const provider = providerOf(lease);
      const info = await providerProxy.fetchBucketInfo({ ...lease, provider, ensureToken: () => tokenFor(provider, lease.dseq, BUCKET_SCOPE) });
      const key = await providerProxy.createBucketKey({
        ...lease,
        provider,
        name,
        access,
        ensureToken: () => tokenFor(provider, lease.dseq, BUCKET_KEYS_SCOPE)
      });
      return bucketEnvOf(info, key);
    },
    onSuccess: (_variables, { lease }) => queryClient.invalidateQueries({ queryKey: QueryKeys.getBucketInfoKey(lease.dseq, lease.gseq, lease.oseq) })
  });
}

/** The shared token carries no bucket scope, so its holder gets one for this provider alone, as for attestation. */
function useBucketToken(dependencies: typeof DEPENDENCIES) {
  const { generateScopedProviderToken } = dependencies.useProviderJwt();
  const { tokenMode, ensureToken } = dependencies.useProviderCredentials();

  return (provider: ProviderIdentity, dseq: string, scope: readonly JwtTokenAccessScope[]) =>
    tokenMode === "shared"
      ? generateScopedProviderToken({ provider: provider.owner, scope })
      : ensureToken({ access: { provider: provider.owner, dseqs: [dseq], scope } });
}

function providerOf(lease: BucketLease): ProviderIdentity {
  if (!lease.provider) throw new Error("Provider is not available for this lease.");
  return lease.provider;
}
