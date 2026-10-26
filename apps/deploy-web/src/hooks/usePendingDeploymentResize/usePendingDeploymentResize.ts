import { DEPENDENCIES, useNewestDeploymentUpdate } from "@src/hooks/useFollowedActivities/useFollowedActivities";
import type { Activity } from "@src/queries/useLatestActivitiesQuery";

export { DEPENDENCIES };

/** The newest update of the deployment while it waits for the provider to resize the lease, which the user can still withdraw. */
export function usePendingDeploymentResize(dseq: string, dependencies: typeof DEPENDENCIES = DEPENDENCIES): Activity | undefined {
  const newestUpdate = useNewestDeploymentUpdate(dseq, dependencies);

  return newestUpdate?.status === "pending" && newestUpdate.meta.resize ? newestUpdate : undefined;
}
