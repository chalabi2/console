import { TooltipProvider } from "@akashnetwork/ui/components";
import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { DeploymentDto, DeploymentGroup, LeaseDto } from "@src/types/deployment";
import type { DeclaredVolume } from "./volumeDeclarations";
import type { DEPENDENCIES } from "./VolumeUpdate";
import { VolumeUpdate } from "./VolumeUpdate";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { buildActivity } from "@tests/seeders/activity";

const GI = 1024 ** 3;

describe(VolumeUpdate.name, () => {
  it("shows each volume with the size it holds, its class and what becomes of it once its deployment closes", () => {
    setup({ volumes: [{ name: "data", size: "1Gi", storageClass: "beta3", reclaim: "retain", retention: "1h" }] });

    const volume = screen.getByRole("group", { name: "Volume data" });
    expect(volume).toHaveTextContent("Holds1.07 GB");
    expect(volume).toHaveTextContent("Classbeta3");
    expect(volume).toHaveTextContent("After closeKept 1h");
    expect(screen.getByRole("spinbutton", { name: "Size" })).toHaveValue(1);
    expect(screen.getByText("1 volume")).toBeInTheDocument();
  });

  it("names the default class for a volume that declares none", () => {
    setup({ volumes: [{ name: "data", size: "1Gi" }] });

    expect(screen.getByRole("group", { name: "Volume data" })).toHaveTextContent("Classdefault");
  });

  it("shows nothing held while the leases are unknown", () => {
    setup({ held: null });

    expect(screen.getByRole("group", { name: "Volume data" })).toHaveTextContent("Holds—");
  });

  it.each([
    { reclaim: "delete", retention: undefined, expected: "After closeDeleted" },
    { reclaim: "retain", retention: undefined, expected: "After closeKept" }
  ])("says what becomes of a volume that its deployment's close leaves $reclaim", ({ reclaim, retention, expected }) => {
    setup({ volumes: [{ name: "data", size: "1Gi", reclaim, retention }] });

    expect(screen.getByRole("group", { name: "Volume data" })).toHaveTextContent(expected);
  });

  it("grows a volume to the size set", async () => {
    const { submit } = setup();

    await userEvent.clear(screen.getByRole("spinbutton", { name: "Size" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Size" }), "3");
    await userEvent.click(screen.getByRole("button", { name: "Grow volume" }));

    expect(submit).toHaveBeenCalledWith({ data: "3Gi" });
  });

  it("asks again for the size the definition holds ahead of a lease that never grew to it", async () => {
    const { submit } = setup({ volumes: [{ name: "data", size: "2Gi" }], heldBytes: GI });

    await userEvent.click(screen.getByRole("button", { name: "Grow volume" }));

    expect(submit).toHaveBeenCalledWith({ data: "2Gi" });
  });

  it("explains why the volume kept its size when its last update failed", () => {
    setup({ volumes: [{ name: "data", size: "2Gi" }], heldBytes: GI, failedReason: "The provider declined the new resources." });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The volume didn't grow to the size this deployment asks for, so it keeps the size it holds. The provider declined the new resources."
    );
  });

  it("explains that the volume kept its size even when the failed update gave no reason", () => {
    setup({ volumes: [{ name: "data", size: "2Gi" }], heldBytes: GI, failedReason: "" });

    expect(screen.getByRole("alert")).toHaveTextContent(/^The volume didn't grow to the size this deployment asks for, so it keeps the size it holds\.\s*$/);
  });

  it("sends only the volumes whose size changed", async () => {
    const { submit } = setup({
      volumes: [
        { name: "data", size: "1Gi" },
        { name: "logs", size: "1Gi" }
      ],
      held: { data: GI, logs: GI }
    });

    await userEvent.clear(screen.getAllByRole("spinbutton", { name: "Size" })[0]);
    await userEvent.type(screen.getAllByRole("spinbutton", { name: "Size" })[0], "3");
    await userEvent.click(screen.getByRole("button", { name: "Grow volumes" }));

    expect(submit).toHaveBeenCalledWith({ data: "3Gi" });
  });

  it("asks again only for the volume whose lease never grew to the size the definition holds", async () => {
    const { submit } = setup({
      volumes: [
        { name: "data", size: "2Gi" },
        { name: "logs", size: "1Gi" }
      ],
      held: { data: GI, logs: GI }
    });

    await userEvent.click(screen.getByRole("button", { name: "Grow volumes" }));

    expect(submit).toHaveBeenCalledWith({ data: "2Gi" });
  });

  it("drops a refusal once a size that grows the volume is sent", async () => {
    const { submit } = setup({ heldBytes: 2 * GI, volumes: [{ name: "data", size: "2Gi" }] });
    await userEvent.clear(screen.getByRole("spinbutton", { name: "Size" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Size" }), "1");
    await userEvent.click(screen.getByRole("button", { name: "Grow volume" }));

    await userEvent.clear(screen.getByRole("spinbutton", { name: "Size" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Size" }), "3");
    await userEvent.click(screen.getByRole("button", { name: "Grow volume" }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(submit).toHaveBeenCalledWith({ data: "3Gi" });
  });

  it("sends no size of nothing", async () => {
    setup();

    await userEvent.clear(screen.getByRole("spinbutton", { name: "Size" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Size" }), "0");

    expect(screen.getByRole("button", { name: "Grow volume" })).toBeDisabled();
  });

  it("reports no failure while a lease catches up with an update that did not fail", () => {
    setup({ volumes: [{ name: "data", size: "2Gi" }], heldBytes: GI });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves nothing to grow while the lease holds the size the definition asks for", () => {
    setup();

    expect(screen.getByRole("button", { name: "Grow volume" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  });

  it("refuses a size below what the volume holds, sending nothing", async () => {
    const { submit } = setup({ heldBytes: 2 * GI, volumes: [{ name: "data", size: "2Gi" }] });

    await userEvent.clear(screen.getByRole("spinbutton", { name: "Size" }));
    await userEvent.type(screen.getByRole("spinbutton", { name: "Size" }), "1");
    await userEvent.click(screen.getByRole("button", { name: "Grow volume" }));

    expect(screen.getByRole("alert")).toHaveTextContent('Volume "data" holds 2.15 GB and can only grow, so set a larger size.');
    expect(submit).not.toHaveBeenCalled();
  });

  it("sends no size it cannot read", async () => {
    const { submit } = setup();

    await userEvent.clear(screen.getByRole("spinbutton", { name: "Size" }));

    expect(screen.getByRole("button", { name: "Grow volume" })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("puts back the size the definition holds when the edit is discarded", async () => {
    setup();
    await userEvent.type(screen.getByRole("spinbutton", { name: "Size" }), "0");

    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));

    expect(screen.getByRole("spinbutton", { name: "Size" })).toHaveValue(1);
  });

  it("shows a resize waiting for its provider and locks the size meanwhile", () => {
    setup({ pendingResize: true });

    expect(screen.getByRole("alert")).toHaveTextContent("Your provider has yet to grow the volume.");
    expect(screen.getByRole("spinbutton", { name: "Size" })).toBeDisabled();
  });

  it("cancels the resize waiting for its provider", async () => {
    const { cancelResize } = setup({ pendingResize: true });

    await userEvent.click(screen.getByRole("button", { name: "Cancel resize" }));

    expect(cancelResize).toHaveBeenCalled();
  });

  it("drops the pending notice once the resize it showed is canceled", async () => {
    setup({ pendingResize: true });

    await userEvent.click(screen.getByRole("button", { name: "Cancel resize" }));

    expect(screen.queryByText(/Your provider has yet to grow the volume/)).not.toBeInTheDocument();
  });

  it("shows a pending resize the api reported when it refused to grow the volume", () => {
    setup({ isHeldByPendingResize: true });

    expect(screen.getByRole("alert")).toHaveTextContent("Your provider has yet to grow the volume.");
  });

  it("shows why the api refused the size", () => {
    setup({ refusal: 'it shrinks volume "data", which can only grow' });

    expect(screen.getByRole("alert")).toHaveTextContent('it shrinks volume "data", which can only grow');
  });

  it("says the volume is being grown while the update applies in the background", () => {
    setup({ isApplyingInBackground: true });

    expect(screen.getByText("The volume is being grown. You'll get a notification when it's done.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Growing…" })).toBeDisabled();
  });

  it("keeps the size where resizing is off, saying why", () => {
    setup({ canResize: false });

    expect(screen.getByRole("spinbutton", { name: "Size" })).toBeDisabled();
    expect(screen.getByText("Growing a volume in place is not available yet, so a volume keeps the size it was created with.")).toBeInTheDocument();
  });

  it("offers no way to grow the volume of a closed deployment", () => {
    setup({ state: "closed" });

    expect(screen.getByText("This volume's deployment is closed, so its size can no longer change.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Grow volume" })).not.toBeInTheDocument();
  });

  it("shows a size it cannot read as it is, without letting it change", () => {
    setup({ volumes: [{ name: "data", size: "1G" }] });

    expect(screen.getByRole("textbox", { name: "Size" })).toHaveValue("1G");
    expect(screen.getByRole("textbox", { name: "Size" })).toBeDisabled();
  });

  it("names every volume a deployment declares", () => {
    setup({
      volumes: [
        { name: "data", size: "1Gi" },
        { name: "logs", size: "10Gi" }
      ],
      heldBytes: GI
    });

    expect(screen.getByRole("group", { name: "Volume logs" })).toHaveTextContent("Holds—");
    expect(screen.getByText("2 volumes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grow volumes" })).toBeInTheDocument();
  });

  function setup(
    input: {
      volumes?: DeclaredVolume[];
      heldBytes?: number;
      held?: Record<string, number> | null;
      state?: string;
      canResize?: boolean;
      pendingResize?: boolean;
      failedReason?: string;
      isApplyingInBackground?: boolean;
      isHeldByPendingResize?: boolean;
      refusal?: string;
    } = {}
  ) {
    const volumes = input.volumes ?? [{ name: "data", size: "1Gi" }];
    const submit = vi.fn();
    const cancelResize = vi.fn().mockResolvedValue(true);
    const onUpdated = vi.fn();
    const dependencies: typeof DEPENDENCIES = {
      useFlag: (flag => flag === "lease_resize" && (input.canResize ?? true)) as typeof DEPENDENCIES.useFlag,
      useUpdatingDeployments: () => new Set(input.isApplyingInBackground ? ["1234"] : []),
      useFailedDeploymentUpdate: () =>
        input.failedReason !== undefined
          ? buildActivity({
              type: "deployment_update",
              status: "failed",
              meta: { dseq: "1234", ...(input.failedReason && { error: { code: "resize_declined", message: input.failedReason } }) }
            })
          : undefined,
      usePendingDeploymentResize: () =>
        input.pendingResize ? buildActivity({ type: "deployment_update", status: "pending", meta: { dseq: "1234", resize: true } }) : undefined,
      useCancelDeploymentResize: () => ({ cancel: cancelResize, isCanceling: false }),
      useVolumeGrowSubmit: () => ({
        submit,
        isSubmitting: false,
        refusal: input.refusal ?? null,
        isHeldByPendingResize: input.isHeldByPendingResize ?? false
      })
    };

    render(
      <VolumeUpdate
        deployment={mock<DeploymentDto>({ dseq: "1234", state: input.state ?? "active" })}
        leases={input.held === null ? null : Object.entries(input.held ?? { data: input.heldBytes ?? GI }).map(([name, bytes]) => leaseHolding(name, bytes))}
        volumes={volumes}
        manifestVersion="dm9sdW1l"
        onUpdated={onUpdated}
        dependencies={dependencies}
      />,
      { wrapper: TooltipProvider }
    );

    return { submit, cancelResize, onUpdated };
  }

  function leaseHolding(volumeName: string, bytes: number): LeaseDto {
    return mock<LeaseDto>({
      storageAmount: bytes,
      group: mock<DeploymentGroup>({
        group_spec: mock<DeploymentGroup["group_spec"]>({
          resources: [
            mock<DeploymentGroup["group_spec"]["resources"][number]>({
              resource: mock<DeploymentGroup["group_spec"]["resources"][number]["resource"]>({
                storage: [{ name: volumeName, quantity: { val: String(bytes) }, attributes: [] }]
              })
            })
          ]
        })
      })
    });
  }
});
