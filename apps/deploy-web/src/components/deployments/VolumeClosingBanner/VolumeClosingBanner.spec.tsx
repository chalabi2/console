import { describe, expect, it, vi } from "vitest";

import type { DeploymentGroup, LeaseDto } from "@src/types/deployment";
import type { GroupVolume } from "@src/utils/volumeUtils";
import type { DEPENDENCIES } from "./VolumeClosingBanner";
import { VolumeClosingBanner } from "./VolumeClosingBanner";

import { render, screen } from "@testing-library/react";
import { buildRpcDeployment } from "@tests/seeders";

const DEADLINE_IN_SEC = 1_793_116_720;

describe(VolumeClosingBanner.name, () => {
  it("counts down to the end of the reclamation window of a volume its owner closed", () => {
    const { useCountdown } = setup({ countdown: "4 minutes, 10 seconds" });

    expect(screen.getByText("This volume is closing")).toBeInTheDocument();
    expect(
      screen.getByText("Its provider keeps serving it until its reclamation window ends, and it finishes closing in 4 minutes, 10 seconds.")
    ).toBeInTheDocument();
    expect(useCountdown).toHaveBeenCalledWith(new Date(DEADLINE_IN_SEC * 1000));
  });

  it("says the close is finishing once the reclamation window has ended", () => {
    setup({ countdown: null });

    expect(screen.getByText("Its reclamation window has ended, so it is finishing closing now.")).toBeInTheDocument();
  });

  it("says how long its provider keeps a retained volume's data after it closes", () => {
    setup({ volume: { vid: "data", reclaim: "retain", retention: "3600s" } });

    expect(screen.getByText("Its provider then keeps the data for 1 hour, so a new volume can adopt it.")).toBeInTheDocument();
  });

  it("says a volume whose data is not retained loses it once it closes", () => {
    setup({ volume: { vid: "data", reclaim: "delete", retention: "0s" } });

    expect(screen.getByText("Its data is deleted once it closes.")).toBeInTheDocument();
  });

  it("says nothing of after the close for a volume whose retention is unknown", () => {
    setup({ volume: { vid: "data" } });

    expect(screen.queryByText(/keeps the data|is deleted/)).not.toBeInTheDocument();
  });

  it.each([
    { case: "its provider is reclaiming", lease: { state: "reclaiming", reclamation: { deadline: DEADLINE_IN_SEC, reason: "reason_volume_evict" } } },
    { case: "has finished closing", lease: { state: "closed", reclamation: { deadline: DEADLINE_IN_SEC, reason: "reason_volume_closed_retain" } } }
  ])("shows nothing for a volume that $case", ({ lease }) => {
    const { useCountdown } = setup({ lease });

    expect(screen.queryByText("This volume is closing")).not.toBeInTheDocument();
    expect(useCountdown).toHaveBeenCalledWith(null);
  });

  it("shows nothing before the leases load", () => {
    render(<VolumeClosingBanner leases={undefined} dependencies={{ useCountdown: vi.fn(() => null) }} />);

    expect(screen.queryByText("This volume is closing")).not.toBeInTheDocument();
  });

  function setup(input: { countdown?: string | null; volume?: GroupVolume; lease?: Pick<LeaseDto, "state" | "reclamation"> }) {
    const [group] = buildRpcDeployment().groups;
    const volumeGroup: DeploymentGroup = {
      ...group,
      group_spec: { ...group.group_spec, volume: input.volume ?? { vid: "data", reclaim: "retain", retention: "3600s" } }
    };
    const lease: LeaseDto = {
      id: "1",
      owner: "akash1owner",
      provider: "akash1provider",
      dseq: "123",
      gseq: 1,
      oseq: 1,
      price: { denom: "uact", amount: "1" },
      cpuAmount: 0,
      memoryAmount: 0,
      storageAmount: 1_073_741_824,
      group: volumeGroup,
      ...(input.lease ?? { state: "reclaiming", reclamation: { deadline: DEADLINE_IN_SEC, reason: "reason_volume_closed_retain" } })
    };
    const useCountdown = vi.fn<typeof DEPENDENCIES.useCountdown>(() => (input.countdown === undefined ? "4 minutes" : input.countdown));

    render(<VolumeClosingBanner leases={[lease]} dependencies={{ useCountdown }} />);

    return { useCountdown };
  }
});
