import type { PropsWithChildren } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import type { AttachedVolumeType, SdlBuilderFormValuesType } from "@src/types";
import type { ApiProviderList } from "@src/types/provider";
import { defaultService, defaultServiceWithPlacement } from "@src/utils/sdl/data";
import { DedicatedVolumesCard, DEPENDENCIES } from "./DedicatedVolumesCard";

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const OWNER = "akash1owner";
const PROVIDER = "akash1provider";
const FREE: OwnedVolume = { name: "data", owner: OWNER, dseq: "100", sizeBytes: 1_073_741_824, storageClass: "beta3", provider: PROVIDER };
const MOUNTED: AttachedVolumeType = { name: "data", owner: OWNER, dseq: "100", mount: "/data", isReadOnly: false };

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
    { case: "holds no lease yet", volume: { ...FREE, provider: undefined } },
    { case: "another deployment mounts", volume: { ...FREE, mountedBy: "200" } }
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
    const { getValues } = setup({ volumes: [{ ...MOUNTED, name: "", dseq: "" }] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));
    await userEvent.click(screen.getByRole("option", { name: "data · 1.07 GB · beta3" }));

    expect(getValues().services[0].volumes).toEqual([{ name: "data", owner: OWNER, dseq: "100", mount: "/data", isReadOnly: false }]);
  });

  it("keeps the volume a row holds among its options when it no longer reads as free", async () => {
    setup({ volumes: [MOUNTED], owned: [] });

    await userEvent.click(screen.getByRole("combobox", { name: "Volume" }));

    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["data"]);
  });

  it("names the provider that runs the service, since it holds the volume", () => {
    setup({ volumes: [MOUNTED], providers: [mock<ApiProviderList>({ owner: PROVIDER, organization: "Meridian Cloud", hostUri: "https://p.example:8443" })] });

    expect(screen.getByText("This service runs on Meridian Cloud, the provider holding its volumes.")).toBeInTheDocument();
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

  it("keeps every control read-only while locked", () => {
    setup({ volumes: [MOUNTED], locked: true });

    expect(screen.getByRole("switch", { name: "Mount a dedicated volume" })).toBeDisabled();
    expect(screen.getByLabelText("Volume mount")).toBeDisabled();
  });

  function setup(
    input: {
      volumes?: AttachedVolumeType[];
      owned?: OwnedVolume[];
      otherServiceVolumes?: AttachedVolumeType[];
      providers?: ApiProviderList[];
      locked?: boolean;
    } = {}
  ) {
    const values = defaultServiceWithPlacement({ image: "nginx:1.27", volumes: input.volumes });
    if (input.otherServiceVolumes) {
      values.services.push(defaultService(values.placements[0].id, { id: "worker", title: "worker", image: "nginx:1.27", volumes: input.otherServiceVolumes }));
    }
    const useOwnedVolumes: typeof DEPENDENCIES.useOwnedVolumes = () => ({ volumes: input.owned ?? [FREE], isLoading: false });
    const useProvidersByAddresses = vi.fn((_addresses: readonly string[]) =>
      mock<ReturnType<typeof DEPENDENCIES.useProvidersByAddresses>>({ data: input.providers ?? [] })
    );

    let getValues: () => SdlBuilderFormValuesType = () => values;
    const Wrapper = ({ children }: PropsWithChildren) => {
      const form = useForm<SdlBuilderFormValuesType>({ defaultValues: values, mode: "onChange" });
      getValues = form.getValues;
      return <FormProvider {...form}>{children}</FormProvider>;
    };

    render(
      <Wrapper>
        <DedicatedVolumesCard
          serviceIndex={0}
          locked={input.locked}
          dependencies={{ ...DEPENDENCIES, useOwnedVolumes, useProvidersByAddresses: useProvidersByAddresses as typeof DEPENDENCIES.useProvidersByAddresses }}
        />
      </Wrapper>
    );

    return { getValues: () => getValues(), useProvidersByAddresses };
  }
});
