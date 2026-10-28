import { ApiError } from "@akashnetwork/openapi-sdk";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import type { VolumeOrderBid } from "@src/queries/useVolumeMoveQueries";
import type { ApiProviderList } from "@src/types/provider";
import { PRICE_DISPLAY_PRECISION, udenomToDenom } from "@src/utils/mathHelpers";
import { ChooseVolumeProviderDialog, DEPENDENCIES } from "./ChooseVolumeProviderDialog";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockComponents } from "@tests/unit/mocks";

const VOLUME: OwnedVolume = {
  name: "pgdata",
  owner: "akash1owner",
  dseq: "100",
  sizeBytes: 1_073_741_824,
  storageClass: "beta3",
  access: "mount",
  state: "unleased"
};
const MERIDIAN: VolumeOrderBid = { provider: "akash1meridian", gseq: 1, oseq: 2, perBlockAmount: "1.5", denom: "uact" };
const NORTHWIND: VolumeOrderBid = { provider: "akash1northwind", gseq: 1, oseq: 2, perBlockAmount: "2", denom: "uact" };

type LeaseMutation = ReturnType<typeof DEPENDENCIES.useLeaseVolume>;

describe(ChooseVolumeProviderDialog.name, () => {
  it("reads the bids on the volume's order", () => {
    const { useVolumeBids } = setup({});

    expect(useVolumeBids).toHaveBeenCalledWith("100");
  });

  it("offers each bidding provider by name and region, with its price", () => {
    const { PricePerTimeUnit } = setup({
      bids: [MERIDIAN, NORTHWIND],
      providers: [
        mock<ApiProviderList>({
          owner: "akash1meridian",
          organization: "Meridian Cloud",
          hostUri: "https://m.example",
          attributes: [],
          locationRegion: "us-west"
        })
      ]
    });

    expect(screen.getByRole("radio", { name: /Meridian Cloud/ })).toBeInTheDocument();
    expect(screen.getByText("us-west")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /akash1northwind/ })).toBeInTheDocument();
    expect(screen.getByText("Region unknown")).toBeInTheDocument();
    expect(PricePerTimeUnit.mock.calls[0][0]).toEqual(expect.objectContaining({ perBlockValue: udenomToDenom("1.5", PRICE_DISPLAY_PRECISION), denom: "uact" }));
  });

  it("looks up the bidding providers", () => {
    const { useProvidersByAddresses } = setup({ bids: [MERIDIAN, NORTHWIND] });

    expect(useProvidersByAddresses).toHaveBeenCalledWith(["akash1meridian", "akash1northwind"]);
  });

  it("leases the volume from the provider chosen, on the order it bid on", async () => {
    const { mutate } = setup({ bids: [MERIDIAN, NORTHWIND] });

    await userEvent.click(screen.getByRole("radio", { name: /akash1northwind/ }));
    await userEvent.click(screen.getByRole("button", { name: "Lease volume" }));

    expect(mutate).toHaveBeenCalledWith({ leases: [{ dseq: "100", gseq: 1, oseq: 2, provider: "akash1northwind" }] }, expect.anything());
  });

  it("closes once the volume is leased", async () => {
    const { mutate, onClose } = setup({ bids: [MERIDIAN] });
    await userEvent.click(screen.getByRole("radio", { name: /akash1meridian/ }));
    await userEvent.click(screen.getByRole("button", { name: "Lease volume" }));

    mutate.mock.lastCall?.[1]?.onSuccess?.(mock(), mock(), undefined);

    expect(onClose).toHaveBeenCalled();
  });

  it("leases nothing before a provider is chosen", () => {
    setup({ bids: [MERIDIAN] });

    expect(screen.getByRole("radio", { name: /akash1meridian/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Lease volume" })).toBeDisabled();
  });

  it("waits for bids while there are none, without a hint at first", () => {
    const { useHasWaited } = setup({});

    expect(screen.getByText("Waiting for providers to bid…")).toBeInTheDocument();
    expect(screen.queryByText(/No provider has bid yet/)).not.toBeInTheDocument();
    expect(useHasWaited).toHaveBeenCalledWith(true, 30_000);
  });

  it("explains a long wait for bids", () => {
    setup({ hasWaited: true });

    expect(
      screen.getByText("No provider has bid yet. Providers cap how large a volume they take and how long they keep its data after it closes.")
    ).toBeInTheDocument();
  });

  it("stops waiting once a provider bids", () => {
    const { useHasWaited } = setup({ bids: [MERIDIAN] });

    expect(screen.queryByText("Waiting for providers to bid…")).not.toBeInTheDocument();
    expect(useHasWaited).toHaveBeenCalledWith(false, 30_000);
  });

  it("explains where the data comes from", () => {
    setup({});

    expect(screen.getByRole("dialog", { name: "Choose a provider for pgdata" })).toHaveAccessibleDescription(
      "Its last lease has ended. The provider you lease it from now copies its data from the previous one before anything can mount it, and deployments that mount it run there."
    );
  });

  it("explains where a bucket's objects come from, and its new keys", () => {
    setup({ volume: { ...VOLUME, name: "media", access: "bucket" } });

    expect(screen.getByRole("dialog", { name: "Choose a provider for media" })).toHaveAccessibleDescription(
      "Its last lease has ended. The provider you lease it from now copies its objects from the previous one, then gives out new access keys from the bucket's page."
    );
  });

  it("leases a bucket from the provider chosen", async () => {
    const { mutate } = setup({ volume: { ...VOLUME, access: "bucket" }, bids: [MERIDIAN] });

    await userEvent.click(screen.getByRole("radio", { name: /akash1meridian/ }));
    await userEvent.click(screen.getByRole("button", { name: "Lease bucket" }));

    expect(mutate).toHaveBeenCalledWith({ leases: [{ dseq: "100", gseq: 1, oseq: 2, provider: "akash1meridian" }] }, expect.anything());
  });

  it("says why the lease was refused", () => {
    setup({ mutation: { isError: true, error: new ApiError(502, { message: "The provider could not be reached" }, "POST → 502") } });

    expect(screen.getByText("The provider could not be reached")).toBeInTheDocument();
  });

  it("suggests another provider when the lease failed for no stated reason", () => {
    setup({ mutation: { isError: true, error: new Error("Network Error") } });

    expect(screen.getByText("The volume could not be leased from this provider. Choose another or try again.")).toBeInTheDocument();
  });

  it("holds the dialog while the volume is leased", async () => {
    const { onClose } = setup({ bids: [MERIDIAN], mutation: { isPending: true } });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes when dismissed", async () => {
    const { onClose } = setup({});

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("closes on cancel, leasing nothing", async () => {
    const { onClose, mutate } = setup({ bids: [MERIDIAN] });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  function setup(input: {
    volume?: OwnedVolume;
    bids?: VolumeOrderBid[];
    providers?: ApiProviderList[];
    hasWaited?: boolean;
    mutation?: { isPending?: boolean; isError?: boolean; error?: Error };
  }) {
    const mutate = vi.fn<LeaseMutation["mutate"]>();
    const state = input.mutation?.isPending
      ? { isPending: true as const }
      : input.mutation?.isError
        ? { isError: true as const, error: input.mutation.error }
        : { isPending: false as const, isError: false as const };
    const useVolumeBids = vi.fn((_dseq: string) => input.bids ?? []);
    const useLeaseVolume = vi.fn<typeof DEPENDENCIES.useLeaseVolume>(() => mock<LeaseMutation>({ mutate, ...state }));
    const useProvidersByAddresses = vi.fn((_addresses: readonly string[]) =>
      mock<ReturnType<typeof DEPENDENCIES.useProvidersByAddresses>>({ data: input.providers ?? [] })
    );
    const useHasWaited = vi.fn((_waiting: boolean, _delay: number) => !!input.hasWaited);
    const onClose = vi.fn();
    const dependencies = MockComponents(DEPENDENCIES, {
      useVolumeBids: useVolumeBids as typeof DEPENDENCIES.useVolumeBids,
      useLeaseVolume,
      useProvidersByAddresses: useProvidersByAddresses as typeof DEPENDENCIES.useProvidersByAddresses,
      useHasWaited
    });

    render(<ChooseVolumeProviderDialog volume={input.volume ?? VOLUME} onClose={onClose} dependencies={dependencies} />);

    return { mutate, onClose, useVolumeBids, useProvidersByAddresses, useHasWaited, PricePerTimeUnit: dependencies.PricePerTimeUnit };
  }
});
