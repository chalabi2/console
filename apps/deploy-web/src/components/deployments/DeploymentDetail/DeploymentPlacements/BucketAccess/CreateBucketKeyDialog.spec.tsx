import type { UseMutationResult } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { BucketKey, BucketKeyAccess } from "@src/types/bucket";
import { CreateBucketKeyDialog, DEPENDENCIES } from "./CreateBucketKeyDialog";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockComponents } from "@tests/unit/mocks";

const BUCKET_LEASE = { provider: { owner: "akash1provider", hostUri: "https://provider.test" }, dseq: "100", gseq: 1, oseq: 1 };
const INFO = { endpoint: "https://s3.provider.test", region: "default", bucket: "assets-0123" };
const KEY: BucketKey = { name: "app", access: "readwrite", access_key_id: "AKIDAPP", secret_access_key: "SECRETAPP" };

type KeyMutation = UseMutationResult<BucketKey, Error, { name: string; access: BucketKeyAccess }>;

describe(CreateBucketKeyDialog.name, () => {
  it("creates a key for the bucket's lease", () => {
    const { useCreateBucketKey } = setup({});

    expect(useCreateBucketKey).toHaveBeenCalledWith(BUCKET_LEASE);
  });

  it("creates a read and write key with the name given", async () => {
    const { mutate } = setup({});

    await userEvent.type(screen.getByLabelText("Key name"), "app");
    await userEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(mutate).toHaveBeenCalledWith({ name: "app", access: "readwrite" });
  });

  it("creates a read-only key when chosen", async () => {
    const { mutate } = setup({});

    await userEvent.type(screen.getByLabelText("Key name"), "reader");
    await userEvent.click(screen.getByRole("radio", { name: /Read only/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(mutate).toHaveBeenCalledWith({ name: "reader", access: "read" });
  });

  it("goes back to read and write when chosen again", async () => {
    const { mutate } = setup({});

    await userEvent.type(screen.getByLabelText("Key name"), "app");
    await userEvent.click(screen.getByRole("radio", { name: /Read only/ }));
    await userEvent.click(screen.getByRole("radio", { name: /Read and write/ }));
    await userEvent.click(screen.getByRole("button", { name: "Create key" }));

    expect(mutate).toHaveBeenCalledWith({ name: "app", access: "readwrite" });
  });

  it("creates nothing without a name, and says nothing about it", () => {
    setup({});

    expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("describes why each deployment gets its own key", () => {
    setup({});

    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(
      "Give each deployment or tool its own key, so you can revoke one without touching the others."
    );
  });

  it("focuses the name from its label", async () => {
    setup({});

    await userEvent.click(screen.getByText("Name"));

    expect(screen.getByLabelText("Key name")).toHaveFocus();
  });

  it("refuses a name the provider would", async () => {
    setup({});

    await userEvent.type(screen.getByLabelText("Key name"), "App_1");

    expect(screen.getByRole("alert")).toHaveTextContent("Use up to 32 lowercase letters, digits and dashes, starting and ending with a letter or digit.");
    expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
  });

  it("refuses a name another key of the bucket took", async () => {
    setup({ takenNames: ["app"] });

    await userEvent.type(screen.getByLabelText("Key name"), "app");

    expect(screen.getByText("This bucket already has a key named app.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create key" })).toBeDisabled();
  });

  it("says why the provider refused the key", () => {
    setup({ mutation: { isError: true, error: providerError(409, "an access key with this name exists") } });

    expect(screen.getByText("An access key with this name exists.")).toBeInTheDocument();
  });

  it("asks to retry a key the provider could not create", () => {
    setup({ mutation: { isError: true, error: new Error("Network Error") } });

    expect(screen.getByText("Couldn't create the key. Please try again.")).toBeInTheDocument();
  });

  it("holds every field while the key is created", () => {
    setup({ mutation: { isPending: true } });

    expect(screen.getByLabelText("Key name")).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Read only/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("stays open when dismissed while the key is created", async () => {
    const { onClose } = setup({ mutation: { isPending: true } });

    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when dismissed", async () => {
    const { onClose } = setup({});

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on cancel", async () => {
    const { onClose } = setup({});

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
  });

  it("shows the new key with its secret, which the provider never shows again", () => {
    const { CopyTextToClipboardButton } = setup({ mutation: { data: KEY } });

    expect(screen.getByRole("heading", { name: "Access key app created" })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription("Copy the secret access key now. The provider never shows it again.");
    expect(screen.getByText("AKIDAPP")).toBeInTheDocument();
    expect(screen.getByText("SECRETAPP")).toBeInTheDocument();
    expect(CopyTextToClipboardButton.mock.calls.map(([props]) => props)).toEqual([
      expect.objectContaining({ value: "AKIDAPP", "aria-label": "Copy access key id" }),
      expect.objectContaining({ value: "SECRETAPP", "aria-label": "Copy secret access key" })
    ]);
  });

  it("gives the new key as a deployment's environment variables", () => {
    const { CodeSnippet } = setup({ mutation: { data: KEY } });

    expect(CodeSnippet.mock.lastCall?.[0]).toEqual({
      code: [
        "AWS_ENDPOINT_URL_S3=https://s3.provider.test",
        "AWS_REGION=default",
        "S3_BUCKET=assets-0123",
        "AWS_ACCESS_KEY_ID=AKIDAPP",
        "AWS_SECRET_ACCESS_KEY=SECRETAPP"
      ].join("\n")
    });
  });

  it("closes once the new key is copied", async () => {
    const { onClose } = setup({ mutation: { data: KEY } });

    await userEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onClose).toHaveBeenCalled();
  });

  function setup(input: { takenNames?: string[]; mutation?: { isPending?: boolean; isError?: boolean; error?: Error; data?: BucketKey } }) {
    const mutate = vi.fn<KeyMutation["mutate"]>();
    const state = input.mutation?.data
      ? { isSuccess: true as const, data: input.mutation.data }
      : input.mutation?.isPending
        ? { isPending: true as const, data: undefined }
        : input.mutation?.isError
          ? { isError: true as const, error: input.mutation.error, data: undefined }
          : { isPending: false as const, isError: false as const, data: undefined };
    const useCreateBucketKey = vi.fn<typeof DEPENDENCIES.useCreateBucketKey>(() => mock<KeyMutation>({ mutate, ...state }));
    const onClose = vi.fn();
    const dependencies = MockComponents(DEPENDENCIES, { useCreateBucketKey });

    render(<CreateBucketKeyDialog bucketLease={BUCKET_LEASE} info={INFO} takenNames={input.takenNames ?? []} onClose={onClose} dependencies={dependencies} />);

    return { mutate, onClose, useCreateBucketKey, CodeSnippet: dependencies.CodeSnippet, CopyTextToClipboardButton: dependencies.CopyTextToClipboardButton };
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
