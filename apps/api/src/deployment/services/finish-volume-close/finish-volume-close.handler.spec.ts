import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";

import type { WalletInitialized } from "@src/billing/repositories";
import type { BillingConfigService } from "@src/billing/services/billing-config/billing-config.service";
import type { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import { RpcMessageService } from "@src/billing/services/rpc-message-service/rpc-message.service";
import type { WalletReaderService } from "@src/billing/services/wallet-reader/wallet-reader.service";
import type { DeploymentResponse } from "@src/deployment/http-schemas/deployment.schema";
import type { DeploymentReaderService } from "@src/deployment/services/deployment-reader/deployment-reader.service";
import { FinishVolumeCloseHandler } from "./finish-volume-close.handler";

import { mockConfigService } from "@test/mocks/config-service.mock";

describe(FinishVolumeCloseHandler.name, () => {
  const PAYLOAD = { walletId: 7, dseq: "100", version: 1 as const };

  it("keeps one waiting finish per volume", () => {
    const { handler } = setup();

    expect(handler.policy).toBe("short");
  });

  it("asks only for the right to sign with the wallet that closed the volume", () => {
    const { handler } = setup();

    expect(handler.requiresPermission(PAYLOAD)).toEqual([{ action: "sign", subject: "UserWallet", conditions: { id: 7 } }]);
  });

  it("sends the close that ends the volume's close, as completing the close recorded when it was first sent", async () => {
    const { handler, walletReaderService, signerService, wallet, rpcMessageService } = setup();

    await handler.handle(PAYLOAD);

    expect(walletReaderService.getWalletById).toHaveBeenCalledWith(7);
    expect(signerService.executeDecodedTxByUserWallet).toHaveBeenCalledWith(wallet, [rpcMessageService.getCloseDeploymentMsg("akash1owner", "100")], {
      completesRecordedClose: true
    });
  });

  it("sends nothing for a volume the chain already closed", async () => {
    const { handler, signerService } = setup({ onChain: "closed" });

    await handler.handle(PAYLOAD);

    expect(signerService.executeDecodedTxByUserWallet).not.toHaveBeenCalled();
  });

  function setup(input: { onChain?: "active" | "closed" } = {}) {
    const wallet = mock<WalletInitialized>({ id: 7, address: "akash1owner" });
    const walletReaderService = mock<WalletReaderService>();
    walletReaderService.getWalletById.mockResolvedValue(wallet);
    const deploymentReaderService = mock<DeploymentReaderService>();
    deploymentReaderService.findByWalletAndDseqWithoutProviderStatus.mockResolvedValue(
      mock<DeploymentResponse>({ deployment: { state: input.onChain ?? "active", id: { owner: "akash1owner", dseq: "100" } } })
    );
    const signerService = mock<ManagedSignerService>();
    const rpcMessageService = new RpcMessageService(mockConfigService<BillingConfigService>({ DEPLOYMENT_GRANT_DENOM: "uakt" }));
    const handler = new FinishVolumeCloseHandler(walletReaderService, deploymentReaderService, rpcMessageService, signerService);

    return { handler, walletReaderService, signerService, wallet, rpcMessageService };
  }
});
