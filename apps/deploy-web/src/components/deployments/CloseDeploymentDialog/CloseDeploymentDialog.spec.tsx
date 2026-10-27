import { describe, expect, it, vi } from "vitest";

import type { OwnedVolume } from "@src/queries/useOwnedVolumes";
import type { CloseDeploymentTarget, DEPENDENCIES } from "./CloseDeploymentDialog";
import { CloseDeploymentDialog } from "./CloseDeploymentDialog";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const DSEQ = "1786440078202";
const DATA: OwnedVolume = {
  name: "data",
  owner: "akash1owner",
  dseq: "100",
  sizeBytes: 1_073_741_824,
  state: "mounted",
  mountedBy: DSEQ,
  reclaim: "retain",
  retention: "604800s"
};

describe("CloseDeploymentDialog", () => {
  it("names the deployment it closes", () => {
    setup({ target: { dseqs: [DSEQ], name: "my-service" } });

    expect(screen.getByRole("heading", { name: "Close this deployment?" })).toBeInTheDocument();
    expect(screen.getByText("my-service")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("the deployment URL stops resolving");
    expect(screen.getByRole("combobox", { name: "Why are you closing this deployment?" })).toBeInTheDocument();
  });

  it("names the deployment by its dseq when it has no name", () => {
    setup({ target: { dseqs: [DSEQ], name: null } });

    expect(screen.getByText(`deployment ${DSEQ}`)).toBeInTheDocument();
  });

  it("words the dialog for every selected deployment when closing several", () => {
    setup({ target: { dseqs: ["1", "2", "3"] } });

    expect(screen.getByRole("heading", { name: "Close 3 deployments?" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("the deployment URLs stop resolving");
    expect(screen.getByRole("combobox", { name: "Why are you closing these deployments?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close 3 deployments" })).toBeDisabled();
  });

  it("keeps the close button disabled until a reason is picked", async () => {
    const { user, onConfirm } = setup({});

    expect(screen.getByRole("button", { name: "Close deployment" })).toBeDisabled();

    await pickReason(user, "Cost or budget");
    await user.click(screen.getByRole("button", { name: "Close deployment" }));

    expect(onConfirm).toHaveBeenCalledWith({ reason: { closeReason: "cost_or_budget", closeReasonDetails: undefined }, volumeDseqs: [] });
  });

  it("asks for details only for the other reason and sends them along", async () => {
    const { user, onConfirm } = setup({});

    expect(screen.queryByRole("textbox", { name: "Tell us more (optional)" })).not.toBeInTheDocument();

    await pickReason(user, "Other");
    await user.type(screen.getByRole("textbox", { name: "Tell us more (optional)" }), "Moved to our own cluster");
    await user.click(screen.getByRole("button", { name: "Close deployment" }));

    expect(onConfirm).toHaveBeenCalledWith({ reason: { closeReason: "other", closeReasonDetails: "Moved to our own cluster" }, volumeDseqs: [] });
  });

  it("cancels without confirming from the cancel button", async () => {
    const { user, onConfirm, onCancel } = setup({});

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels when dismissed with escape", async () => {
    const { user, onCancel } = setup({});

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  describe("when the deployment mounts volumes", () => {
    it("offers to close each volume it mounts, keeping them unless asked", () => {
      setup({
        volumes: [
          DATA,
          { ...DATA, name: "logs", dseq: "101", mountedBy: "999" },
          { ...DATA, name: "spare", dseq: "102", state: "available", mountedBy: undefined }
        ]
      });

      expect(screen.getByRole("group", { name: "Volumes it mounts" })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Also close data/ })).not.toBeChecked();
      expect(screen.getByText("Its provider then keeps the data for 7 days, so a new volume can adopt it.")).toBeInTheDocument();
      expect(screen.queryByRole("checkbox", { name: /logs|spare/ })).not.toBeInTheDocument();
    });

    it("closes the volumes chosen along with the deployment", async () => {
      const { user, onConfirm } = setup({ volumes: [DATA, { ...DATA, name: "logs", dseq: "101" }] });

      await user.click(screen.getByRole("checkbox", { name: /Also close data/ }));
      await pickReason(user, "Cost or budget");
      await user.click(screen.getByRole("button", { name: "Close deployment" }));

      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ volumeDseqs: ["100"] }));
    });

    it("keeps a volume that was chosen and then unchosen", async () => {
      const { user, onConfirm } = setup({ volumes: [DATA] });

      await user.click(screen.getByRole("checkbox", { name: /Also close data/ }));
      await user.click(screen.getByRole("checkbox", { name: /Also close data/ }));
      await pickReason(user, "Cost or budget");
      await user.click(screen.getByRole("button", { name: "Close deployment" }));

      expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ volumeDseqs: [] }));
    });

    it("says nothing of a volume's data when its policy is unknown", () => {
      setup({ volumes: [{ ...DATA, reclaim: undefined, retention: undefined }] });

      expect(screen.getByRole("checkbox", { name: "Also close data" })).toBeInTheDocument();
    });

    it("words the volumes for several deployments", () => {
      setup({ target: { dseqs: [DSEQ, "2"] }, volumes: [DATA] });

      expect(screen.getByRole("group", { name: "Volumes they mount" })).toBeInTheDocument();
    });

    it("offers no volumes when the deployment mounts none", () => {
      setup({ volumes: [{ ...DATA, mountedBy: "999" }] });

      expect(screen.queryByRole("group", { name: /Volumes/ })).not.toBeInTheDocument();
    });
  });

  describe("when the deployment is a volume's own", () => {
    it("asks to close the volume, saying what becomes of its data", async () => {
      const { user, onConfirm } = setup({ target: { dseqs: ["100"], name: "data" }, volumes: [{ ...DATA, state: "available", mountedBy: undefined }] });

      expect(screen.getByRole("heading", { name: "Close this volume?" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent("Its provider then keeps the data for 7 days");
      await pickReason(user, "Cost or budget");
      await user.click(screen.getByRole("button", { name: "Close volume" }));

      expect(onConfirm).toHaveBeenCalledWith({ reason: { closeReason: "cost_or_budget", closeReasonDetails: undefined }, volumeDseqs: [] });
    });

    it("leaves out the data note when the volume's policy is unknown", () => {
      setup({ target: { dseqs: ["100"] }, volumes: [{ ...DATA, mountedBy: undefined, reclaim: undefined, retention: undefined }] });

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("cancels closing the volume", async () => {
      const { user, onCancel } = setup({ target: { dseqs: ["100"] }, volumes: [DATA] });

      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.keyboard("{Escape}");

      expect(onCancel).toHaveBeenCalled();
    });

    it("closes several deployments as deployments, even when one is a volume's own", () => {
      setup({ target: { dseqs: ["100", "2"] }, volumes: [DATA] });

      expect(screen.getByRole("heading", { name: "Close 2 deployments?" })).toBeInTheDocument();
    });
  });

  async function pickReason(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(screen.getByRole("combobox", { name: /Why are you closing/ }));
    await user.click(await screen.findByRole("option", { name: label }));
  }

  function setup(input: { target?: CloseDeploymentTarget; volumes?: OwnedVolume[] }) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const dependencies: typeof DEPENDENCIES = {
      useOwnedVolumes: () => ({ volumes: input.volumes ?? [], isLoading: false, isError: false, refetch: vi.fn() })
    };

    render(
      <CloseDeploymentDialog
        target={input.target ?? { dseqs: [DSEQ], name: "my-service" }}
        onConfirm={onConfirm}
        onCancel={onCancel}
        dependencies={dependencies}
      />
    );

    return { user, onConfirm, onCancel };
  }
});
