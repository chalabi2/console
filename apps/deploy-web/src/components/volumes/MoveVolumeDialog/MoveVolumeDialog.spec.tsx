import { ApiError } from "@akashnetwork/openapi-sdk";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import { DEPENDENCIES, MoveVolumeDialog } from "./MoveVolumeDialog";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const VOLUME: OwnedVolume = {
  name: "pgdata",
  owner: "akash1owner",
  dseq: "100",
  sizeBytes: 1_073_741_824,
  storageClass: "beta3",
  access: "mount",
  state: "available",
  provider: "akash1provider"
};

type MoveMutation = ReturnType<typeof DEPENDENCIES.useMoveVolume>;

describe(MoveVolumeDialog.name, () => {
  it("starts the move of the volume it names", async () => {
    const { mutate } = setup({});

    await userEvent.click(screen.getByRole("button", { name: "Move volume" }));

    expect(mutate).toHaveBeenCalledWith({ dseq: "100" }, expect.anything());
  });

  it("closes once the move started", async () => {
    const { mutate, onClose } = setup({});
    await userEvent.click(screen.getByRole("button", { name: "Move volume" }));

    mutate.mock.lastCall?.[1]?.onSuccess?.(mock(), { dseq: "100" }, undefined);

    expect(onClose).toHaveBeenCalled();
  });

  it("explains the move, naming the provider the volume leaves", () => {
    setup({});

    expect(screen.getByRole("dialog", { name: "Move pgdata to another provider" })).toHaveAccessibleDescription(
      "Its lease with Meridian Cloud ends after its reclamation window. Providers then bid to take it: choose one here, and it copies the volume's data from Meridian Cloud before anything can mount it."
    );
  });

  it("warns that the deployment mounting the volume stops when its lease ends", () => {
    setup({ volume: { ...VOLUME, state: "mounted", mountedBy: "200" } });

    expect(
      screen.getByText(
        "Deployment 200 mounts it. It keeps running until the lease ends and then stops, so deploy it again on the new provider once the move is done."
      )
    ).toBeInTheDocument();
  });

  it("warns of no deployment for a volume nothing mounts", () => {
    setup({});

    expect(screen.queryByText(/mounts it/)).not.toBeInTheDocument();
  });

  it("says why the move was refused", () => {
    setup({ mutation: { isError: true, error: new ApiError(409, { message: "This volume has no active lease to move" }, "POST → 409") } });

    expect(screen.getByText("This volume has no active lease to move")).toBeInTheDocument();
  });

  it("asks to retry a move that failed for no stated reason", () => {
    setup({ mutation: { isError: true, error: new Error("Network Error") } });

    expect(screen.getByText("Couldn't start the move. Please try again.")).toBeInTheDocument();
  });

  it("holds the dialog while the move starts", async () => {
    const { onClose } = setup({ mutation: { isPending: true } });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when dismissed", async () => {
    const { onClose } = setup({});

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on cancel, starting nothing", async () => {
    const { onClose, mutate } = setup({});

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  function setup(input: { volume?: OwnedVolume; mutation?: { isPending?: boolean; isError?: boolean; error?: Error } }) {
    const mutate = vi.fn<MoveMutation["mutate"]>();
    const state = input.mutation?.isPending
      ? { isPending: true as const }
      : input.mutation?.isError
        ? { isError: true as const, error: input.mutation.error }
        : { isPending: false as const, isError: false as const };
    const useMoveVolume = vi.fn<typeof DEPENDENCIES.useMoveVolume>(() => mock<MoveMutation>({ mutate, ...state }));
    const onClose = vi.fn();

    render(
      <MoveVolumeDialog volume={input.volume ?? VOLUME} providerName="Meridian Cloud" onClose={onClose} dependencies={{ ...DEPENDENCIES, useMoveVolume }} />
    );

    return { mutate, onClose };
  }
});
