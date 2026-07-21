import { afterEach, describe, expect, it, vi } from "vitest";

import { mockProviders } from "./providerVerification.mock";
import { ProviderVerificationPreview } from "./ProviderVerificationPreview";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

describe(ProviderVerificationPreview.name, () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows the default provider eligibility result", () => {
    render(<ProviderVerificationPreview initialDataSource="scenarios" />);

    expect(screen.getByText((_, element) => element?.textContent === "2 eligible · 2 filtered")).toBeInTheDocument();
    expect(screen.getByText("Registered and reachable; operator claims are not independently verified.")).toBeInTheDocument();
    expect(screen.getByText("A physical audit, SLA, and the strongest ongoing compliance requirements apply.")).toBeInTheDocument();
  });

  it("moves between provider and active-lease verification views", async () => {
    const user = userEvent.setup();
    render(<ProviderVerificationPreview initialDataSource="scenarios" />);

    await user.click(screen.getByRole("tab", { name: /provider/i }));
    expect(screen.getByRole("heading", { name: "Atlas Cloud" })).toBeInTheDocument();
    expect(screen.getByText("Audit escrow lifecycle")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /active lease/i }));
    expect(screen.getByRole("heading", { name: "Deployment #741923" })).toBeInTheDocument();
    expect(screen.getByText(/provider network maintenance scheduled/i)).toBeInTheDocument();
  });

  it("loads the live testnet feed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ chainId: "aep-86", moduleActive: true, observedAt: "2026-07-20T12:00:00Z", providers: [mockProviders[0]] }), {
            status: 200
          })
      )
    );

    render(<ProviderVerificationPreview />);

    expect(await screen.findAllByText("Nebula Compute")).not.toHaveLength(0);
    expect(screen.getByText("Matching active")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: /active lease/i }));
    expect(screen.getByRole("heading", { name: "No active lease is available" })).toBeInTheDocument();
  });
});
