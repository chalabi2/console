import type { PropsWithChildren } from "react";
import { FormProvider, useForm } from "react-hook-form";
import type { UseMutationResult } from "@tanstack/react-query";
import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { BucketLease } from "@src/queries/useBucketQuery";
import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import type { SdlBuilderFormValuesType } from "@src/types";
import type { BucketKeyAccess } from "@src/types/bucket";
import type { ApiProviderList } from "@src/types/provider";
import type { BucketEnvVariable } from "@src/utils/bucketUtils";
import { defaultServiceWithPlacement } from "@src/utils/sdl/data";
import { BucketsCard, DEPENDENCIES } from "./BucketsCard";

import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const OWNER = "akash1owner";
const PROVIDER = "akash1provider";
const ASSETS: OwnedVolume = {
  name: "assets",
  owner: OWNER,
  dseq: "300",
  sizeBytes: 1_073_741_824,
  storageClass: "beta3",
  access: "bucket",
  state: "available",
  provider: PROVIDER,
  gseq: 1,
  oseq: 1
};
const PROVIDER_IDENTITY = mock<ApiProviderList>({ owner: PROVIDER, hostUri: "https://provider.test" });
const BUCKET_VARIABLES: BucketEnvVariable[] = [
  { key: "AWS_ENDPOINT_URL_S3", value: "https://s3.provider.test", isSecret: false },
  { key: "AWS_REGION", value: "default", isSecret: false },
  { key: "S3_BUCKET", value: "assets-0123", isSecret: false },
  { key: "AWS_ACCESS_KEY_ID", value: "AKID", isSecret: true },
  { key: "AWS_SECRET_ACCESS_KEY", value: "SECRET", isSecret: true }
];

type ConnectMutation = UseMutationResult<BucketEnvVariable[], Error, { lease: BucketLease; name: string; access: BucketKeyAccess }>;

