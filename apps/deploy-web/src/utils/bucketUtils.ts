import { isAxiosError } from "axios";

import type { BucketInfo, BucketKey } from "@src/types/bucket";

/** The provider names an access key with a DNS label of at most 32 characters, unique within its bucket. */
const BUCKET_KEY_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?$/;

export interface BucketEnvVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

export function bucketKeyNameErrorOf(name: string, takenNames: readonly string[]): string | undefined {
  if (!BUCKET_KEY_NAME_PATTERN.test(name)) return "Use up to 32 lowercase letters, digits and dashes, starting and ending with a letter or digit.";
  if (takenNames.includes(name)) return `This bucket already has a key named ${name}.`;
}

/** The provider explains a refused bucket request in plain text meant for the bucket's owner. */
export function bucketRefusalOf(error: unknown): string | undefined {
  if (!isAxiosError(error) || !error.response || error.response.status >= 500) return undefined;

  const reason = typeof error.response.data === "string" ? error.response.data.trim() : "";
  return reason ? `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.` : undefined;
}

export function isBucketBeingProvisioned(error: unknown): boolean {
  return isAxiosError(error) && error.response?.status === 503;
}

/** The variables standard S3 clients and SDKs read, with the key itself kept secret. */
export function bucketEnvOf(
  info: Pick<BucketInfo, "endpoint" | "region" | "bucket">,
  key: Pick<BucketKey, "access_key_id" | "secret_access_key">
): BucketEnvVariable[] {
  return [
    { key: "AWS_ENDPOINT_URL_S3", value: info.endpoint, isSecret: false },
    { key: "AWS_REGION", value: info.region, isSecret: false },
    { key: "S3_BUCKET", value: info.bucket, isSecret: false },
    { key: "AWS_ACCESS_KEY_ID", value: key.access_key_id, isSecret: true },
    { key: "AWS_SECRET_ACCESS_KEY", value: key.secret_access_key, isSecret: true }
  ];
}
