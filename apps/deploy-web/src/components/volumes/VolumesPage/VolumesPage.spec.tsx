import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import type { ApiProviderList } from "@src/types/provider";
import type { VolumeStatus } from "@src/types/volumeStatus";
import { PRICE_DISPLAY_PRECISION, udenomToDenom } from "@src/utils/mathHelpers";
import { DEPENDENCIES, VolumesPage } from "./VolumesPage";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MockComponents } from "@tests/unit/mocks";

const OWNER = "akash1owner";
const PROVIDER = "akash1provider";
const DEADLINE = new Date("2026-10-27T20:00:00Z");
const AVAILABLE: OwnedVolume = {
  name: "data",
  owner: OWNER,
  dseq: "100",
  sizeBytes: 1_073_741_824,
  storageClass: "beta3",
  access: "mount",
  state: "available",
  provider: PROVIDER,
  pricePerBlock: { denom: "uact", amount: "1.5" }
};

describe(VolumesPage.name, () => {
  it("lists a volume with its name, dseq, size, type, provider and monthly cost", () => {
    const { PricePerTimeUnit } = setup({
      volumes: [AVAILABLE],
      providers: [mock<ApiProviderList>({ owner: PROVIDER, organization: "Meridian Cloud", hostUri: "https://p.example:8443" })]
    });

    const row = screen.getByRole("row", { name: /data/ });
    expect(within(row).getByRole("link", { name: "data" })).toHaveAttribute("href", "/deployments/100");
    expect(within(row).getByText("100")).toBeInTheDocument();
    expect(within(row).getByText("1.07 GB · NVMe")).toBeInTheDocument();
    expect(within(row).getByText("Meridian Cloud")).toBeInTheDocument();
    expect(within(row).getByText("Available")).toBeInTheDocument();
    expect(PricePerTimeUnit.mock.calls[0][0]).toEqual(expect.objectContaining({ perBlockValue: udenomToDenom("1.5", PRICE_DISPLAY_PRECISION), denom: "uact" }));
  });

  it("marks a bucket as an S3 bucket", () => {
    setup({ volumes: [{ ...AVAILABLE, access: "bucket" }] });

    expect(within(screen.getByRole("row", { name: /data/ })).getByText("S3 bucket")).toBeInTheDocument();
  });

  it("marks no disk as a bucket", () => {
    setup({ volumes: [AVAILABLE] });

    expect(screen.queryByText("S3 bucket")).not.toBeInTheDocument();
  });

  it("looks up the providers holding the volumes, skipping a volume no lease holds", () => {
    const { useProvidersByAddresses } = setup({ volumes: [AVAILABLE, { ...AVAILABLE, dseq: "101", state: "unleased", provider: undefined }] });

    expect(useProvidersByAddresses).toHaveBeenCalledWith([PROVIDER]);
  });

  it("names a provider by its address until its details load", () => {
    setup({ volumes: [AVAILABLE] });

    expect(screen.getByText(PROVIDER)).toBeInTheDocument();
  });

  it.each([
    { case: "a class the console has no name for", storageClass: "beta9" },
    { case: "no class", storageClass: undefined }
  ])("gives just the size of a volume with $case", ({ storageClass }) => {
    setup({ volumes: [{ ...AVAILABLE, storageClass }] });

    expect(screen.getByText("1.07 GB")).toBeInTheDocument();
  });

  it("names the deployment that mounts a mounted volume", () => {
    setup({ volumes: [{ ...AVAILABLE, state: "mounted", mountedBy: "200" }] });

    expect(screen.getByText("Mounted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "by deployment 200" })).toHaveAttribute("href", "/deployments/200");
  });

  it("counts down to the reclamation deadline of each closing volume", () => {
    const { useCountdown } = setup({ volumes: [{ ...AVAILABLE, state: "closing", reclamationDeadline: DEADLINE }], countdown: "12 seconds" });

    expect(useCountdown).toHaveBeenCalledWith(DEADLINE);
    expect(screen.getByText("Closing")).toBeInTheDocument();
    expect(screen.getByText("Finishes closing in 12 seconds")).toBeInTheDocument();
  });

  it("reads a closing volume past its deadline as finishing now", () => {
    setup({ volumes: [{ ...AVAILABLE, state: "closing" }] });

    expect(screen.getByText("Finishing closing now")).toBeInTheDocument();
  });

  it("counts no deadline down for a volume without one", () => {
    const { useCountdown } = setup({ volumes: [AVAILABLE] });

    expect(useCountdown).toHaveBeenCalledWith(null);
  });

  it.each([
    { case: "with its lease's time left", countdown: "1 day", text: "Lease ends in 1 day" },
    { case: "past its deadline", countdown: null, text: "Lease ending now" }
  ])("marks a volume the chain is reclaiming, $case", ({ countdown, text }) => {
    setup({ volumes: [{ ...AVAILABLE, state: "reclaiming", reclamationDeadline: DEADLINE }], countdown });

    expect(screen.getByText("Reclaiming")).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("marks a volume no lease holds as not leased, with no cost", () => {
    const { PricePerTimeUnit } = setup({ volumes: [{ ...AVAILABLE, state: "unleased", provider: undefined, pricePerBlock: undefined }] });

    expect(screen.getByText("Not leased")).toBeInTheDocument();
    expect(PricePerTimeUnit).not.toHaveBeenCalled();
  });

  it("offers to move a disk its lease holds", async () => {
    const { MoveVolumeDialog } = setup({
      volumes: [AVAILABLE],
      providers: [mock<ApiProviderList>({ owner: PROVIDER, organization: "Meridian Cloud", hostUri: "https://p.example:8443" })]
    });

    await userEvent.click(screen.getByRole("button", { name: "Move data" }));

    expect(MoveVolumeDialog.mock.lastCall?.[0]).toEqual(expect.objectContaining({ volume: AVAILABLE, providerName: "Meridian Cloud" }));
  });

  it("offers to move a disk a deployment mounts", () => {
    setup({ volumes: [{ ...AVAILABLE, state: "mounted", mountedBy: "200" }] });

    expect(screen.getByRole("button", { name: "Move data" })).toBeInTheDocument();
  });

  it("names the provider a disk moves from by its address until its details load", async () => {
    const { MoveVolumeDialog } = setup({
      volumes: [AVAILABLE],
      providers: [mock<ApiProviderList>({ owner: "akash1someoneelse", organization: "Northwind", hostUri: "https://n.example" })]
    });

    await userEvent.click(screen.getByRole("button", { name: "Move data" }));

    expect(MoveVolumeDialog.mock.lastCall?.[0].providerName).toBe(PROVIDER);
  });

  it("closes the move dialog when it asks to", async () => {
    const { MoveVolumeDialog } = setup({ volumes: [AVAILABLE] });
    await userEvent.click(screen.getByRole("button", { name: "Move data" }));

    act(() => MoveVolumeDialog.mock.lastCall?.[0].onClose());

    expect(screen.queryByRole("dialog", { name: "Move a volume" })).not.toBeInTheDocument();
  });

  it("offers to move a bucket its lease holds", async () => {
    const bucket: OwnedVolume = { ...AVAILABLE, access: "bucket" };
    const { MoveVolumeDialog } = setup({ volumes: [bucket] });

    await userEvent.click(screen.getByRole("button", { name: "Move data" }));

    expect(MoveVolumeDialog.mock.lastCall?.[0]).toEqual(expect.objectContaining({ volume: bucket }));
  });

  it.each([
    { case: "a closing volume", volume: { ...AVAILABLE, state: "closing" as const } },
    { case: "a volume already moving", volume: { ...AVAILABLE, state: "moving" as const } },
    { case: "a volume its provider is reclaiming", volume: { ...AVAILABLE, state: "reclaiming" as const } },
    { case: "a volume no lease holds", volume: { ...AVAILABLE, state: "unleased" as const } }
  ])("offers no move for $case", ({ volume }) => {
    setup({ volumes: [volume] });

    expect(screen.queryByRole("button", { name: "Move data" })).not.toBeInTheDocument();
  });

  it.each([
    { case: "with time left in its window", countdown: "2 minutes", text: "Providers bid in 2 minutes" },
    { case: "past its window", countdown: null, text: "Providers bid now" }
  ])("marks a volume being moved, $case", ({ countdown, text }) => {
    const { useCountdown } = setup({ volumes: [{ ...AVAILABLE, state: "moving", reclamationDeadline: DEADLINE }], countdown });

    expect(useCountdown).toHaveBeenCalledWith(DEADLINE);
    expect(screen.getByText("Moving")).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("offers to choose a provider for a disk no lease holds", async () => {
    const unleased: OwnedVolume = { ...AVAILABLE, state: "unleased", provider: undefined, pricePerBlock: undefined };
    const { ChooseVolumeProviderDialog } = setup({ volumes: [unleased] });

    await userEvent.click(screen.getByRole("button", { name: "Choose a provider for data" }));

    expect(ChooseVolumeProviderDialog.mock.lastCall?.[0]).toEqual(expect.objectContaining({ volume: unleased }));
  });

  it("closes the provider dialog when it asks to", async () => {
    const { ChooseVolumeProviderDialog } = setup({ volumes: [{ ...AVAILABLE, state: "unleased", provider: undefined }] });
    await userEvent.click(screen.getByRole("button", { name: "Choose a provider for data" }));

    act(() => ChooseVolumeProviderDialog.mock.lastCall?.[0].onClose());

    expect(screen.queryByRole("dialog", { name: "Choose a provider" })).not.toBeInTheDocument();
  });

  it("offers to choose a provider for a bucket no lease holds", async () => {
    const unleased: OwnedVolume = { ...AVAILABLE, access: "bucket", state: "unleased", provider: undefined, pricePerBlock: undefined };
    const { ChooseVolumeProviderDialog } = setup({ volumes: [unleased] });

    await userEvent.click(screen.getByRole("button", { name: "Choose a provider for data" }));

    expect(ChooseVolumeProviderDialog.mock.lastCall?.[0]).toEqual(expect.objectContaining({ volume: unleased }));
  });

  it("offers no provider choice for a volume its lease holds", () => {
    setup({ volumes: [AVAILABLE] });

    expect(screen.queryByRole("button", { name: "Choose a provider for data" })).not.toBeInTheDocument();
  });

  it("reads where a moved disk stands on the provider that won it", () => {
    const provider = mock<ApiProviderList>({ owner: PROVIDER, organization: "Meridian Cloud", hostUri: "https://p.example:8443" });
    const { useVolumeStatus } = setup({ volumes: [{ ...AVAILABLE, gseq: 3, oseq: 2 }], providers: [provider] });

    expect(useVolumeStatus).toHaveBeenCalledWith(
      { provider: { owner: PROVIDER, hostUri: "https://p.example:8443" }, dseq: "100", gseq: 3, oseq: 2 },
      { enabled: true }
    );
  });

  it("reads where a moved bucket stands on the provider that won it", () => {
    const { useVolumeStatus } = setup({ volumes: [{ ...AVAILABLE, access: "bucket", gseq: 1, oseq: 2 }] });

    expect(useVolumeStatus).toHaveBeenCalledWith(expect.objectContaining({ dseq: "100", gseq: 1, oseq: 2 }), { enabled: true });
  });

  it.each([
    { case: "a disk never moved", volume: { ...AVAILABLE, gseq: 1, oseq: 1 } },
    { case: "a disk whose lease sequence is unknown", volume: AVAILABLE },
    { case: "a moved disk being moved again", volume: { ...AVAILABLE, state: "moving" as const, gseq: 1, oseq: 2 } }
  ])("reads nothing from the provider for $case", ({ volume }) => {
    const { useVolumeStatus } = setup({ volumes: [volume] });

    expect(useVolumeStatus).toHaveBeenCalledWith(expect.anything(), { enabled: false });
  });

  it("asks a lookup with no provider while the provider's details load", () => {
    const { useVolumeStatus } = setup({ volumes: [{ ...AVAILABLE, gseq: 1, oseq: 2 }] });

    expect(useVolumeStatus.mock.lastCall?.[0].provider).toBeUndefined();
  });

  it("shows a moved disk as copying in while its data arrives, and offers no move", () => {
    setup({ volumes: [{ ...AVAILABLE, gseq: 1, oseq: 2 }], volumeStatus: { phase: "Importing", size_bytes: 1, import_from: "akash1previous" } });

    expect(screen.getByText("Copying in")).toBeInTheDocument();
    expect(screen.getByText("From its previous provider")).toBeInTheDocument();
    expect(screen.queryByText("Available")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move data" })).not.toBeInTheDocument();
  });

  it("shows a moved bucket as copying in while its objects arrive, and offers no move", () => {
    setup({
      volumes: [{ ...AVAILABLE, access: "bucket", gseq: 1, oseq: 2 }],
      volumeStatus: { phase: "Importing", size_bytes: 1, import_from: "akash1previous" }
    });

    expect(screen.getByText("Copying in")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move data" })).not.toBeInTheDocument();
  });

  it("shows a moved disk as available once its data arrived", () => {
    setup({ volumes: [{ ...AVAILABLE, gseq: 1, oseq: 2 }], volumeStatus: { phase: "Provisioned", size_bytes: 1 } });

    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.queryByText("Copying in")).not.toBeInTheDocument();
  });

  it("holds placeholder rows while the volumes load", () => {
    setup({ isLoading: true });

    expect(screen.getAllByTestId("volume-placeholder")).toHaveLength(3);
    expect(screen.queryByText("No volumes yet")).not.toBeInTheDocument();
  });

  it("tells the layout the page is loading", () => {
    const { Layout } = setup({ isLoading: true });

    expect(Layout.mock.calls[0][0]).toEqual(expect.objectContaining({ isLoading: true }));
  });

  it("offers to create the first volume when there are none", async () => {
    const { CreateVolumeDialog } = setup({ volumes: [] });

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(within(screen.getByText("No volumes yet").parentElement as HTMLElement).getByRole("button", { name: "Create volume" }));

    expect(CreateVolumeDialog).toHaveBeenCalled();
  });

  it("offers to retry when the volumes could not be loaded", async () => {
    const { refetch } = setup({ isError: true, volumes: [] });

    expect(screen.queryByText("No volumes yet")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(refetch).toHaveBeenCalled();
  });

  it("creates a volume on its own, with the names the wallet's volumes already took", async () => {
    const { CreateVolumeDialog } = setup({ volumes: [AVAILABLE] });

    expect(CreateVolumeDialog).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Create volume" }));

    expect(CreateVolumeDialog.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ open: true, takenNames: ["data"], placement: expect.objectContaining({ name: "dcloud" }), offersBuckets: true })
    );
  });

  it("reloads the volumes once one is created", async () => {
    const { CreateVolumeDialog, refetch } = setup({ volumes: [AVAILABLE] });
    await userEvent.click(screen.getByRole("button", { name: "Create volume" }));

    act(() => CreateVolumeDialog.mock.lastCall?.[0].onCreated({ name: "logs", owner: OWNER, dseq: "102" }));

    expect(refetch).toHaveBeenCalled();
  });

  it("closes the create dialog when it asks to", async () => {
    const { CreateVolumeDialog } = setup({ volumes: [AVAILABLE] });
    await userEvent.click(screen.getByRole("button", { name: "Create volume" }));
    expect(screen.getByRole("dialog", { name: "Create a volume" })).toBeInTheDocument();

    act(() => CreateVolumeDialog.mock.lastCall?.[0].onOpenChange(false));

    expect(screen.queryByRole("dialog", { name: "Create a volume" })).not.toBeInTheDocument();
  });

  function setup(input: {
    volumes?: OwnedVolume[];
    isLoading?: boolean;
    isError?: boolean;
    providers?: ApiProviderList[];
    countdown?: string | null;
    volumeStatus?: VolumeStatus;
  }) {
    const refetch = vi.fn();
    const useOwnedVolumes: typeof DEPENDENCIES.useOwnedVolumes = () => ({
      volumes: input.volumes ?? [],
      isLoading: !!input.isLoading,
      isError: !!input.isError,
      refetch
    });
    const useProvidersByAddresses = vi.fn((_addresses: readonly string[]) =>
      mock<ReturnType<typeof DEPENDENCIES.useProvidersByAddresses>>({ data: input.providers ?? [] })
    );
    const useCountdown = vi.fn((_deadline: Date | null) => input.countdown ?? null);
    const useVolumeStatus = vi.fn((..._args: Parameters<typeof DEPENDENCIES.useVolumeStatus>) =>
      mock<ReturnType<typeof DEPENDENCIES.useVolumeStatus>>({ data: input.volumeStatus })
    );
    const CreateVolumeDialog = vi.fn<typeof DEPENDENCIES.CreateVolumeDialog>(() => <div role="dialog" aria-label="Create a volume" />);
    const MoveVolumeDialog = vi.fn<typeof DEPENDENCIES.MoveVolumeDialog>(() => <div role="dialog" aria-label="Move a volume" />);
    const ChooseVolumeProviderDialog = vi.fn<typeof DEPENDENCIES.ChooseVolumeProviderDialog>(() => <div role="dialog" aria-label="Choose a provider" />);
    const dependencies = MockComponents(DEPENDENCIES, {
      useOwnedVolumes,
      useProvidersByAddresses,
      useCountdown,
      useVolumeStatus: useVolumeStatus as typeof DEPENDENCIES.useVolumeStatus,
      CreateVolumeDialog,
      MoveVolumeDialog,
      ChooseVolumeProviderDialog
    });

    render(<VolumesPage dependencies={dependencies} />);

    return {
      refetch,
      useProvidersByAddresses,
      useCountdown,
      useVolumeStatus,
      MoveVolumeDialog,
      ChooseVolumeProviderDialog,
      Layout: dependencies.Layout,
      CreateVolumeDialog,
      PricePerTimeUnit: dependencies.PricePerTimeUnit
    };
  }
});
