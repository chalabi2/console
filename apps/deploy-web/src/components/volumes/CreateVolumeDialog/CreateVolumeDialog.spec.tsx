import yaml from "js-yaml";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { ApiProviderList } from "@src/types/provider";
import { PRICE_DISPLAY_PRECISION, udenomToDenom } from "@src/utils/mathHelpers";
import { defaultPlacement } from "@src/utils/sdl/data";
import { CreateVolumeDialog, DEPENDENCIES } from "./CreateVolumeDialog";
import type { CreateVolumeStep, VolumeBid } from "./useCreateVolume";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const OWNER = "akash1owner";
const DSEQ = "1793120236298";
const BID: VolumeBid = { provider: "akash1provider", perBlockAmount: "1.5", denom: "uact" };

describe(CreateVolumeDialog.name, () => {
  it("creates the volume described, placed like the service that mounts it", async () => {
    const { create } = setup({});

    await userEvent.clear(screen.getByLabelText("Volume name"));
    await userEvent.type(screen.getByLabelText("Volume name"), "app-data");
    await userEvent.click(screen.getByRole("button", { name: "Create volume" }));

    expect(create).toHaveBeenCalledWith({ name: "app-data", sdl: expect.any(String) });
    expect(yaml.load(create.mock.calls[0][0].sdl)).toMatchObject({
      volumes: { "app-data": { size: "10Gi", class: "beta3", lifecycle: { reclaim: "retain", retention: "168h" } } },
      deployment: { "app-data": { dcloud: { profile: "app-data", count: 1 } } }
    });
  });

  it("creates a volume whose data goes when it closes", async () => {
    const { create } = setup({});

    await userEvent.click(screen.getByRole("combobox", { name: "After it closes" }));
    await userEvent.click(screen.getByRole("option", { name: "Delete its data" }));
    await userEvent.click(screen.getByRole("button", { name: "Create volume" }));

    expect(yaml.load(create.mock.calls[0][0].sdl)).toMatchObject({ volumes: { data: { lifecycle: { reclaim: "delete" } } } });
  });

  it("creates a volume of the type chosen", async () => {
    const { create } = setup({});

    await userEvent.click(screen.getByRole("combobox", { name: "Volume type" }));
    await userEvent.click(screen.getByRole("option", { name: "SSD" }));
    await userEvent.click(screen.getByRole("button", { name: "Create volume" }));

    expect(yaml.load(create.mock.calls[0][0].sdl)).toMatchObject({ volumes: { data: { class: "beta2" } } });
  });

  it("labels the volume's name", () => {
    setup({});

    expect(screen.getByLabelText("Name")).toHaveValue("data");
  });

  it("refuses a size below one", async () => {
    setup({});

    await userEvent.clear(screen.getByRole("spinbutton"));
    await userEvent.type(screen.getByRole("spinbutton"), "-1");

    expect(screen.getByRole("button", { name: "Create volume" })).toBeDisabled();
  });

  it.each([
    { case: "is described", step: { kind: "editing" as const } },
    { case: "has providers to choose from", step: { kind: "choosing" as const, dseq: DSEQ } }
  ])("shows no error while the volume $case without one", ({ step }) => {
    setup({ step, bids: [BID] });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers no providers while the volume is described", () => {
    setup({});

    expect(screen.queryByText(/Choose the provider/)).not.toBeInTheDocument();
  });

  it("leaves the description once providers bid", () => {
    setup({ step: { kind: "choosing", dseq: DSEQ }, bids: [BID] });

    expect(screen.queryByLabelText("Volume name")).not.toBeInTheDocument();
  });

  it("looks up the providers that bid", () => {
    const { useProvidersByAddresses } = setup({ step: { kind: "choosing", dseq: DSEQ }, bids: [BID] });

    expect(useProvidersByAddresses).toHaveBeenLastCalledWith(["akash1provider"]);
  });

  it("abandons the volume when the dialog is dismissed", async () => {
    const { abandon, onOpenChange } = setup({ step: { kind: "choosing", dseq: DSEQ }, bids: [BID] });

    await userEvent.keyboard("{Escape}");

    expect(abandon).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open when dismissed while the lease is sent", async () => {
    const { abandon, onOpenChange } = setup({ step: { kind: "leasing", dseq: DSEQ }, bids: [BID] });

    await userEvent.keyboard("{Escape}");

    expect(abandon).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it.each([
    { case: "is no DNS label", name: "Data_1", message: "Use lowercase letters, digits and dashes, starting and ending with a letter or digit." },
    { case: "the wallet already gave a volume", name: "logs", message: "You already have a volume named logs." }
  ])("refuses a name that $case", async ({ name, message }) => {
    setup({ takenNames: ["logs"] });

    await userEvent.clear(screen.getByLabelText("Volume name"));
    await userEvent.type(screen.getByLabelText("Volume name"), name);

    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create volume" })).toBeDisabled();
  });

  it("shows why the volume could not be created", () => {
    setup({ step: { kind: "editing", error: "volume name in use" } });

    expect(screen.getByText("volume name in use")).toBeInTheDocument();
  });

  it("holds every field while the volume's deployment is created", () => {
    setup({ step: { kind: "creating" } });

    expect(screen.getByLabelText("Volume name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  });

  it("waits for providers to bid on the volume", () => {
    setup({ step: { kind: "choosing", dseq: DSEQ } });

    expect(screen.getByText("Waiting for providers to bid…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lease volume" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Change settings" })).not.toBeInTheDocument();
  });

  it.each([
    { case: "no provider has bid yet", step: { kind: "choosing" as const, dseq: DSEQ }, bids: [], isWaiting: true },
    { case: "a provider has bid", step: { kind: "choosing" as const, dseq: DSEQ }, bids: [BID], isWaiting: false },
    { case: "the volume is still described", step: { kind: "editing" as const }, bids: [], isWaiting: false }
  ])("waits on bids only while $case leaves none to choose from", ({ step, bids, isWaiting }) => {
    const { useHasWaited } = setup({ step, bids });

    expect(useHasWaited).toHaveBeenLastCalledWith(isWaiting, 30_000);
  });

  it("says why no provider bid once the wait runs out, and offers to change the settings", () => {
    setup({ step: { kind: "choosing", dseq: DSEQ }, hasWaited: true });

    expect(screen.getByText(/No provider has bid yet\. Providers cap how long they keep a volume's data after it closes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change settings" })).toBeInTheDocument();
  });

  it("takes the volume back to its settings without closing", async () => {
    const { abandon, onOpenChange } = setup({ step: { kind: "choosing", dseq: DSEQ }, hasWaited: true });

    await userEvent.click(screen.getByRole("button", { name: "Change settings" }));

    expect(abandon).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("offers each bidding provider with its region and price", () => {
    setup({
      step: { kind: "choosing", dseq: DSEQ },
      bids: [BID, { ...BID, provider: "akash1unknown" }],
      providers: [
        mock<ApiProviderList>({
          owner: "akash1provider",
          organization: "Meridian Cloud",
          hostUri: "https://p.example:8443",
          locationRegion: "us-west",
          attributes: []
        })
      ]
    });

    expect(screen.getByRole("radio", { name: /Meridian Cloud/ })).toBeInTheDocument();
    expect(screen.getByText("us-west")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /akash1unknown/ })).toBeInTheDocument();
    expect(screen.getByText("Region unknown")).toBeInTheDocument();
    expect(screen.getAllByText(`price ${udenomToDenom("1.5", PRICE_DISPLAY_PRECISION)} uact`)).toHaveLength(2);
  });

  it("leases the volume from the provider chosen and mounts it in the service", async () => {
    const { lease, onCreated, onOpenChange } = setup({ step: { kind: "choosing", dseq: DSEQ }, bids: [BID] });

    await userEvent.click(screen.getByRole("radio", { name: /akash1provider/ }));
    await userEvent.click(screen.getByRole("button", { name: "Lease volume" }));

    expect(lease).toHaveBeenCalledWith("akash1provider");
    expect(onCreated).toHaveBeenCalledWith({ name: "data", owner: OWNER, dseq: DSEQ });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open when the lease fails, showing why", async () => {
    const { onCreated, onOpenChange } = setup({ step: { kind: "choosing", dseq: DSEQ, error: "provider gone" }, bids: [BID], leased: undefined });

    await userEvent.click(screen.getByRole("radio", { name: /akash1provider/ }));
    await userEvent.click(screen.getByRole("button", { name: "Lease volume" }));

    expect(screen.getByText("provider gone")).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("abandons the volume's deployment when cancelled", async () => {
    const { abandon, onOpenChange } = setup({ step: { kind: "choosing", dseq: DSEQ }, bids: [BID] });

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(abandon).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("cannot be cancelled while the lease is sent", () => {
    setup({ step: { kind: "leasing", dseq: DSEQ }, bids: [BID] });

    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Leasing…" })).toBeDisabled();
  });

  function setup(input: {
    step?: CreateVolumeStep;
    bids?: VolumeBid[];
    providers?: ApiProviderList[];
    takenNames?: string[];
    leased?: string | undefined;
    hasWaited?: boolean;
  }) {
    const create = vi.fn(async (_volume: { name: string; sdl: string }) => undefined);
    const lease = vi.fn(async (_provider: string) => ("leased" in input ? input.leased : DSEQ));
    const abandon = vi.fn(async () => undefined);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    const useProvidersByAddresses = vi.fn((_addresses: readonly string[]) =>
      mock<ReturnType<typeof DEPENDENCIES.useProvidersByAddresses>>({ data: input.providers ?? [] })
    );
    const useHasWaited = vi.fn((_isWaiting: boolean, _waitMs: number) => !!input.hasWaited);
    const dependencies = {
      ...DEPENDENCIES,
      useHasWaited,
      useCreateVolume: () => ({ step: input.step ?? { kind: "editing" as const }, bids: input.bids ?? [], create, lease, abandon }),
      useWallet: () => mock<ReturnType<typeof DEPENDENCIES.useWallet>>({ address: OWNER }),
      useProvidersByAddresses,
      PricePerTimeUnit: ({ perBlockValue, denom }: { perBlockValue: number; denom: string }) => <span>{`price ${perBlockValue} ${denom}`}</span>
    };

    render(
      <CreateVolumeDialog
        open
        onOpenChange={onOpenChange}
        placement={defaultPlacement({ name: "dcloud" })}
        takenNames={input.takenNames ?? []}
        onCreated={onCreated}
        dependencies={dependencies as unknown as typeof DEPENDENCIES}
      />
    );

    return { create, lease, abandon, onCreated, onOpenChange, useProvidersByAddresses, useHasWaited };
  }
});
