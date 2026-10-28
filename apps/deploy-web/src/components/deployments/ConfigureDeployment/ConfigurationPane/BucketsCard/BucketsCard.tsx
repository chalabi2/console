"use client";
import type { FC } from "react";
import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import {
  Alert,
  Button,
  CollapsibleCard,
  Field,
  FieldContent,
  FieldLabel,
  Label,
  LoadingButton,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@akashnetwork/ui/components";
import { CloudIcon } from "lucide-react";
import { customAlphabet, nanoid } from "nanoid";
import Link from "next/link";

import { useConnectBucket } from "@src/queries/useBucketQuery";
import { type OwnedVolume, useOwnedVolumes } from "@src/queries/useOwnedVolumes";
import { useProvidersByAddresses } from "@src/queries/useProvidersQuery";
import type { SdlBuilderFormValuesType } from "@src/types";
import type { BucketKeyAccess } from "@src/types/bucket";
import { bucketKeyNameFor, bucketRefusalOf, withBucketEnv, withoutBucketEnv } from "@src/utils/bucketUtils";
import { UrlService } from "@src/utils/urlUtils";
import { SELECT_TRUNCATE_VALUE } from "../selectStyles";

export const DEPENDENCIES = { CollapsibleCard, useOwnedVolumes, useProvidersByAddresses, useConnectBucket };

const newKeySuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 4);

const ACCESS_OPTIONS: ReadonlyArray<{ access: BucketKeyAccess; label: string }> = [
  { access: "readwrite", label: "Read and write" },
  { access: "read", label: "Read only" }
];

type Props = {
  serviceIndex: number;
  locked?: boolean;
  dependencies?: typeof DEPENDENCIES;
};

/** A bucket reaches the service over the network wherever either runs, so connecting one only hands the service a key. */
export const BucketsCard: FC<Props> = ({ serviceIndex, locked = false, dependencies: d = DEPENDENCIES }) => {
  const { control, getValues, setValue } = useFormContext<SdlBuilderFormValuesType>();
  const envPath = `services.${serviceIndex}.env` as const;
  const env = useWatch({ control, name: envPath }) ?? [];
  const serviceName = useWatch({ control, name: `services.${serviceIndex}.title` });
  const { volumes } = d.useOwnedVolumes();
  const buckets = volumes.filter(volume => volume.access === "bucket" && volume.state === "available");
  const [dseq, setDseq] = useState("");
  const [access, setAccess] = useState<BucketKeyAccess>("readwrite");
  const bucket = buckets.find(candidate => candidate.dseq === dseq);
  const { data: providers } = d.useProvidersByAddresses(bucket?.provider ? [bucket.provider] : []);
  const provider = providers.find(candidate => candidate.owner === bucket?.provider);
  const connect = d.useConnectBucket();
  const connectedBucket = env.find(variable => variable.key === "S3_BUCKET")?.value;
  const lease = bucket && provider && leaseOf(bucket);

  const connectTheBucket = () => {
    if (!lease) return;
    connect.mutate(
      { lease: { ...lease, provider }, name: bucketKeyNameFor(serviceName, newKeySuffix()), access },
      { onSuccess: variables => setValue(envPath, withBucketEnv(getValues(envPath) ?? [], variables, nanoid), { shouldDirty: true }) }
    );
  };

  const disconnectTheBucket = () => {
    setValue(envPath, withoutBucketEnv(getValues(envPath) ?? []), { shouldDirty: true });
  };

  return (
    <d.CollapsibleCard locked={locked} title="S3 Buckets" icon={<CloudIcon className="h-4 w-4" />}>
      <p className="text-sm text-muted-foreground">
        Give this service a key to one of your buckets, on any provider. Its endpoint, name and region become variables and the key becomes secrets, which S3
        clients read as they are, with path-style requests.
      </p>

      {connectedBucket ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Connected to <span className="font-mono">{connectedBucket}</span>. Its key stays on the bucket until you revoke it there.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={disconnectTheBucket} disabled={locked}>
            Disconnect
          </Button>
        </div>
      ) : buckets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          You have no bucket to connect. <Link href={UrlService.volumes()}>Create one on the Volumes page.</Link>
        </p>
      ) : (
        <>
          <Field className="gap-2">
            <FieldLabel>Bucket</FieldLabel>
            <FieldContent>
              <Select value={dseq} onValueChange={setDseq} disabled={locked || connect.isPending}>
                <SelectTrigger aria-label="Bucket" className={`h-9 ${SELECT_TRUNCATE_VALUE}`}>
                  <SelectValue placeholder="Choose a bucket" />
                </SelectTrigger>
                <SelectContent>
                  {buckets.map(candidate => (
                    <SelectItem key={candidate.dseq} value={candidate.dseq}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldContent>
          </Field>

          <RadioGroup
            aria-label="Key access"
            value={access}
            onValueChange={value => setAccess(value === "read" ? "read" : "readwrite")}
            disabled={locked || connect.isPending}
            className="flex gap-4"
          >
            {ACCESS_OPTIONS.map(option => (
              <Label key={option.access} className="flex items-center gap-2 font-normal">
                <RadioGroupItem value={option.access} />
                {option.label}
              </Label>
            ))}
          </RadioGroup>

          {connect.isError && <Alert variant="destructive">{bucketRefusalOf(connect.error) ?? "Couldn't connect the bucket. Please try again."}</Alert>}

          <LoadingButton
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            loading={connect.isPending}
            disabled={locked || !lease}
            onClick={connectTheBucket}
          >
            Connect bucket
          </LoadingButton>
        </>
      )}
    </d.CollapsibleCard>
  );
};

function leaseOf(bucket: OwnedVolume): { dseq: string; gseq: number; oseq: number } | undefined {
  if (bucket.gseq === undefined || bucket.oseq === undefined) return undefined;
  return { dseq: bucket.dseq, gseq: bucket.gseq, oseq: bucket.oseq };
}