describe(BucketsCard.name, () => {
  it("offers the wallet's buckets, leaving out its disks and the buckets it is closing", async () => {
    setup({
      owned: [
        ASSETS,
        { ...ASSETS, name: "backups", dseq: "301" },
        { ...ASSETS, name: "data", dseq: "302", access: "mount" },
        { ...ASSETS, name: "closing", dseq: "303", state: "closing" }
      ]
    });

    await userEvent.click(screen.getByRole("combobox", { name: "Bucket" }));

    expect(screen.getAllByRole("option").map(option => option.textContent)).toEqual(["assets", "backups"]);
  });

  it("connects the bucket chosen with a read and write key named after the service", async () => {
    const { mutate } = setup({});

    await chooseAssets();
    await userEvent.click(screen.getByRole("button", { name: "Connect bucket" }));

    expect(mutate).toHaveBeenCalledWith(
      {
        lease: { provider: PROVIDER_IDENTITY, dseq: "300", gseq: 1, oseq: 1 },
        name: expect.stringMatching(/^web-[a-z0-9]{4}$/),
        access: "readwrite"
      },
      expect.anything()
    );
  });

  it("connects the bucket chosen among several", async () => {
    const { mutate } = setup({ owned: [ASSETS, { ...ASSETS, name: "backups", dseq: "301", gseq: 2, oseq: 3 }] });

    await userEvent.click(screen.getByRole("combobox", { name: "Bucket" }));
    await userEvent.click(screen.getByRole("option", { name: "backups" }));
    await userEvent.click(screen.getByRole("button", { name: "Connect bucket" }));

    expect(mutate.mock.lastCall?.[0].lease).toEqual({ provider: PROVIDER_IDENTITY, dseq: "301", gseq: 2, oseq: 3 });
  });

  it("connects through the bucket's own provider among those looked up", async () => {
    const other = mock<ApiProviderList>({ owner: "akash1other", hostUri: "https://other.test" });
    const { mutate } = setup({ providers: [other, PROVIDER_IDENTITY] });

    await chooseAssets();
    await userEvent.click(screen.getByRole("button", { name: "Connect bucket" }));

    expect(mutate.mock.lastCall?.[0].lease.provider?.owner).toBe(PROVIDER);
  });

  it("connects with a read-only key when chosen", async () => {
    const { mutate } = setup({});

    await chooseAssets();
    await userEvent.click(screen.getByRole("radio", { name: "Read only" }));
    await userEvent.click(screen.getByRole("button", { name: "Connect bucket" }));

    expect(mutate.mock.lastCall?.[0].access).toBe("read");
  });

  it("goes back to a read and write key when chosen again", async () => {
    const { mutate } = setup({});

    await chooseAssets();
    await userEvent.click(screen.getByRole("radio", { name: "Read only" }));
    await userEvent.click(screen.getByRole("radio", { name: "Read and write" }));
    await userEvent.click(screen.getByRole("button", { name: "Connect bucket" }));

    expect(mutate.mock.lastCall?.[0].access).toBe("readwrite");
  });

  it("looks up the provider of the bucket chosen", async () => {
    const { useProvidersByAddresses } = setup({});

    expect(useProvidersByAddresses).toHaveBeenLastCalledWith([]);
    await chooseAssets();

    expect(useProvidersByAddresses).toHaveBeenLastCalledWith([PROVIDER]);
  });

  it("gives the service the bucket's variables and key, keeping its other variables", async () => {
    const { mutate, getValues, isEnvDirty } = setup({ env: [{ id: "1", key: "PORT", value: "80", isSecret: false }] });
    await chooseAssets();
    await userEvent.click(screen.getByRole("button", { name: "Connect bucket" }));

    act(() => mutate.mock.lastCall?.[1]?.onSuccess?.(BUCKET_VARIABLES, mutate.mock.lastCall[0], undefined));

    expect(getValues().services[0].env?.map(({ key, value, isSecret }) => ({ key, value, isSecret }))).toEqual([
      { key: "PORT", value: "80", isSecret: false },
      ...BUCKET_VARIABLES
    ]);
    expect(screen.getByText("assets-0123")).toBeInTheDocument();
    expect(isEnvDirty()).toBe(true);
  });

  it("connects nothing before a bucket is chosen", () => {
    setup({});

    expect(screen.getByRole("button", { name: "Connect bucket" })).toBeDisabled();
  });

  it("waits for the provider of the bucket chosen", async () => {
    setup({ providers: [] });

    await chooseAssets();

    expect(screen.getByRole("button", { name: "Connect bucket" })).toBeDisabled();
  });

  it("connects no bucket whose lease is not known", async () => {
    setup({ owned: [{ ...ASSETS, gseq: undefined }] });

    await chooseAssets();

    expect(screen.getByRole("button", { name: "Connect bucket" })).toBeDisabled();
  });

  it("connects no bucket whose order is not known", async () => {
    setup({ owned: [{ ...ASSETS, oseq: undefined }] });

    await chooseAssets();

    expect(screen.getByRole("button", { name: "Connect bucket" })).toBeDisabled();
  });

  it("says why the provider refused the key", () => {
    setup({ connection: { isError: true, error: providerError(409, "the bucket's lease is not active") } });

    expect(screen.getByText("The bucket's lease is not active.")).toBeInTheDocument();
  });

  it("asks to retry a connection the provider could not make", () => {
    setup({ connection: { isError: true, error: new Error("Network Error") } });

    expect(screen.getByText("Couldn't connect the bucket. Please try again.")).toBeInTheDocument();
  });

  it("holds the choice while the bucket is connected", () => {
    setup({ connection: { isPending: true } });

    expect(screen.getByRole("combobox", { name: "Bucket" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Read only" })).toBeDisabled();
  });

  it("shows the bucket the service is connected to, and disconnects it", async () => {
    const { getValues, isEnvDirty } = setup({
      env: [{ id: "1", key: "PORT", value: "80", isSecret: false }, ...BUCKET_VARIABLES.map((variable, index) => ({ id: `b${index}`, ...variable }))]
    });

    expect(screen.getByText("assets-0123")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Bucket" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    expect(getValues().services[0].env).toEqual([{ id: "1", key: "PORT", value: "80", isSecret: false }]);
    expect(screen.getByRole("combobox", { name: "Bucket" })).toBeInTheDocument();
    expect(isEnvDirty()).toBe(true);
  });

  it("points to the Volumes page while the wallet has no bucket", () => {
    setup({ owned: [{ ...ASSETS, access: "mount" }] });

    expect(screen.getByRole("link", { name: "Create one on the Volumes page." })).toHaveAttribute("href", "/volumes");
    expect(screen.queryByRole("button", { name: "Connect bucket" })).not.toBeInTheDocument();
  });

  it("changes nothing while the section is locked", async () => {
    setup({ locked: true });

    expect(screen.getByRole("combobox", { name: "Bucket" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Read only" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Connect bucket" })).toBeDisabled();
  });

  it("keeps a connected bucket while the section is locked", () => {
    setup({ locked: true, env: BUCKET_VARIABLES.map((variable, index) => ({ id: `b${index}`, ...variable })) });

    expect(screen.getByRole("button", { name: "Disconnect" })).toBeDisabled();
  });

  async function chooseAssets() {
    await userEvent.click(screen.getByRole("combobox", { name: "Bucket" }));
    await userEvent.click(screen.getByRole("option", { name: "assets" }));
  }

  function setup(
    input: {
      owned?: OwnedVolume[];
      providers?: ApiProviderList[];
      env?: NonNullable<SdlBuilderFormValuesType["services"][number]["env"]>;
      locked?: boolean;
      connection?: { isPending?: boolean; isError?: boolean; error?: Error };
    } = {}
  ) {
    const values = defaultServiceWithPlacement({ title: "web", image: "nginx:1.27", env: input.env ?? [] });
    const useOwnedVolumes: typeof DEPENDENCIES.useOwnedVolumes = () => ({
      volumes: input.owned ?? [ASSETS],
      isLoading: false,
      isError: false,
      refetch: vi.fn()
    });
    const useProvidersByAddresses = vi.fn((_addresses: readonly string[]) =>
      mock<ReturnType<typeof DEPENDENCIES.useProvidersByAddresses>>({ data: input.providers ?? [PROVIDER_IDENTITY] })
    );
    const mutate = vi.fn<ConnectMutation["mutate"]>();
    const state = input.connection?.isPending
      ? { isPending: true as const }
      : input.connection?.isError
        ? { isError: true as const, error: input.connection.error }
        : { isPending: false as const, isError: false as const };
    const useConnectBucket = vi.fn<typeof DEPENDENCIES.useConnectBucket>(() => mock<ConnectMutation>({ mutate, ...state }));

    let getValues: () => SdlBuilderFormValuesType = () => values;
    let isEnvDirty = () => false;
    const Wrapper = ({ children }: PropsWithChildren) => {
      const form = useForm<SdlBuilderFormValuesType>({ defaultValues: values });
      getValues = form.getValues;
      isEnvDirty = () => form.getFieldState("services.0.env").isDirty;
      return <FormProvider {...form}>{children}</FormProvider>;
    };

    render(
      <Wrapper>
        <BucketsCard
          serviceIndex={0}
          locked={input.locked}
          dependencies={{
            ...DEPENDENCIES,
            useOwnedVolumes,
            useProvidersByAddresses: useProvidersByAddresses as typeof DEPENDENCIES.useProvidersByAddresses,
            useConnectBucket
          }}
        />
      </Wrapper>
    );

    return { mutate, getValues: () => getValues(), isEnvDirty: () => isEnvDirty(), useProvidersByAddresses };
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
