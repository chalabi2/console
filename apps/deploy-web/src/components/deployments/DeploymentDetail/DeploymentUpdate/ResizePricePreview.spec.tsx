import type { UseFormReturn } from "react-hook-form";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";

import type { SdlBuilderFormValuesType, ServiceType } from "@src/types";
import type { LeaseDto } from "@src/types/deployment";
import type { DEPENDENCIES } from "./ResizePricePreview";
import { ResizePricePreview } from "./ResizePricePreview";

import { act, render, screen } from "@testing-library/react";
import { buildSDLService } from "@tests/seeders/sdlService";

describe(ResizePricePreview.name, () => {
  it("shows nothing while the placement keeps its hardware", () => {
    setup({ services: [service({ cpu: 1, count: 1, amount: 1000 })] });

    expect(screen.queryByTestId("resize-price-preview")).not.toBeInTheDocument();
  });

  it.each([
    { field: "vCPU", edit: ["services.0.profile.cpu", 2] },
    { field: "memory", edit: ["services.0.profile.ram", 4] },
    { field: "memory unit", edit: ["services.0.profile.ramUnit", "Mi"] },
    { field: "GPUs", edit: ["services.0.profile.gpu", 2] },
    { field: "ephemeral storage", edit: ["services.0.profile.storage.0.size", 20] },
    { field: "ephemeral storage unit", edit: ["services.0.profile.storage.0.unit", "Mi"] }
  ] as const)("caps new $field at the placement's price for its instances and shows what it costs today", ({ edit }) => {
    const { form } = setup({ services: [service({ cpu: 1, count: 1, amount: 1000 })], leasePrice: "53.07" });

    act(() => form.setValue(...edit));

    expect(screen.getByTestId("resize-price-preview")).toHaveTextContent(
      "Your provider prices the new hardware when it accepts it, at no more than 0.001 uact, the most this placement pays. It costs 0.00005307 uact today."
    );
  });

  it("raises the cap with the instances every service of the placement runs", () => {
    const { form } = setup({ services: [service({ cpu: 1, count: 1, amount: 1000 }), service({ cpu: 1, count: 2, amount: 500 })], serviceIndexes: [0, 1] });

    act(() => form.setValue("services.0.count", 3));

    expect(screen.getByTestId("resize-price-preview")).toHaveTextContent("at no more than 0.004 uact");
  });

  it("ignores new hardware for a service of another placement", () => {
    const { form } = setup({ services: [service({ cpu: 1, count: 1, amount: 1000 }), service({ cpu: 1, count: 1, amount: 1000 })], serviceIndexes: [0] });

    act(() => form.setValue("services.1.profile.cpu", 4));

    expect(screen.queryByTestId("resize-price-preview")).not.toBeInTheDocument();
  });

  it("shows nothing once the hardware is set back to what the placement runs", () => {
    const { form } = setup({ services: [service({ cpu: 1, count: 1, amount: 1000 })] });

    act(() => form.setValue("services.0.profile.cpu", 2));
    act(() => form.setValue("services.0.profile.cpu", 1));

    expect(screen.queryByTestId("resize-price-preview")).not.toBeInTheDocument();
  });

  function service(input: { cpu: number; count: number; amount: number }): ServiceType {
    return buildSDLService({
      count: input.count,
      pricing: { amount: input.amount, denom: "uact" },
      profile: { cpu: input.cpu, ram: 1, ramUnit: "Gi", gpu: 0, hasGpu: false, storage: [{ size: 10, unit: "Gi", isPersistent: false }] }
    });
  }

  function setup(input: { services: ServiceType[]; serviceIndexes?: number[]; leasePrice?: string }) {
    const PricePerTimeUnit: typeof DEPENDENCIES.PricePerTimeUnit = ({ perBlockValue, denom }) => <span>{`${perBlockValue} ${denom}`}</span>;
    const lease = mock<LeaseDto>({ price: { denom: "uact", amount: input.leasePrice ?? "10" } });
    let form!: UseFormReturn<SdlBuilderFormValuesType>;

    const Form = () => {
      form = useForm<SdlBuilderFormValuesType>({ defaultValues: { services: input.services } });

      return (
        <FormProvider {...form}>
          <ResizePricePreview lease={lease} loadedServices={input.services} serviceIndexes={input.serviceIndexes ?? [0]} dependencies={{ PricePerTimeUnit }} />
        </FormProvider>
      );
    };

    render(<Form />);

    return { form };
  }
});
