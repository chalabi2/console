import type { ComponentProps, PropsWithChildren } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import type { AttachedVolumeType, SdlBuilderFormValuesType } from "@src/types";
import { SdlBuilderFormValuesSchema } from "@src/types";
import type { ApiProviderList } from "@src/types/provider";
import { defaultPlacement, defaultService, defaultServiceWithPlacement } from "@src/utils/sdl/data";
import { DedicatedVolumesCard, DEPENDENCIES } from "./DedicatedVolumesCard";

import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const OWNER = "akash1owner";
const PROVIDER = "akash1provider";
const FREE: OwnedVolume = {
  name: "data",
  owner: OWNER,
  dseq: "100",
  sizeBytes: 1_073_741_824,
  storageClass: "beta3",
  access: "mount",
  state: "available",
  provider: PROVIDER
};
const MOUNTED: AttachedVolumeType = { name: "data", owner: OWNER, dseq: "100", mount: "/data", isReadOnly: false };
const EMPTY_ROW: AttachedVolumeType = { name: "", dseq: "", mount: "/data", isReadOnly: false };
const LOGS: OwnedVolume = { ...FREE, name: "logs", dseq: "101" };

describe(DedicatedVolumesCard.name, () => {
  it("mounts no volume until switched on", () => {
    setup();

    expect(screen.getByRole("switch", { name: "Mount a dedicated volume" })).not.toBeChecked();
    expect(screen.queryByRole("group", { name: "Volume 1" })).not.toBeInTheDocument();
  });

  it("adds a volume to choose, mounted at /data, when switched on", async () => {
    const { getValues } = setup();

    await userEvent.click(screen.getByRole("switch", { name: "Mount a dedicated volume" }));

    expect(getValues().services[0].volumes).toEqual([{ name: "", dseq: "", mount: "/data", isReadOnly: false }]);
    expect(screen.getByLabelText("Volume mount")).toHaveValue("/data");
  });

  it("drops every volume when switched off", async () => {
    const { getValues } = setup({ volumes: [MOUNTED] });

    await userEvent.click(screen.getByRole("switch", { name: "Mount a dedicated volume" }));

    expect(getValues().services[0].volumes).toEqual([]);
  });

  it("offers the free volumes the wallet leases, with their size and class", async () => {
    setup({ volumes: [{ ...MOUNTED, name: "", dseq: "" }], owned: [FREE, { ...FREE, name: "logs", dseq: "101", storageClass: undefined }] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));

    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["data · 1.07 GB · beta3", "logs · 1.07 GB"]);
  });

  it.each([
    { case: "holds no lease yet", volume: { ...FREE, state: "unleased" as const, provider: undefined } },
    { case: "another deployment mounts", volume: { ...FREE, state: "mounted" as const, mountedBy: "200" } },
    { case: "is closing", volume: { ...FREE, state: "closing" as const } },
    { case: "is a bucket", volume: { ...FREE, access: "bucket" as const } }
  ])("does not offer a volume that $case", async ({ volume }) => {
    setup({ volumes: [{ ...MOUNTED, name: "", dseq: "" }], owned: [volume] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("does not offer a volume another service of this deployment mounts", async () => {
    setup({ volumes: [{ ...MOUNTED, name: "", dseq: "" }], otherServiceVolumes: [MOUNTED] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));

    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("writes the chosen volume into the service", async () => {
    const { getValues } = setup({ volumes: [EMPTY_ROW], owned: [FREE, LOGS] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));
    await userEvent.click(screen.getByRole("option", { name: "logs · 1.07 GB · beta3" }));

    expect(getValues().services[0].volumes).toEqual([{ name: "logs", owner: OWNER, dseq: "101", mount: "/data", isReadOnly: false }]);
  });

  it("shows the volume a row holds", () => {
    setup({ volumes: [MOUNTED] });

    expect(screen.getByRole("combobox", { name: "Volume" })).toHaveTextContent("data · 1.07 GB · beta3");
  });

  it("shows a volume the wallet's list no longer holds by its name", () => {
    setup({ volumes: [MOUNTED], owned: [] });

    expect(screen.getByRole("combobox", { name: "Volume" })).toHaveTextContent("data");
    expect(screen.queryByText(/This service runs on/)).not.toBeInTheDocument();
  });

  it("offers each row the free volumes the other rows did not take, its own first", async () => {
    setup({ volumes: [MOUNTED, { ...EMPTY_ROW, mount: "/logs" }], owned: [FREE, LOGS] });

    await userEvent.click(within(screen.getByRole("group", { name: "Volume 1" })).getByRole("combobox", { name: "Volume" }));
    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["data · 1.07 GB · beta3", "logs · 1.07 GB · beta3"]);
    await userEvent.keyboard("{Escape}");

    await userEvent.click(within(screen.getByRole("group", { name: "Volume 2" })).getByRole("combobox", { name: "Volume" }));
    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["logs · 1.07 GB · beta3"]);
  });

  it("keeps the volume a row holds on offer beside the free ones", async () => {
    setup({ volumes: [MOUNTED], owned: [LOGS] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));

    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["logs · 1.07 GB · beta3", "data"]);
  });

  it("marks a volume read only", async () => {
    const { getValues } = setup({ volumes: [MOUNTED] });

    await userEvent.click(screen.getByLabelText("Read only"));

    expect(getValues().services[0].volumes?.[0].isReadOnly).toBe(true);
  });

  it("shows a read-only volume as read only", () => {
    setup({ volumes: [{ ...MOUNTED, isReadOnly: true }] });

    expect(screen.getByRole("checkbox", { name: "Read only" })).toBeChecked();
  });

  it("shows a writable volume as writable", () => {
    setup({ volumes: [MOUNTED] });

    expect(screen.getByRole("checkbox", { name: "Read only" })).not.toBeChecked();
  });

  it("labels the mount a volume takes", () => {
    setup({ volumes: [MOUNTED] });

    expect(screen.getByLabelText("Mount")).toHaveValue("/data");
  });

  it("says why a volume row is not ready", async () => {
    const { trigger } = setup({ volumes: [{ ...EMPTY_ROW, mount: "data" }], validated: true });

    await act(() => trigger());

    expect(screen.getByText("Choose a volume.")).toBeInTheDocument();
    expect(screen.getByText("Mount must be an absolute path.")).toBeInTheDocument();
  });

  it("keeps the volume a row holds among its options when it no longer reads as free", async () => {
    setup({ volumes: [MOUNTED], owned: [] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));

    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["data"]);
  });

  it("names the provider that runs the service, since it holds the volume", () => {
    setup({
      volumes: [MOUNTED],
      providers: [
        mock<ApiProviderList>({ owner: "akash1other", organization: "Other Cloud", hostUri: "https://o.example:8443" }),
        mock<ApiProviderList>({ owner: PROVIDER, organization: "Meridian Cloud", hostUri: "https://p.example:8443" })
      ]
    });

    expect(screen.getByText("This service runs on Meridian Cloud, the provider holding its volumes.")).toBeInTheDocument();
    expect(screen.queryByText(/different providers/)).not.toBeInTheDocument();
  });

  it("names no provider while no volume is chosen", () => {
    setup({ volumes: [EMPTY_ROW] });

    expect(screen.queryByText(/This service runs on/)).not.toBeInTheDocument();
  });

  it("falls back to the provider's address while its name is unknown", () => {
    setup({ volumes: [MOUNTED] });

    expect(screen.getByText(`This service runs on ${PROVIDER}, the provider holding its volumes.`)).toBeInTheDocument();
  });

  it("warns when the volumes are leased from different providers", () => {
    setup({
      volumes: [MOUNTED, { ...MOUNTED, name: "logs", dseq: "101", mount: "/logs" }],
      owned: [FREE, { ...FREE, name: "logs", dseq: "101", provider: "akash1other" }]
    });

    expect(
      screen.getByText("These volumes are leased from different providers, and a service can only run where every volume it mounts is.")
    ).toBeInTheDocument();
  });

  it.each([
    { case: "one is free", input: { volumes: [EMPTY_ROW] } },
    { case: "a row holds one", input: { volumes: [MOUNTED, { ...EMPTY_ROW, mount: "/logs" }], owned: [] } }
  ])("says nothing of free volumes while $case", ({ input }) => {
    setup(input);

    expect(screen.queryByText(/You have no volume free to mount/)).not.toBeInTheDocument();
  });

  it("offers no remove control for the only volume", () => {
    setup({ volumes: [MOUNTED] });

    expect(screen.queryByRole("button", { name: "Remove Volume 1" })).not.toBeInTheDocument();
  });

  it("opens no create dialog until asked", () => {
    const { CreateVolumeDialog } = setup({ volumes: [MOUNTED] });

    expect(CreateVolumeDialog).not.toHaveBeenCalled();
  });

  it("creates the volume in the placement of this service", async () => {
    const { CreateVolumeDialog, getValues } = setup({ volumes: [EMPTY_ROW], inSecondPlacement: true });

    await userEvent.click(screen.getByRole("button", { name: "Create a volume" }));

    expect(CreateVolumeDialog.mock.lastCall?.[0].placement).toEqual(getValues().placements[1]);
  });

  it("creates only a disk, since it mounts what it creates", async () => {
    const { CreateVolumeDialog } = setup({ volumes: [EMPTY_ROW] });

    await userEvent.click(screen.getByRole("button", { name: "Create a volume" }));

    expect(CreateVolumeDialog.mock.lastCall?.[0].offersBuckets).toBeFalsy();
  });

  it("mounts another volume past every path taken", async () => {
    const { getValues } = setup({ volumes: [MOUNTED, { ...MOUNTED, name: "logs", dseq: "101", mount: "/data-1" }] });

    await userEvent.click(screen.getByRole("button", { name: "Mount another volume" }));

    expect(getValues().services[0].volumes?.[2].mount).toBe("/data-2");
  });

  it("says when no volume is free to mount", () => {
    setup({ volumes: [{ ...MOUNTED, name: "", dseq: "" }], owned: [] });

    expect(screen.getByText("You have no volume free to mount. A volume is leased as its own deployment.")).toBeInTheDocument();
  });

  it("mounts another volume at the next free path", async () => {
    const { getValues } = setup({ volumes: [MOUNTED] });

    await userEvent.click(screen.getByRole("button", { name: "Mount another volume" }));

    expect(getValues().services[0].volumes?.[1]).toEqual({ name: "", dseq: "", mount: "/data-1", isReadOnly: false });
  });

  it("removes one volume of several", async () => {
    const { getValues } = setup({ volumes: [MOUNTED, { ...MOUNTED, name: "logs", dseq: "101", mount: "/logs" }] });

    await userEvent.click(within(screen.getByRole("group", { name: "Volume 1" })).getByRole("button", { name: "Remove Volume 1" }));

    expect(getValues().services[0].volumes).toEqual([{ ...MOUNTED, name: "logs", dseq: "101", mount: "/logs" }]);
  });

  it("asks the provider lookup for the providers of the mounted volumes only", () => {
    const { useProvidersByAddresses } = setup({ volumes: [MOUNTED], owned: [FREE, { ...FREE, name: "logs", dseq: "101", provider: "akash1other" }] });

    expect(useProvidersByAddresses).toHaveBeenLastCalledWith([PROVIDER]);
  });

  it("creates a volume placed like the service, refusing the names the wallet's volumes hold", async () => {
    const { CreateVolumeDialog, getValues } = setup({ volumes: [{ ...MOUNTED, name: "", dseq: "" }], owned: [FREE, { ...FREE, name: "logs", dseq: "101" }] });

    await userEvent.click(screen.getByRole("button", { name: "Create a volume" }));

    expect(CreateVolumeDialog.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ open: true, placement: getValues().placements[0], takenNames: ["data", "logs"] })
    );
  });

  it("mounts a created volume in the row left without one", async () => {
    const { getValues } = setup({ volumes: [{ ...MOUNTED, name: "", dseq: "" }] });

    await userEvent.click(screen.getByRole("button", { name: "Create a volume" }));
    await userEvent.click(screen.getByRole("button", { name: "created" }));

    expect(getValues().services[0].volumes).toEqual([{ name: "app-data", owner: OWNER, dseq: "300", mount: "/data", isReadOnly: false }]);
  });

  it("mounts a created volume at the next free path when every row holds a volume", async () => {
    const { getValues } = setup({ volumes: [MOUNTED] });

    await userEvent.click(screen.getByRole("button", { name: "Create a volume" }));
    await userEvent.click(screen.getByRole("button", { name: "created" }));

    expect(getValues().services[0].volumes).toEqual([MOUNTED, { name: "app-data", owner: OWNER, dseq: "300", mount: "/data-1", isReadOnly: false }]);
  });

  it("closes the create dialog when it asks to", async () => {
    const { CreateVolumeDialog } = setup({ volumes: [MOUNTED] });

    await userEvent.click(screen.getByRole("button", { name: "Create a volume" }));
    await userEvent.click(screen.getByRole("button", { name: "dismiss" }));

    expect(screen.queryByRole("button", { name: "created" })).not.toBeInTheDocument();
    expect(CreateVolumeDialog).toHaveBeenCalledTimes(1);
  });

  it("keeps every control read-only while locked", () => {
    setup({ volumes: [MOUNTED], locked: true });

    expect(screen.getByRole("switch", { name: "Mount a dedicated volume" })).toBeDisabled();
    expect(screen.getByLabelText("Volume mount")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create a volume" })).toBeDisabled();
  });

  function setup(
    input: {
      volumes?: AttachedVolumeType[];
      owned?: OwnedVolume[];
      otherServiceVolumes?: AttachedVolumeType[];
      providers?: ApiProviderList[];
      locked?: boolean;
      validated?: boolean;
      inSecondPlacement?: boolean;
    } = {}
  ) {
    const values = defaultServiceWithPlacement({ image: "nginx:1.27", volumes: input.volumes });
    if (input.inSecondPlacement) {
      values.placements.push(defaultPlacement({ name: "other" }));
      values.services[0].placementId = values.placements[1].id;
    }
    if (input.otherServiceVolumes) {
      values.services.push(defaultService(values.placements[0].id, { id: "worker", title: "worker", image: "nginx:1.27", volumes: input.otherServiceVolumes }));
    }
    const useOwnedVolumes: typeof DEPENDENCIES.useOwnedVolumes = () => ({ volumes: input.owned ?? [FREE], isLoading: false, isError: false, refetch: vi.fn() });
    const useProvidersByAddresses = vi.fn((_addresses: readonly string[]) =>
      mock<ReturnType<typeof DEPENDENCIES.useProvidersByAddresses>>({ data: input.providers ?? [] })
    );
    const CreateVolumeDialog = vi.fn((props: ComponentProps<typeof DEPENDENCIES.CreateVolumeDialog>) => (
      <>
        <button type="button" onClick={() => props.onCreated({ name: "app-data", owner: OWNER, dseq: "300" })}>
          created
        </button>
        <button type="button" onClick={() => props.onOpenChange(false)}>
          dismiss
        </button>
      </>
    ));

    let getValues: () => SdlBuilderFormValuesType = () => values;
    let trigger: () => Promise<boolean> = async () => true;
    const Wrapper = ({ children }: PropsWithChildren) => {
      const form = useForm<SdlBuilderFormValuesType>({
        defaultValues: values,
        mode: "onChange",
        ...(input.validated && { resolver: zodResolver(SdlBuilderFormValuesSchema) })
      });
      getValues = form.getValues;
      trigger = () => form.trigger();
      return <FormProvider {...form}>{children}</FormProvider>;
    };

    render(
      <Wrapper>
        <DedicatedVolumesCard
          serviceIndex={0}
          locked={input.locked}
          dependencies={{
            ...DEPENDENCIES,
            CreateVolumeDialog,
            useOwnedVolumes,
            useProvidersByAddresses: useProvidersByAddresses as typeof DEPENDENCIES.useProvidersByAddresses
          }}
        />
      </Wrapper>
    );

    return { getValues: () => getValues(), trigger: () => trigger(), useProvidersByAddresses, CreateVolumeDialog };
  }
});
