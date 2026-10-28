import { isAxiosError } from "axios";

import type { BucketInfo, BucketKey } from "@src/types/bucket";

/** The provider names an access key with a DNS label of at most 32 characters, unique within its bucket. */
const BUCKET_KEY_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]{0,30}[a-z0-9])?$/;

export interface BucketEnvVariable {
  key: string;
  value: string;
  isSecret: boolean;
}

type EnvRow = { id?: string; key: string; value?: string; isSecret?: boolean };

/** The variables a connected bucket gives a service, which leave it together. */
export const BUCKET_ENV_KEYS: readonly string[] = ["AWS_ENDPOINT_URL_S3", "AWS_REGION", "S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];

/** A key named after the service it was made for, so the bucket's page tells which deployment holds it. */
export function bucketKeyNameFor(serviceName: string, suffix: string): string {
  const base = serviceName
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 27)
    .replace(/^-+|-+$/g, "");
  return `${base || "service"}-${suffix}`;
}

/** A variable the service already has takes the new value and stays secret if it was. */
export function withBucketEnv<T extends EnvRow>(env: readonly T[], variables: readonly BucketEnvVariable[], newId: () => string): Array<T | EnvRow> {
  const next: Array<T | EnvRow> = [...env];
  for (const variable of variables) {
    const index = next.findIndex(row => row.key === variable.key);
    if (index === -1) next.push({ id: newId(), ...variable });
    else next[index] = { ...next[index], value: variable.value, isSecret: !!next[index].isSecret || variable.isSecret };
  }
  return next;
}

export function withoutBucketEnv<T extends EnvRow>(env: readonly T[]): T[] {
  return env.filter(row => !BUCKET_ENV_KEYS.includes(row.key));
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
