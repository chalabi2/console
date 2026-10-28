import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { UseProviderCredentialsResult } from "@src/hooks/useProviderCredentials/useProviderCredentials";
import type { BucketInfo } from "@src/types/bucket";
import type { LeaseDto } from "@src/types/deployment";
import type { VolumeStatus } from "@src/types/volumeStatus";
import { BucketAccess, DEPENDENCIES } from "./BucketAccess";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockComponents } from "@tests/unit/mocks";

const PROVIDER = { owner: "akash1provider", hostUri: "https://provider.test" };
const INFO: BucketInfo = {
  bucket: "assets-0123",
  endpoint: "https://s3.provider.test",
  region: "default",
  size_bytes: 1_000_000_000,
  used_bytes: 250_000_000,
  keys: [
    { name: "app", access: "readwrite", access_key_id: "AKIDAPP" },
    { name: "backup", access: "read", access_key_id: "AKIDBACKUP" }
  ]
};

describe(BucketAccess.name, () => {
  it("reads the bucket of the lease from its provider", () => {
    const { useBucketInfo } = setup({});

    expect(useBucketInfo).toHaveBeenCalledWith({ provider: PROVIDER, dseq: "100", gseq: 1, oseq: 1 }, { enabled: true, refetchInterval: false });
  });

  it("reads where a moved bucket stands on the provider that won it", () => {
    const { useVolumeStatus } = setup({ oseq: 2 });

    expect(useVolumeStatus).toHaveBeenCalledWith({ provider: PROVIDER, dseq: "100", gseq: 1, oseq: 2 }, { enabled: true });
  });

  it("reads nothing about a move for a bucket never moved", () => {
    const { useVolumeStatus } = setup({});

    expect(useVolumeStatus).toHaveBeenCalledWith(expect.anything(), { enabled: false });
  });

  it("creates no keys while a moved bucket's objects are copied in, and says so", () => {
    setup({ info: INFO, oseq: 2, volumeStatus: { phase: "Importing", size_bytes: 1, import_from: "akash1previous" } });

    expect(screen.getByRole("button", { name: "Create access key" })).toBeDisabled();
    expect(
      screen.getByText("Its objects are being copied in from its previous provider. Access keys can be created once they have all arrived.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/while the bucket's lease is active/)).not.toBeInTheDocument();
  });

  it("reads the bucket again and again while its objects are copied in", () => {
    const { useBucketInfo } = setup({ info: INFO, oseq: 2, volumeStatus: { phase: "Importing", size_bytes: 1 } });

    expect(useBucketInfo).toHaveBeenCalledWith(expect.anything(), { enabled: true, refetchInterval: 5000 });
  });

  it("reads the bucket once more when its objects have arrived, and creates keys again", () => {
    const { refetch, showStatus } = setup({ info: INFO, oseq: 2, volumeStatus: { phase: "Importing", size_bytes: 1 } });
    expect(refetch).not.toHaveBeenCalled();

    showStatus({ phase: "Provisioned", size_bytes: 1 });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Create access key" })).toBeEnabled();
    expect(screen.queryByText(/being copied in/)).not.toBeInTheDocument();
  });

  it("reads the bucket no more often once a moved bucket's objects are all there", () => {
    const { useBucketInfo, refetch } = setup({ info: INFO, oseq: 2, volumeStatus: { phase: "Provisioned", size_bytes: 1 } });

    expect(useBucketInfo).toHaveBeenCalledWith(expect.anything(), { enabled: true, refetchInterval: false });
    expect(refetch).not.toHaveBeenCalled();
  });

  it("shows where the bucket is and how much of it is used", () => {
    const { CopyTextToClipboardButton } = setup({ info: INFO });

    expect(screen.getByText("https://s3.provider.test")).toBeInTheDocument();
    expect(screen.getByText("assets-0123")).toBeInTheDocument();
    expect(screen.getByText("default")).toBeInTheDocument();
    expect(screen.getByText("250 MB of 1 GB")).toBeInTheDocument();
    expect(CopyTextToClipboardButton.mock.calls.map(([props]) => props)).toEqual([
      expect.objectContaining({ value: "https://s3.provider.test", "aria-label": "Copy endpoint" }),
      expect.objectContaining({ value: "assets-0123", "aria-label": "Copy bucket" }),
      expect.objectContaining({ value: "default", "aria-label": "Copy region" })
    ]);
  });

  it("lists the access keys with what each may do, never a secret", () => {
    setup({ info: INFO });

    const app = screen.getByRole("row", { name: /app/ });
    expect(within(app).getByText("Read and write")).toBeInTheDocument();
    expect(within(app).getByText("AKIDAPP")).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /backup/ })).getByText("Read only")).toBeInTheDocument();
  });

  it("says when the bucket has no access keys", () => {
    setup({ info: { ...INFO, keys: [] } });

    expect(screen.getByText("No access keys yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("creates an access key in a dialog, with the names the bucket's keys took", async () => {
    const { CreateBucketKeyDialog } = setup({ info: INFO });

    expect(CreateBucketKeyDialog).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create access key" }));

    expect(CreateBucketKeyDialog.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ bucketLease: { provider: PROVIDER, dseq: "100", gseq: 1, oseq: 1 }, info: INFO, takenNames: ["app", "backup"] })
    );
  });

  it("closes the key dialog when it asks to", async () => {
    const { CreateBucketKeyDialog } = setup({ info: INFO });
    await userEvent.click(screen.getByRole("button", { name: "Create access key" }));

    act(() => CreateBucketKeyDialog.mock.lastCall?.[0].onClose());

    expect(screen.queryByRole("dialog", { name: "Create an access key" })).not.toBeInTheDocument();
  });

  it("creates no keys while the lease is not active, and says so", () => {
    setup({ info: INFO, leaseState: "reclaiming" });

    expect(screen.getByRole("button", { name: "Create access key" })).toBeDisabled();
    expect(screen.getByText(/New access keys can be created while the bucket's lease is active/)).toBeInTheDocument();
  });

  it("creates keys while the lease is active, without saying more", () => {
    setup({ info: INFO });

    expect(screen.getByRole("button", { name: "Create access key" })).toBeEnabled();
    expect(screen.queryByText(/New access keys can be created while/)).not.toBeInTheDocument();
  });

  it("revokes a key once confirmed", async () => {
    const { mutate } = setup({ info: INFO });

    await userEvent.click(screen.getByRole("button", { name: "Revoke backup" }));
    expect(screen.getByRole("dialog", { name: "Revoke backup?" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

    expect(mutate).toHaveBeenCalledWith("backup", expect.objectContaining({ onSuccess: expect.any(Function) }));
  });

  it("closes the revocation once the key is gone", async () => {
    const { mutate } = setup({ info: INFO });
    await userEvent.click(screen.getByRole("button", { name: "Revoke backup" }));
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));

    act(() => mutate.mock.lastCall?.[1]?.onSuccess?.(undefined, "backup", undefined));

    expect(screen.queryByRole("dialog", { name: "Revoke backup?" })).not.toBeInTheDocument();
  });

  it("leaves a key alone when the revocation is cancelled", async () => {
    const { mutate } = setup({ info: INFO });
    await userEvent.click(screen.getByRole("button", { name: "Revoke backup" }));

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Revoke backup?" })).not.toBeInTheDocument();
  });

  it("revokes keys while the lease is not active", async () => {
    setup({ info: INFO, leaseState: "reclaiming" });

    await userEvent.click(screen.getByRole("button", { name: "Revoke app" }));

    expect(screen.getByRole("dialog", { name: "Revoke app?" })).toBeInTheDocument();
  });

  it("says why the provider refused to revoke a key", async () => {
    setup({ info: INFO, revocation: { isError: true, error: providerError(404, "access key not found") } });

    await userEvent.click(screen.getByRole("button", { name: "Revoke app" }));

    expect(screen.getByText("Access key not found.")).toBeInTheDocument();
  });

  it("asks to retry a revocation the provider could not take", async () => {
    setup({ info: INFO, revocation: { isError: true, error: providerError(500, "bucket backend error") } });

    await userEvent.click(screen.getByRole("button", { name: "Revoke app" }));

    expect(screen.getByText("Couldn't revoke the key. Please try again.")).toBeInTheDocument();
  });

  it("holds the revocation dialog open while the key is revoked", async () => {
    setup({ info: INFO, revocation: { isPending: true } });
    await userEvent.click(screen.getByRole("button", { name: "Revoke app" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    expect(screen.getByRole("dialog", { name: "Revoke app?" })).toBeInTheDocument();
  });

  it("closes the revocation dialog on escape when nothing is pending", async () => {
    setup({ info: INFO });
    await userEvent.click(screen.getByRole("button", { name: "Revoke app" }));

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Revoke app?" })).not.toBeInTheDocument();
  });

  it("holds a placeholder while the bucket loads", () => {
    setup({});

    expect(screen.getByRole("status", { name: "Loading the bucket" })).toBeInTheDocument();
  });

  it("says the provider is still setting the bucket up, and retries", async () => {
    const { refetch } = setup({ infoError: providerError(503, "the bucket is being provisioned") });

    expect(screen.getByText("The provider is still setting this bucket up.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(refetch).toHaveBeenCalled();
  });

  it("says the provider could not be reached", () => {
    setup({ infoError: new Error("Network Error") });

    expect(screen.getByText("Couldn't reach this bucket's provider.")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading the bucket" })).not.toBeInTheDocument();
  });

  it.each(["view-only", "read-only"] as const)("tells a %s role it cannot use the bucket, and reads nothing", tokenMode => {
    const { useBucketInfo, useVolumeStatus } = setup({ info: INFO, tokenMode, oseq: 2 });

    expect(screen.getByText("Your role cannot see or change this bucket's access keys.")).toBeInTheDocument();
    expect(useBucketInfo).toHaveBeenCalledWith(expect.anything(), { enabled: false, refetchInterval: false });
    expect(useVolumeStatus).toHaveBeenCalledWith(expect.anything(), { enabled: false });
    expect(screen.queryByText("assets-0123")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading the bucket" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't reach/)).not.toBeInTheDocument();
  });

  it("shows a role that cannot use the bucket no provider error either", () => {
    setup({ infoError: new Error("Network Error"), tokenMode: "view-only" });

    expect(screen.queryByText(/Couldn't reach/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  function setup(input: {
    info?: BucketInfo;
    infoError?: Error;
    leaseState?: string;
    oseq?: number;
    volumeStatus?: VolumeStatus;
    tokenMode?: UseProviderCredentialsResult["tokenMode"];
    revocation?: { isPending?: boolean; isError?: boolean; error?: Error };
  }) {
    const refetch = vi.fn();
    const infoState = input.infoError
      ? { isError: true as const, error: input.infoError, data: undefined }
      : input.info
        ? { isError: false as const, data: input.info }
        : { isError: false as const, data: undefined };
    const useBucketInfo = vi.fn<typeof DEPENDENCIES.useBucketInfo>(() => mock<UseQueryResult<BucketInfo, Error>>({ ...infoState, refetch }));
    const mutate = vi.fn<UseMutationResult<void, Error, string>["mutate"]>();
    const revocationState = input.revocation?.isPending
      ? { isPending: true as const }
      : input.revocation?.isError
        ? { isError: true as const, error: input.revocation.error }
        : { isPending: false as const, isError: false as const };
    const useRevokeBucketKey = vi.fn<typeof DEPENDENCIES.useRevokeBucketKey>(() =>
      mock<UseMutationResult<void, Error, string>>({ mutate, ...revocationState })
    );
    const useProviderCredentials = () => mock<UseProviderCredentialsResult>({ tokenMode: input.tokenMode ?? "shared" });
    let volumeStatus = input.volumeStatus;
    const useVolumeStatus = vi.fn((..._args: Parameters<typeof DEPENDENCIES.useVolumeStatus>) =>
      mock<UseQueryResult<VolumeStatus, Error>>({ data: volumeStatus })
    );
    const CreateBucketKeyDialog = vi.fn<typeof DEPENDENCIES.CreateBucketKeyDialog>(() => <div role="dialog" aria-label="Create an access key" />);
    const dependencies = MockComponents(DEPENDENCIES, {
      useBucketInfo,
      useRevokeBucketKey,
      useProviderCredentials,
      useVolumeStatus: useVolumeStatus as typeof DEPENDENCIES.useVolumeStatus,
      CreateBucketKeyDialog
    });
    const lease = mock<LeaseDto>({ dseq: "100", gseq: 1, oseq: input.oseq ?? 1, state: input.leaseState ?? "active" });

    const view = render(<BucketAccess lease={lease} provider={PROVIDER} dependencies={dependencies} />);

    const showStatus = (next: VolumeStatus) => {
      volumeStatus = next;
      view.rerender(<BucketAccess lease={lease} provider={PROVIDER} dependencies={dependencies} />);
    };

    return {
      useBucketInfo,
      useVolumeStatus,
      refetch,
      mutate,
      showStatus,
      CreateBucketKeyDialog,
      CopyTextToClipboardButton: dependencies.CopyTextToClipboardButton
    };
  }

  function providerError(status: number, data: string) {
    return new AxiosError("Request failed", String(status), undefined, undefined, {
      status,
      statusText: "",
      data,
      headers: {},
      config: { headers: new AxiosHeaders() }
    });
  }
});
