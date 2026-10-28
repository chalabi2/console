/** Where a volume lease's volume stands on its provider. */
export interface VolumeStatus {
  /** The provider's phase for it; `Importing` while a moved volume's data is copied in. */
  phase: string;
  size_bytes: number;
  /** The provider the data is still being copied from. */
  import_from?: string;
  attached_lease?: string;
  retained_until?: string;
}
