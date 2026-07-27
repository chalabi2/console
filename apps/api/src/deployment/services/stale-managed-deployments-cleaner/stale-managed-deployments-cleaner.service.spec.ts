import { describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";

import type { BillingConfig } from "@src/billing/providers";
import type { UserWalletRepository } from "@src/billing/repositories";
import type { ManagedUserWalletService, RpcMessageService } from "@src/billing/services";
import type { ChainErrorService } from "@src/billing/services/chain-error/chain-error.service";
import type { ManagedSignerService } from "@src/billing/services/managed-signer/managed-signer.service";
import type { BlockRepository } from "@src/chain/repositories/block.repository";
import type { LoggerService } from "@src/core/providers/logging.provider";
import { ErrorService } from "@src/core/services/error/error.service";
import type { DeploymentRepository } from "@src/deployment/repositories/deployment/deployment.repository";
import { StaleManagedDeploymentsCleanerService } from "./stale-managed-deployments-cleaner.service";

import { createUserWallet } from "@test/seeders/user-wallet.seeder";

describe(StaleManagedDeploymentsCleanerService.name, () => {
  it("swallows an unsettleable escrow error without refilling fees or retrying", async () => {
    const { service, managedSignerService, managedUserWalletService } = setup({
      executeDerivedTx: vi
        .fn()
        .mockRejectedValue(new Error("Query failed with (6): rpc error: code = Unknown desc = recovered: negative decimal coin amount: -2.000000000000000000")),
      isUnsettleableError: true
    });

    await expect(service.cleanup({ concurrency: 1 })).resolves.toBeUndefined();

    expect(managedSignerService.executeDerivedTx).toHaveBeenCalledTimes(1);
    expect(managedUserWalletService.authorizeSpending).not.toHaveBeenCalled();
  });

  it("refills fees and retries when the wallet is not allowed to pay fees", async () => {
    const executeDerivedTx = vi.fn().mockRejectedValueOnce(new Error("not allowed to pay fees")).mockResolvedValueOnce(undefined);
    const { service, managedUserWalletService } = setup({ executeDerivedTx });

    await service.cleanup({ concurrency: 1 });

    expect(managedUserWalletService.authorizeSpending).toHaveBeenCalledTimes(1);
    expect(executeDerivedTx).toHaveBeenCalledTimes(2);
  });

  it("rethrows unrelated errors into the wallet error handler without retrying", async () => {
    const { service, managedSignerService, managedUserWalletService } = setup({
      executeDerivedTx: vi.fn().mockRejectedValue(new Error("some unexpected failure")),
      isUnsettleableError: false
    });

    await expect(service.cleanup({ concurrency: 1 })).resolves.toBeUndefined();

    expect(managedSignerService.executeDerivedTx).toHaveBeenCalledTimes(1);
    expect(managedUserWalletService.authorizeSpending).not.toHaveBeenCalled();
  });

  function setup(input?: { executeDerivedTx?: ManagedSignerService["executeDerivedTx"]; isUnsettleableError?: boolean }) {
    const wallet = createUserWallet({ id: 123, address: "akash1test" });

    const userWalletRepository = mock<UserWalletRepository>({
      paginate: vi.fn(async (_options, cb) => {
        await cb([wallet]);
      }) as UserWalletRepository["paginate"]
    });
    const deploymentRepository = mock<DeploymentRepository>({
      findStaleDeployments: vi.fn().mockResolvedValue([{ dseq: 456 }])
    });
    const blockRepository = mock<BlockRepository>({
      getLatestProcessedHeight: vi.fn().mockResolvedValue(1_000_000)
    });
    const rpcMessageService = mock<RpcMessageService>();
    const managedSignerService = mock<ManagedSignerService>({
      executeDerivedTx: input?.executeDerivedTx ?? vi.fn().mockResolvedValue(undefined)
    });
    const managedUserWalletService = mock<ManagedUserWalletService>();
    const config = mock<BillingConfig>({ FEE_ALLOWANCE_REFILL_AMOUNT: 1000 });
    const errorService = new ErrorService(mock<LoggerService>());
    const chainErrorService = mock<ChainErrorService>({
      isUnsettleableDeploymentError: vi.fn().mockReturnValue(input?.isUnsettleableError ?? false)
    });

    const service = new StaleManagedDeploymentsCleanerService(
      userWalletRepository,
      deploymentRepository,
      blockRepository,
      rpcMessageService,
      managedSignerService,
      config,
      managedUserWalletService,
      errorService,
      chainErrorService
    );

    return {
      service,
      userWalletRepository,
      deploymentRepository,
      blockRepository,
      rpcMessageService,
      managedSignerService,
      managedUserWalletService,
      chainErrorService
    };
  }
});
