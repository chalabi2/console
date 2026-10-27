"use client";
import type { FC } from "react";

import { CodeSnippet } from "@src/components/shared/CodeSnippet";
import { volumeAttachmentSdlOf } from "@src/utils/volumeUtils";

export const DEPENDENCIES = { CodeSnippet };

export interface VolumeAttachmentProps {
  vid: string;
  owner: string;
  dseq: string;
  dependencies?: typeof DEPENDENCIES;
}

export const VolumeAttachment: FC<VolumeAttachmentProps> = ({ vid, owner, dseq, dependencies: d = DEPENDENCIES }) => (
  <section aria-label="Attach this volume" className="space-y-3 p-6">
    <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attach this volume</div>
    <p className="text-sm text-muted-foreground">
      Volume {vid} runs no service of its own. To mount it, add this to the SDL of another deployment of yours, with your service&apos;s name and mount path:
    </p>
    <d.CodeSnippet code={volumeAttachmentSdlOf({ vid, owner, dseq })} />
  </section>
);
