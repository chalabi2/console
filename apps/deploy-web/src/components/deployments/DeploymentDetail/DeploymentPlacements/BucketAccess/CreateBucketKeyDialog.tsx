"use client";
import type { FC } from "react";
import { useId, useState } from "react";
import {
  Alert,
  Button,
  DialogV2,
  DialogV2Body,
  DialogV2Content,
  DialogV2Description,
  DialogV2Footer,
  DialogV2Header,
  DialogV2Title,
  Field,
  FieldContent,
  FieldLabel,
  Input,
  Label,
  LoadingButton,
  RadioGroup,
  RadioGroupItem
} from "@akashnetwork/ui/components";

import { CodeSnippet } from "@src/components/shared/CodeSnippet";
import { CopyTextToClipboardButton } from "@src/components/shared/CopyTextToClipboardButton";
import { type BucketLease, useCreateBucketKey } from "@src/queries/useBucketQuery";
import type { BucketInfo, BucketKey, BucketKeyAccess } from "@src/types/bucket";
import { bucketEnvOf, bucketKeyNameErrorOf, bucketRefusalOf } from "@src/utils/bucketUtils";

export const DEPENDENCIES = { useCreateBucketKey, CodeSnippet, CopyTextToClipboardButton };

const ACCESS_OPTIONS: ReadonlyArray<{ access: BucketKeyAccess; title: string; description: string }> = [
  { access: "readwrite", title: "Read and write", description: "Lists, reads, writes and deletes objects" },
  { access: "read", title: "Read only", description: "Lists and reads objects" }
];

type Props = {
  bucketLease: BucketLease;
  info: Pick<BucketInfo, "endpoint" | "region" | "bucket">;
  takenNames: readonly string[];
  onClose: () => void;
  dependencies?: typeof DEPENDENCIES;
};

export const CreateBucketKeyDialog: FC<Props> = ({ bucketLease, info, takenNames, onClose, dependencies: d = DEPENDENCIES }) => {
  const id = useId();
  const createKey = d.useCreateBucketKey(bucketLease);
  const [name, setName] = useState("");
  const [access, setAccess] = useState<BucketKeyAccess>("readwrite");
  const nameError = name ? bucketKeyNameErrorOf(name, takenNames) : undefined;

  const createTheKey = () => {
    createKey.mutate({ name, access });
  };

  return (
    <DialogV2 open onOpenChange={isOpen => !isOpen && !createKey.isPending && onClose()}>
      <DialogV2Content className="max-w-lg" aria-describedby={`${id}-description`}>
        {createKey.data ? (
          <CreatedKey descriptionId={`${id}-description`} bucketKey={createKey.data} info={info} onClose={onClose} dependencies={d} />
        ) : (
          <>
            <DialogV2Header>
              <DialogV2Title>Create an access key</DialogV2Title>
              <DialogV2Description id={`${id}-description`}>
                Give each deployment or tool its own key, so you can revoke one without touching the others.
              </DialogV2Description>
            </DialogV2Header>
            <DialogV2Body className="flex flex-col gap-4">
              <Field className="gap-2">
                <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
                <FieldContent>
                  <Input
                    id={`${id}-name`}
                    aria-label="Key name"
                    placeholder="app"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    disabled={createKey.isPending}
                    inputClassName="h-9"
                  />
                  {nameError && (
                    <p role="alert" className="pl-1 text-xs text-destructive">
                      {nameError}
                    </p>
                  )}
                </FieldContent>
              </Field>
              <Field className="gap-2">
                <FieldLabel>Access</FieldLabel>
                <FieldContent>
                  <RadioGroup
                    aria-label="Access"
                    value={access}
                    onValueChange={value => setAccess(value === "read" ? "read" : "readwrite")}
                    disabled={createKey.isPending}
                    className="flex flex-col gap-2"
                  >
                    {ACCESS_OPTIONS.map(option => (
                      <Label
                        key={option.access}
                        htmlFor={`${id}-${option.access}`}
                        className="flex cursor-pointer items-center gap-2.5 rounded-[10px] border border-border p-3 font-normal has-[[data-state=checked]]:border-foreground has-[[data-state=checked]]:bg-muted/40"
                      >
                        <RadioGroupItem id={`${id}-${option.access}`} value={option.access} className="shrink-0" />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className="text-sm font-semibold">{option.title}</span>
                          <span className="text-xs text-muted-foreground">{option.description}</span>
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                </FieldContent>
              </Field>
              {createKey.isError && <Alert variant="destructive">{bucketRefusalOf(createKey.error) ?? "Couldn't create the key. Please try again."}</Alert>}
            </DialogV2Body>
            <DialogV2Footer className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={createKey.isPending}>
                Cancel
              </Button>
              <LoadingButton type="button" loading={createKey.isPending} onClick={createTheKey} disabled={!name || !!nameError}>
                Create key
              </LoadingButton>
            </DialogV2Footer>
          </>
        )}
      </DialogV2Content>
    </DialogV2>
  );
};

const CreatedKey: FC<{
  descriptionId: string;
  bucketKey: BucketKey;
  info: Props["info"];
  onClose: () => void;
  dependencies: typeof DEPENDENCIES;
}> = ({ descriptionId, bucketKey, info, onClose, dependencies: d }) => (
  <>
    <DialogV2Header>
      <DialogV2Title>Access key {bucketKey.name} created</DialogV2Title>
      <DialogV2Description id={descriptionId}>Copy the secret access key now. The provider never shows it again.</DialogV2Description>
    </DialogV2Header>
    <DialogV2Body className="flex flex-col gap-3">
      <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-1 text-sm">
        <KeyRow label="Access key ID" value={bucketKey.access_key_id} dependencies={d} />
        <KeyRow label="Secret access key" value={bucketKey.secret_access_key} dependencies={d} />
      </dl>
      <p className="text-sm text-muted-foreground">As environment variables for a deployment, with path-style requests:</p>
      <d.CodeSnippet
        code={bucketEnvOf(info, bucketKey)
          .map(variable => `${variable.key}=${variable.value}`)
          .join("\n")}
      />
    </DialogV2Body>
    <DialogV2Footer className="flex justify-end">
      <Button type="button" onClick={onClose}>
        Done
      </Button>
    </DialogV2Footer>
  </>
);

const KeyRow: FC<{ label: string; value: string; dependencies: typeof DEPENDENCIES }> = ({ label, value, dependencies: d }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 items-center gap-1">
      <span className="break-all font-mono text-xs">{value}</span>
      <d.CopyTextToClipboardButton value={value} aria-label={`Copy ${label.toLowerCase()}`} />
    </dd>
  </>
);
