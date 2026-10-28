import { DeploymentReclamation, MsgMintACT } from "@akashnetwork/chain-sdk/private-types/akash.v1";
import { ResourceUnit } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import { MsgCancelLeaseResize, MsgCloseLease, MsgResizeLease } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";

import type { BillingConfigService } from "@src/billing/services/billing-config/billing-config.service";
import { RpcMessageService } from "./rpc-message.service";

describe(RpcMessageService.name, () => {
  const LEASE = { owner: "akash1owner", dseq: "1234", gseq: 1, oseq: 1, provider: "akash1provider", bseq: 0 };

  describe("getMintACTMsg", () => {
    it("should construct a MsgMintACT message with correct fields", () => {
      const { service } = setup();

      const msg = service.getMintACTMsg({ owner: "akash1abc", amount: 1000000 });

      expect(msg).toEqual({
        typeUrl: `/${MsgMintACT.$type}`,
        value: MsgMintACT.fromPartial({
          owner: "akash1abc",
          to: "akash1abc",
          coinsToBurn: {
            denom: "uakt",
            amount: "1000000"
          }
        })
      });
    });
  });

  describe("getCreateDeploymentMsg", () => {
    const baseOptions = {
      owner: "akash1abc",
      dseq: 123,
      groups: [],
      hash: new Uint8Array(),
      denom: "uakt",
      amount: 1000000
    };

    it("forwards the reclamation block into the message when the SDL declares it", () => {
      const { service } = setup();
      const reclamation = DeploymentReclamation.fromPartial({ minWindow: { seconds: 86400 } });

      const msg = service.getCreateDeploymentMsg({ ...baseOptions, reclamation });

      expect(msg.value.reclamation).toEqual(reclamation);
    });

    it("leaves reclamation unset for an SDL without a reclamation block", () => {
      const { service } = setup();

      const msg = service.getCreateDeploymentMsg(baseOptions);

      expect(msg.value.reclamation).toBeUndefined();
    });
  });

  describe("getResizeLeaseMsg", () => {
    it("asks the lease's provider for the resource units and the manifest version they come with", () => {
      const { service } = setup();
      const resources = [ResourceUnit.fromPartial({ count: 2, price: { denom: "uact", amount: "30000" } })];
      const hash = new Uint8Array([1, 2, 3]);

      const msg = service.getResizeLeaseMsg({ lease: LEASE, resources, hash });

      expect(msg).toEqual({
        typeUrl: `/${MsgResizeLease.$type}`,
        value: MsgResizeLease.fromPartial({ id: { ...LEASE, dseq: 1234n }, resources, hash })
      });
    });
  });

  describe("getCancelLeaseResizeMsg", () => {
    it("withdraws the pending resize of the lease", () => {
      const { service } = setup();

      expect(service.getCancelLeaseResizeMsg(LEASE)).toEqual({
        typeUrl: `/${MsgCancelLeaseResize.$type}`,
        value: MsgCancelLeaseResize.fromPartial({ id: { ...LEASE, dseq: 1234n } })
      });
    });
  });

  describe("getCloseLeaseMsg", () => {
    it("closes the lease it names", () => {
      const { service } = setup();

      expect(service.getCloseLeaseMsg(LEASE)).toEqual({
        typeUrl: `/${MsgCloseLease.$type}`,
        value: MsgCloseLease.fromPartial({ id: { ...LEASE, dseq: 1234n } })
      });
    });
  });

  function setup() {
    const billingConfig = mock<BillingConfigService>();
    billingConfig.get.calledWith("DEPLOYMENT_GRANT_DENOM").mockReturnValue("uact");
    const service = new RpcMessageService(billingConfig);
    return { service };
  }
});
