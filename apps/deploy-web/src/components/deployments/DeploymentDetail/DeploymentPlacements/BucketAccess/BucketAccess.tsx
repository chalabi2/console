"use client";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  DialogV2,
  DialogV2Content,
  DialogV2Description,
  DialogV2Footer,
  DialogV2Header,
  DialogV2Title,
  LoadingButton,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@akashnetwork/ui/components";
import { Plus, RefreshCw } from "lucide-react";

import { CopyTextToClipboardButton } from "@src/components/shared/CopyTextToClipboardButton";
import { BUCKET_KEYS_SCOPE, BUCKET_SCOPE, canRequestScope, useProviderCredentials } from "@src/hooks/useProviderCredentials/useProviderCredentials";
import { useBucketInfo, useRevokeBucketKey } from "@src/queries/useBucketQuery";
import { IMPORTING_PHASE, IMPORTING_POLL_INTERVAL, useVolumeStatus } from "@src/queries/useVolumeStatusQuery";
import type { ProviderIdentity } from "@src/services/provider-proxy/provider-proxy.service";
import type { BucketInfo, BucketKeyInfo } from "@src/types/bucket";
import type { LeaseDto } from "@src/types/deployment";
import { bucketRefusalOf, isBucketBeingProvisioned } from "@src/utils/bucketUtils";
import { formatByteSize } from "@src/utils/unitUtils";
import { CreateBucketKeyDialog } from "./CreateBucketKeyDialog";

export const DEPENDENCIES = { useBucketInfo, useRevokeBucketKey, useProviderCredentials, useVolumeStatus, CopyTextToClipboardButton, CreateBucketKeyDialog };

const ACCESS_LABELS: Record<BucketKeyInfo["access"], string> = { readwrite: "Read and write", read: "Read only" };

const BUCKET_ACCESS_SCOPE = [...BUCKET_SCOPE, ...BUCKET_KEYS_SCOPE];

type Props = {
  lease: LeaseDto;
  provider?: ProviderIdentity;
  dependencies?: typeof DEPENDENCIES;
};

