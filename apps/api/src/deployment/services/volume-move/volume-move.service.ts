import createError from "http-errors";
import { singleton } from "tsyringe";

import { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import { RpcMessageService } from "@src/billing/services/rpc-message-service/rpc-message.service";
import { WalletReaderService } from "@src/billing/services/wallet-reader/wallet-reader.service";
import { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";

/** Moves a volume, disk or bucket, to another provider by closing its lease, which the chain reclaims through its window and then lists for new bids, rather than ending the volume. */
@singleton()
export class VolumeMoveService {
  constructor(
    private readonly walletReaderService: WalletReaderService,
    private readonly deploymentReaderService: DeploymentReaderService,
    private readonly rpcMessageService: RpcMessageService,
    private readonly signerService: ManagedSignerService
  ) {}

  async moveByUserIdAndDseq(userId: string, dseq: string): Promise<void> {
    const wallet = await this.walletReaderService.getWalletByUserId(userId);
    const { deployment, groups } = await this.deploymentReaderService.findWithGroupSpecsByWalletAndDseq(wallet, dseq);
    if (!groups) throw createError(503, "The deployment could not be read from the chain. Try again in a moment");

    const group = groups.find(candidate => candidate.group_spec.volume);

    if (!group?.group_spec.volume) throw createError(400, "Only a volume can be moved to another provider");

    const lease = deployment.leases.find(candidate => candidate.id.gseq === group.id.gseq && candidate.state === "active");

    if (!lease) throw createError(409, "This volume has no active lease to move: it is already moving, closing or unleased");

    await this.signerService.executeDecodedTxByUserWallet(wallet, [this.rpcMessageService.getCloseLeaseMsg(lease.id)], { actingUserId: userId });
  }
}
