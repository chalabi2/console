import { describe, expect, it, vi } from "vitest";

import { volumeAttachmentSdlOf } from "@src/utils/volumeUtils";
import { DEPENDENCIES, VolumeAttachment } from "./VolumeAttachment";

import { render, screen } from "@testing-library/react";
import { MockComponents } from "@tests/unit/mocks";

describe(VolumeAttachment.name, () => {
  it("explains that the volume runs no service and is mounted from another deployment", () => {
    setup();

    expect(screen.getByRole("region", { name: "Attach this volume" })).toHaveTextContent("Volume data runs no service of its own.");
  });

  it("shows the sdl another deployment attaches the volume with", () => {
    const { CodeSnippet } = setup();

    expect(CodeSnippet.mock.calls[0][0]).toEqual({ code: volumeAttachmentSdlOf({ vid: "data", owner: "akash1owner", dseq: "1234" }) });
  });

  function setup() {
    const CodeSnippet = vi.fn((_props: { code: string }) => <pre>snippet</pre>);
    render(<VolumeAttachment vid="data" owner="akash1owner" dseq="1234" dependencies={MockComponents(DEPENDENCIES, { CodeSnippet })} />);

    return { CodeSnippet };
  }
});
