import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { UseProviderCredentialsResult } from "@src/hooks/useProviderCredentials/useProviderCredentials";
import type { useProviderJwt } from "@src/hooks/useProviderJwt/useProviderJwt";
import type { ProviderProxyService } from "@src/services/provider-proxy/provider-proxy.service";
import type { BucketInfo, BucketKey } from "@src/types/bucket";
import type { BucketLease } from "./useBucketQuery";
import { DEPENDENCIES, useBucketInfo, useConnectBucket, useCreateBucketKey, useRevokeBucketKey } from "./useBucketQuery";

import { setupQuery } from "@tests/unit/query-client";

const PROVIDER = { owner: "akash1provider", hostUri: "https://provider.test" };
const LEASE: BucketLease = { provider: PROVIDER, dseq: "123", gseq: 1, oseq: 2 };
const INFO: BucketInfo = { bucket: "assets-0123", endpoint: "https://s3.provider.test", region: "default", size_bytes: 1024, used_bytes: 0, keys: [] };
const KEY: BucketKey = { name: "app", access: "readwrite", access_key_id: "AKID", secret_access_key: "SECRET" };

describe("useBucketQuery", () => {
  describe(useBucketInfo.name, () => {
    it("reads the lease's bucket from its provider", async () => {
      const { result, providerProxy } = setup({ useHook: dependencies => useBucketInfo(LEASE, {}, dependencies) });

      await vi.waitFor(() => expect(result.current.data).toEqual(INFO));
      expect(providerProxy.fetchBucketInfo).toHaveBeenCalledWith(expect.objectContaining({ provider: PROVIDER, dseq: "123", gseq: 1, oseq: 2 }));
    });

    it("reads it with a token for this provider's bucket scope", async () => {
      const { result, providerProxy, generateScopedProviderToken } = setup({ useHook: dependencies => useBucketInfo(LEASE, {}, dependencies) });

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      await expect(providerProxy.fetchBucketInfo.mock.calls[0][0].ensureToken()).resolves.toBe("scoped-jwt");
      expect(generateScopedProviderToken).toHaveBeenCalledWith({ provider: "akash1provider", scope: ["bucket"] });
    });

    it("reads it with a token for this deployment when the caller reaches only some projects", async () => {
      const { result, providerProxy, ensureToken, generateScopedProviderToken } = setup({
        tokenMode: "per-deployment",
        useHook: dependencies => useBucketInfo(LEASE, {}, dependencies)
      });

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      await expect(providerProxy.fetchBucketInfo.mock.calls[0][0].ensureToken()).resolves.toBe("deployment-jwt");
      expect(ensureToken).toHaveBeenCalledWith({ access: { provider: "akash1provider", dseqs: ["123"], scope: ["bucket"] } });
      expect(generateScopedProviderToken).not.toHaveBeenCalled();
    });

    it("waits for the lease's provider", () => {
      const { providerProxy } = setup({ useHook: dependencies => useBucketInfo({ ...LEASE, provider: undefined }, {}, dependencies) });

      expect(providerProxy.fetchBucketInfo).not.toHaveBeenCalled();
    });

    it("reads nothing while turned off", () => {
      const { providerProxy } = setup({ useHook: dependencies => useBucketInfo(LEASE, { enabled: false }, dependencies) });

      expect(providerProxy.fetchBucketInfo).not.toHaveBeenCalled();
    });

    it("reads it again on the interval it is given", async () => {
      const { providerProxy } = setup({ useHook: dependencies => useBucketInfo(LEASE, { refetchInterval: 10 }, dependencies) });

      await vi.waitFor(() => expect(providerProxy.fetchBucketInfo.mock.calls.length).toBeGreaterThan(1));
    });
  });

  describe(useCreateBucketKey.name, () => {
    it("creates the key with a token for this provider's bucket-keys scope", async () => {
      const { result, providerProxy, generateScopedProviderToken } = setup({ useHook: dependencies => useCreateBucketKey(LEASE, dependencies) });

      result.current.mutate({ name: "app", access: "readwrite" });

      await vi.waitFor(() => expect(result.current.data).toEqual(KEY));
      const request = providerProxy.createBucketKey.mock.calls[0][0];
      expect(request).toEqual(expect.objectContaining({ provider: PROVIDER, dseq: "123", gseq: 1, oseq: 2, name: "app", access: "readwrite" }));
      await expect(request.ensureToken()).resolves.toBe("scoped-jwt");
      expect(generateScopedProviderToken).toHaveBeenCalledWith({ provider: "akash1provider", scope: ["bucket-keys"] });
    });

    it("reloads the bucket once the key exists", async () => {
      const { result, queryClient } = setup({ useHook: dependencies => useCreateBucketKey(LEASE, dependencies) });

      result.current.mutate({ name: "app", access: "read" });

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["BUCKET_INFO", "123", 1, 2] });
    });

    it("refuses without the lease's provider", async () => {
      const { result, providerProxy } = setup({ useHook: dependencies => useCreateBucketKey({ ...LEASE, provider: null }, dependencies) });

      result.current.mutate({ name: "app", access: "read" });

      await vi.waitFor(() => expect(result.current.error?.message).toBe("Provider is not available for this lease."));
      expect(providerProxy.createBucketKey).not.toHaveBeenCalled();
    });
  });

  describe(useRevokeBucketKey.name, () => {
    it("revokes the named key with a token for the bucket-keys scope", async () => {
      const { result, providerProxy, generateScopedProviderToken } = setup({ useHook: dependencies => useRevokeBucketKey(LEASE, dependencies) });

      result.current.mutate("app");

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      const request = providerProxy.revokeBucketKey.mock.calls[0][0];
      expect(request).toEqual(expect.objectContaining({ provider: PROVIDER, dseq: "123", name: "app" }));
      await expect(request.ensureToken()).resolves.toBe("scoped-jwt");
      expect(generateScopedProviderToken).toHaveBeenCalledWith({ provider: "akash1provider", scope: ["bucket-keys"] });
    });

    it("reloads the bucket even when the revocation fails", async () => {
      const { result, queryClient } = setup({
        revokeRejection: new Error("access key not found"),
        useHook: dependencies => useRevokeBucketKey(LEASE, dependencies)
      });

      result.current.mutate("app");

      await vi.waitFor(() => expect(result.current.isError).toBe(true));
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["BUCKET_INFO", "123", 1, 2] });
    });
  });

  describe(useConnectBucket.name, () => {
    it("hands over the bucket and a new key as variables", async () => {
      const { result, providerProxy } = setup({ useHook: dependencies => useConnectBucket(dependencies) });

      result.current.mutate({ lease: LEASE, name: "web-a1b2", access: "read" });

      await vi.waitFor(() =>
        expect(result.current.data).toEqual([
          { key: "AWS_ENDPOINT_URL_S3", value: "https://s3.provider.test", isSecret: false },
          { key: "AWS_REGION", value: "default", isSecret: false },
          { key: "S3_BUCKET", value: "assets-0123", isSecret: false },
          { key: "AWS_ACCESS_KEY_ID", value: "AKID", isSecret: true },
          { key: "AWS_SECRET_ACCESS_KEY", value: "SECRET", isSecret: true }
        ])
      );
      expect(providerProxy.createBucketKey).toHaveBeenCalledWith(
        expect.objectContaining({ provider: PROVIDER, dseq: "123", name: "web-a1b2", access: "read" })
      );
    });

    it("reads the bucket and makes the key with this deployment's tokens when the caller reaches only some projects", async () => {
      const { result, providerProxy, ensureToken } = setup({ tokenMode: "per-deployment", useHook: dependencies => useConnectBucket(dependencies) });

      result.current.mutate({ lease: LEASE, name: "web-a1b2", access: "read" });

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      await providerProxy.fetchBucketInfo.mock.calls[0][0].ensureToken();
      await providerProxy.createBucketKey.mock.calls[0][0].ensureToken();
      expect(ensureToken.mock.calls).toEqual([
        [{ access: { provider: "akash1provider", dseqs: ["123"], scope: ["bucket"] } }],
        [{ access: { provider: "akash1provider", dseqs: ["123"], scope: ["bucket-keys"] } }]
      ]);
    });

    it("reloads the bucket once connected", async () => {
      const { result, queryClient } = setup({ useHook: dependencies => useConnectBucket(dependencies) });

      result.current.mutate({ lease: LEASE, name: "web-a1b2", access: "read" });

      await vi.waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["BUCKET_INFO", "123", 1, 2] });
    });

    it("makes no key for a bucket it cannot read", async () => {
      const { result, providerProxy } = setup({
        infoRejection: new Error("no bucket for this lease"),
        useHook: dependencies => useConnectBucket(dependencies)
      });

      result.current.mutate({ lease: LEASE, name: "web-a1b2", access: "read" });

      await vi.waitFor(() => expect(result.current.isError).toBe(true));
      expect(providerProxy.createBucketKey).not.toHaveBeenCalled();
    });
  });

  function setup<T>(input: {
    useHook: (dependencies: typeof DEPENDENCIES) => T;
    tokenMode?: UseProviderCredentialsResult["tokenMode"];
    revokeRejection?: Error;
    infoRejection?: Error;
  }) {
    const providerProxy = mock<ProviderProxyService>({
      fetchBucketInfo: vi.fn(input.infoRejection ? () => Promise.reject(input.infoRejection) : () => Promise.resolve(INFO)),
      createBucketKey: vi.fn().mockResolvedValue(KEY),
      revokeBucketKey: vi.fn(input.revokeRejection ? () => Promise.reject(input.revokeRejection) : () => Promise.resolve())
    });
    const generateScopedProviderToken = vi.fn().mockResolvedValue("scoped-jwt");
    const useProviderJwtMock: typeof useProviderJwt = () => mock<ReturnType<typeof useProviderJwt>>({ generateScopedProviderToken });
    const ensureToken = vi.fn().mockResolvedValue("deployment-jwt");
    const useProviderCredentials = () => mock<UseProviderCredentialsResult>({ tokenMode: input.tokenMode ?? "shared", ensureToken });
    const queryClient = mock<QueryClient>({ invalidateQueries: vi.fn().mockResolvedValue(undefined) });
    const dependencies = { ...DEPENDENCIES, useProviderJwt: useProviderJwtMock, useProviderCredentials, useQueryClient: () => queryClient };

    const { result } = setupQuery(() => input.useHook(dependencies), { services: { providerProxy: () => providerProxy } });

    return { result, providerProxy, generateScopedProviderToken, ensureToken, queryClient };
  }
});
