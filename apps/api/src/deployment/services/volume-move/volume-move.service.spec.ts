import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";

import type { WalletInitialized } from "@src/billing/repositories";
import type { BillingConfigService } from "@src/billing/services/billing-config/billing-config.service";
import type { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import { RpcMessageService } from "@src/billing/services/rpc-message-service/rpc-message.service";
import type { WalletReaderService } from "@src/billing/services/wallet-reader/wallet-reader.service";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import type { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";
import { VolumeMoveService } from "./volume-move.service";

import { createAkashAddress } from "@test/seeders/akash-address.seeder";
import { createDeploymentInfoGroupSeed } from "@test/seeders/deployment-info.seeder";
import { createLeaseApiResponse } from "@test/seeders/lease-api-response.seeder";

const DSEQ = "4321";
const ACTING_USER = "acting-user";

describe(VolumeMoveService.name, () => {
  it("closes the volume's active lease with the user's wallet, as that user", async () => {
    const { service, signerService, walletReaderService, deploymentReaderService, wallet, rpcMessageService, activeLease } = setup({});

    await service.moveByUserIdAndDseq(ACTING_USER, DSEQ);

    expect(walletReaderService.getWalletByUserId).toHaveBeenCalledWith(ACTING_USER);
    expect(deploymentReaderService.findWithGroupSpecsByWalletAndDseq).toHaveBeenCalledWith(wallet, DSEQ);
    expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(wallet, [rpcMessageService.getCloseLeaseMsg(activeLease.id)], {
      actingUserId: ACTING_USER
    });
  });

  it("closes the lease of the volume's current order, not one a move already closed", async () => {
    const { service, signerService, wallet, rpcMessageService, activeLease } = setup({ closedEarlierLease: true });

    await service.moveByUserIdAndDseq(ACTING_USER, DSEQ);

    expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(wallet, [rpcMessageService.getCloseLeaseMsg(activeLease.id)], expect.anything());
    expect(activeLease.id.oseq).toBe(2);
  });

  it("refuses a deployment that is not a volume, signing nothing", async () => {
    const { service, signerService } = setup({ volume: null });

    await expect(service.moveByUserIdAndDseq(ACTING_USER, DSEQ)).rejects.toMatchObject({
      status: 400,
      message: "Only a volume can be moved to another provider"
    });
    expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
  });

  it("moves a bucket the same way, closing its active lease", async () => {
    const { service, signerService, wallet, rpcMessageService, activeLease } = setup({ access: "bucket" });

    await service.moveByUserIdAndDseq(ACTING_USER, DSEQ);

    expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(wallet, [rpcMessageService.getCloseLeaseMsg(activeLease.id)], {
      actingUserId: ACTING_USER
    });
  });

  it("refuses a volume whose lease is already being reclaimed", async () => {
    const { service, signerService } = setup({ leaseState: "reclaiming" });

    await expect(service.moveByUserIdAndDseq(ACTING_USER, DSEQ)).rejects.toMatchObject({
      status: 409,
      message: "This volume has no active lease to move: it is already moving, closing or unleased"
    });
    expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
  });

  it("refuses a volume whose own lease is not active, whatever another group's lease is", async () => {
    const { service, signerService } = setup({ leaseState: "reclaiming", activeLeaseOfAnotherGroup: true });

    await expect(service.moveByUserIdAndDseq(ACTING_USER, DSEQ)).rejects.toMatchObject({ status: 409 });
    expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
  });

  it("refuses when only the database could describe the deployment", async () => {
    const { service, signerService } = setup({ groupsUnknown: true });

    await expect(service.moveByUserIdAndDseq(ACTING_USER, DSEQ)).rejects.toMatchObject({
      status: 503,
      message: "The deployment could not be read from the chain. Try again in a moment"
    });
    expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
  });

  function setup(input: {
    volume?: null;
    access?: string;
    leaseState?: string;
    closedEarlierLease?: boolean;
    activeLeaseOfAnotherGroup?: boolean;
    groupsUnknown?: boolean;
  }) {
    const owner = createAkashAddress();
    const wallet = mock<WalletInitialized>({ address: owner });
    const group = createDeploymentInfoGroupSeed({ owner, dseq: DSEQ, gseq: 1 });
    const groups = [
      {
        ...group,
        group_spec: {
          ...group.group_spec,
          volume:
            input.volume === null ? null : { vid: "pgdata", access: input.access, reclaim: "retain", retention: "3600s", max_attachments: 1, max_replicas: 0 }
        }
      }
    ];
    const activeLease = createLeaseApiResponse({
      owner,
      dseq: DSEQ,
      gseq: 1,
      oseq: input.closedEarlierLease ? 2 : 1,
      state: input.leaseState ?? "active"
    }).lease;
    const leases = [
      ...(input.closedEarlierLease ? [createLeaseApiResponse({ owner, dseq: DSEQ, gseq: 1, oseq: 1, state: "closed" }).lease] : []),
      ...(input.activeLeaseOfAnotherGroup ? [createLeaseApiResponse({ owner, dseq: DSEQ, gseq: 2, oseq: 1, state: "active" }).lease] : []),
      activeLease
    ];

    const walletReaderService = mock<WalletReaderService>();
    walletReaderService.getWalletByUserId.mockResolvedValue(wallet);
    const deploymentReaderService = mock<DeploymentReaderService>();
    deploymentReaderService.findWithGroupSpecsByWalletAndDseq.mockResolvedValue({
      deployment: mock<DeploymentResponse>({ leases: leases.map(lease => ({ ...lease, status: null })) }),
      groupSpecs: null,
      groups: input.groupsUnknown ? null : groups
    });
    const rpcMessageService = new RpcMessageService(mock<BillingConfigService>());
    const signerService = mock<ManagedSignerService>();
    const service = new VolumeMoveService(walletReaderService, deploymentReaderService, rpcMessageService, signerService);

    return { service, signerService, walletReaderService, deploymentReaderService, wallet, rpcMessageService, activeLease };
  }
});
