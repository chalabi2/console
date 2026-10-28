export type BucketKeyAccess = "readwrite" | "read";

export interface BucketKeyInfo {
  name: string;
  access: BucketKeyAccess;
  access_key_id: string;
}

/** A new key, the only answer that ever carries its secret. */
export interface BucketKey extends BucketKeyInfo {
  secret_access_key: string;
}

export interface BucketInfo {
  bucket: string;
  endpoint: string;
  region: string;
  size_bytes: number;
  used_bytes: number;
  keys: BucketKeyInfo[];
}