export const BucketAccess: FC<Props> = ({ lease, provider, dependencies: d = DEPENDENCIES }) => {
  const { tokenMode } = d.useProviderCredentials();
  const canUseBucket = canRequestScope(tokenMode, BUCKET_ACCESS_SCOPE);
  const bucketLease = { provider, dseq: lease.dseq, gseq: lease.gseq, oseq: lease.oseq };
  const { data: status } = d.useVolumeStatus(bucketLease, { enabled: canUseBucket && wasMovedHere(lease) });
  const isCopyingIn = status?.phase === IMPORTING_PHASE;
  const info = d.useBucketInfo(bucketLease, { enabled: canUseBucket, refetchInterval: isCopyingIn ? IMPORTING_POLL_INTERVAL : false });
  const wasCopyingIn = useRef(isCopyingIn);
  const refetchInfo = info.refetch;

  useEffect(
    function readTheBucketAgainOnceItsObjectsArrived() {
      if (wasCopyingIn.current && !isCopyingIn) refetchInfo();
      wasCopyingIn.current = isCopyingIn;
    },
    [isCopyingIn, refetchInfo]
  );

  return (
    <section aria-label="S3 bucket" className="space-y-4 p-6">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">S3 bucket</div>
      {!canUseBucket && <p className="text-sm text-muted-foreground">Your role cannot see or change this bucket&apos;s access keys.</p>}
      {canUseBucket && info.isError && <BucketUnreachable error={info.error} onRetry={() => info.refetch()} />}
      {canUseBucket && !info.isError && !info.data && (
        <div role="status" aria-label="Loading the bucket">
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {canUseBucket && info.data && <BucketDetails info={info.data} lease={lease} provider={provider} isCopyingIn={isCopyingIn} dependencies={d} />}
    </section>
  );
};

const BucketUnreachable: FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => (
  <div className="flex flex-col items-start gap-2">
    <p className="text-sm text-muted-foreground">
      {isBucketBeingProvisioned(error) ? "The provider is still setting this bucket up." : "Couldn't reach this bucket's provider."}
    </p>
    <Button variant="outline" size="sm" onClick={onRetry}>
      <RefreshCw className="mr-2 h-4 w-4" />
      Retry
    </Button>
  </div>
);

const BucketDetails: FC<{ info: BucketInfo; lease: LeaseDto; provider?: ProviderIdentity; isCopyingIn: boolean; dependencies: typeof DEPENDENCIES }> = ({
  info,
  lease,
  provider,
  isCopyingIn,
  dependencies: d
}) => {
  const isLeaseActive = lease.state === "active";
  const canCreateKeys = isLeaseActive && !isCopyingIn;
  const bucketLease = { provider, dseq: lease.dseq, gseq: lease.gseq, oseq: lease.oseq };
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [keyToRevoke, setKeyToRevoke] = useState<string | null>(null);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Your deployments on any provider can use this bucket with one of its access keys. S3 clients reach it with path-style requests.
      </p>

      <dl className="grid grid-cols-[max-content_1fr] items-center gap-x-4 gap-y-1 text-sm">
        <ConnectionRow label="Endpoint" value={info.endpoint} dependencies={d} />
        <ConnectionRow label="Bucket" value={info.bucket} dependencies={d} />
        <ConnectionRow label="Region" value={info.region} dependencies={d} />
        <dt className="text-muted-foreground">Used</dt>
        <dd>
          {formatByteSize(info.used_bytes)} of {formatByteSize(info.size_bytes)}
        </dd>
      </dl>

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Access keys</h3>
        <Button size="sm" variant="outline" onClick={() => setIsCreatingKey(true)} disabled={!canCreateKeys}>
          <Plus className="mr-2 h-4 w-4" />
          Create access key
        </Button>
      </div>
      {isLeaseActive && isCopyingIn && (
        <p className="text-sm text-muted-foreground">
          Its objects are being copied in from its previous provider. Access keys can be created once they have all arrived.
        </p>
      )}
      {!isLeaseActive && (
        <p className="text-sm text-muted-foreground">
          New access keys can be created while the bucket&apos;s lease is active. Existing ones can still be revoked.
        </p>
      )}

      {info.keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No access keys yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Access key ID</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {info.keys.map(key => (
              <TableRow key={key.name}>
                <TableCell className="font-medium">{key.name}</TableCell>
                <TableCell>{ACCESS_LABELS[key.access]}</TableCell>
                <TableCell className="font-mono text-xs">{key.access_key_id}</TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm" aria-label={`Revoke ${key.name}`} onClick={() => setKeyToRevoke(key.name)}>
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {isCreatingKey && (
        <d.CreateBucketKeyDialog bucketLease={bucketLease} info={info} takenNames={info.keys.map(key => key.name)} onClose={() => setIsCreatingKey(false)} />
      )}
      {keyToRevoke && <RevokeBucketKeyDialog name={keyToRevoke} bucketLease={bucketLease} onClose={() => setKeyToRevoke(null)} dependencies={d} />}
    </>
  );
};

/** A bucket's order re-lists under the next sequence each time a move or an eviction ends its lease. */
function wasMovedHere(lease: LeaseDto): boolean {
  return lease.oseq > 1;
}

const ConnectionRow: FC<{ label: string; value: string; dependencies: typeof DEPENDENCIES }> = ({ label, value, dependencies: d }) => (
  <>
    <dt className="text-muted-foreground">{label}</dt>
    <dd className="flex min-w-0 items-center gap-1">
      <span className="truncate font-mono text-xs">{value}</span>
      <d.CopyTextToClipboardButton value={value} aria-label={`Copy ${label.toLowerCase()}`} />
    </dd>
  </>
);

const RevokeBucketKeyDialog: FC<{
  name: string;
  bucketLease: Parameters<typeof useRevokeBucketKey>[0];
  onClose: () => void;
  dependencies: typeof DEPENDENCIES;
}> = ({ name, bucketLease, onClose, dependencies: d }) => {
  const revoke = d.useRevokeBucketKey(bucketLease);

  const revokeTheKey = () => {
    revoke.mutate(name, { onSuccess: onClose });
  };

  return (
    <DialogV2 open onOpenChange={isOpen => !isOpen && !revoke.isPending && onClose()}>
      <DialogV2Content className="max-w-[420px]">
        <DialogV2Header>
          <DialogV2Title>Revoke {name}?</DialogV2Title>
          <DialogV2Description>Anything using this key loses access to the bucket at once.</DialogV2Description>
        </DialogV2Header>
        {revoke.isError && <Alert variant="destructive">{bucketRefusalOf(revoke.error) ?? "Couldn't revoke the key. Please try again."}</Alert>}
        <DialogV2Footer>
          <Button type="button" variant="ghost" disabled={revoke.isPending} onClick={onClose}>
            Cancel
          </Button>
          <LoadingButton type="button" variant="destructive" loading={revoke.isPending} onClick={revokeTheKey}>
            Revoke
          </LoadingButton>
        </DialogV2Footer>
      </DialogV2Content>
    </DialogV2>
  );
};
