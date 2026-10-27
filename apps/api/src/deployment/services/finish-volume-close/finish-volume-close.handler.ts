import { singleton } from "tsyringe";

import { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import { RpcMessageService } from "@src/billing/services/rpc-message-service/rpc-message.service";
import { WalletReaderService } from "@src/billing/services/wallet-reader/wallet-reader.service";
import type { JobHandler, JobPayload, JobPermissions } from "@src/core";
import { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";
import { FinishVolumeClose } from "./finish-volume-close.job";

@singleton()
export class FinishVolumeCloseHandler implements JobHandler<FinishVolumeClose> {
  public readonly accepts = FinishVolumeClose;

  /** One waiting finish per volume, so a close followed up twice sends its second close once. */
  public readonly policy = "short";

  constructor(
    private readonly walletReaderService: WalletReaderService,
    private readonly deploymentReaderService: DeploymentReaderService,
    private readonly rpcMessageService: RpcMessageService,
    private readonly signerService: ManagedSignerService
  ) {}

  requiresPermission({ walletId }: JobPayload<FinishVolumeClose>): JobPermissions {
    return [{ action: "sign", subject: "UserWallet", conditions: { id: walletId } }];
  }

  /** A close the chain refuses because its block time has yet to reach the deadline throws, so the retry sends it again. */
  async handle({ walletId, dseq }: JobPayload<FinishVolumeClose>): Promise<void> {
    const wallet = await this.walletReaderService.getWalletById(walletId);
    const deployment = await this.deploymentReaderService.findByWalletAndDseqWithoutProviderStatus(wallet, dseq);
    if (deployment.deployment.state === "closed") return;

    await this.signerService.executeDecodedTxByUserWallet(wallet, [this.rpcMessageService.getCloseDeploymentMsg(wallet.address, dseq)], {
      completesRecordedClose: true
    });
  }
}
