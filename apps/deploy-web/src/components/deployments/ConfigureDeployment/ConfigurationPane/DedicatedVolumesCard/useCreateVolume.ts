"use client";
import { useState } from "react";
import { extractApiErrorMessage } from "@akashnetwork/openapi-sdk";
import { useQueryClient } from "@tanstack/react-query";

import { useServices } from "@src/context/ServicesProvider";
import { useWallet } from "@src/context/WalletProvider";
import { QueryKeys } from "@src/queries/queryKeys";
import { BID_POLL_INTERVAL, useListBids } from "@src/queries/useListBids";

export const DEPENDENCIES = { useServices, useListBids, useWallet, useQueryClient };

/** The escrow a volume's deployment opens with, as the configure flow opens a deployment's. */
const VOLUME_DEPOSIT = 0.5;

const CREATE_FAILED_MESSAGE = "The volume could not be created. Try again in a moment.";
const LEASE_FAILED_MESSAGE = "The volume could not be leased from this provider. Choose another or try again.";

export type CreateVolumeStep =
  | { kind: "editing"; error?: string }
  | { kind: "creating" }
  | { kind: "choosing"; dseq: string; error?: string }
  | { kind: "leasing"; dseq: string };

export type VolumeBid = { provider: string; perBlockAmount: string; denom: string };

/** A volume's deployment comes first and its lease second, since the service mounting it can only bid with the provider that holds it. */
export function useCreateVolume(dependencies: typeof DEPENDENCIES = DEPENDENCIES) {
  const { api } = dependencies.useServices();
  const { address } = dependencies.useWallet();
  const queryClient = dependencies.useQueryClient();
  const createDeployment = api.v1.createDeployment.useMutation();
  const createLease = api.v1.createLease.useMutation();
  const closeDeployment = api.v1.closeDeployment.useMutation();
  const [step, setStep] = useState<CreateVolumeStep>({ kind: "editing" });
  const { data: bids } = dependencies.useListBids(step.kind === "choosing" ? step.dseq : undefined, { refetchInterval: BID_POLL_INTERVAL });

  async function create(input: { name: string; sdl: string }) {
    setStep({ kind: "creating" });
    try {
      const { data } = await createDeployment.mutateAsync({ data: { sdl: input.sdl, name: input.name, deposit: VOLUME_DEPOSIT } });
      setStep({ kind: "choosing", dseq: data.dseq });
    } catch (error) {
      setStep({ kind: "editing", error: extractApiErrorMessage(error) ?? CREATE_FAILED_MESSAGE });
    }
  }

  async function lease(provider: string): Promise<string | undefined> {
    if (step.kind !== "choosing") return;

    const { dseq } = step;
    setStep({ kind: "leasing", dseq });
    try {
      await createLease.mutateAsync({ leases: [{ dseq, gseq: 1, oseq: 1, provider }] });
    } catch (error) {
      setStep({ kind: "choosing", dseq, error: extractApiErrorMessage(error) ?? LEASE_FAILED_MESSAGE });
      return;
    }

    setStep({ kind: "editing" });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QueryKeys.getDeploymentListKey(address) }),
      queryClient.invalidateQueries({ queryKey: QueryKeys.getAllLeasesKey(address) })
    ]);
    return dseq;
  }

  /** A volume's deployment left without a lease is closed rather than left holding its deposit. */
  async function abandon() {
    if (step.kind === "choosing") await closeDeployment.mutateAsync({ dseq: step.dseq }).catch(() => undefined);
    setStep({ kind: "editing" });
  }

  return {
    step,
    bids: (bids?.data ?? []).flatMap(({ bid }) =>
      bid.state === "open" ? [{ provider: bid.id.provider, perBlockAmount: bid.price.amount, denom: bid.price.denom } satisfies VolumeBid] : []
    ),
    create,
    lease,
    abandon
  };
}
