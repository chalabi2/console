import { useQueryClient } from "@tanstack/react-query";

import { useServices } from "@src/context/ServicesProvider";
import { useWallet } from "@src/context/WalletProvider";
import { QueryKeys } from "./queryKeys";
import { BID_POLL_INTERVAL, useListBids } from "./useListBids";

export const DEPENDENCIES = { useServices, useWallet, useQueryClient, useListBids };

export type VolumeOrderBid = { provider: string; gseq: number; oseq: number; perBlockAmount: string; denom: string };

/** Starts moving a volume: its lease closes through its reclamation window, after which providers bid to take it. */
export function useMoveVolume(dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { api } = dependencies.useServices();
  const refetchVolumes = useRefetchVolumes(dependencies);

  return api.v1.moveVolume.useMutation({ onSuccess: refetchVolumes });
}

/** The open bids on a volume's order, polled while it waits for a provider. */
export function useVolumeBids(dseq: string, dependencies: typeof DEPENDENCIES = DEPENDENCIES): VolumeOrderBid[] {
  const { data } = dependencies.useListBids(dseq, { refetchInterval: BID_POLL_INTERVAL });

  return (data?.data ?? []).flatMap(({ bid }) =>
    bid.state === "open" ? [{ provider: bid.id.provider, gseq: bid.id.gseq, oseq: bid.id.oseq, perBlockAmount: bid.price.amount, denom: bid.price.denom }] : []
  );
}

/** Leases a volume from the provider chosen among its bids. */
export function useLeaseVolume(dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { api } = dependencies.useServices();
  const refetchVolumes = useRefetchVolumes(dependencies);

  return api.v1.createLease.useMutation({ onSuccess: refetchVolumes });
}

function useRefetchVolumes(dependencies: typeof DEPENDENCIES) {
  const { address } = dependencies.useWallet();
  const queryClient = dependencies.useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: QueryKeys.getDeploymentListKey(address) }),
      queryClient.invalidateQueries({ queryKey: QueryKeys.getAllLeasesKey(address) })
    ]);
}
