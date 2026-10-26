import { MsgAccountDeposit } from "@akashnetwork/chain-sdk/private-types/akash.v1";
import { MsgCreateDeployment } from "@akashnetwork/chain-sdk/private-types/akash.v1beta4";
import { MsgCancelLeaseResize, MsgResizeLease } from "@akashnetwork/chain-sdk/private-types/akash.v1beta5";
import { MsgGrant } from "@akashnetwork/chain-sdk/private-types/cosmos.v1beta1";
import type { Registry } from "@cosmjs/proto-signing";
import type { FactoryProvider } from "@nestjs/common";
import { describe, expect, it } from "vitest";

import { RegistryProvider } from "./registry.provider";

describe("RegistryProvider", () => {
  it("registers the messages of every akash and cosmos namespace under their type urls", () => {
    const registry = setup();

    expect(registry.lookupType(`/${MsgAccountDeposit.$type}`)).toBe(MsgAccountDeposit);
    expect(registry.lookupType(`/${MsgCreateDeployment.$type}`)).toBe(MsgCreateDeployment);
    expect(registry.lookupType(`/${MsgGrant.$type}`)).toBe(MsgGrant);
  });

  it("registers the lease resize messages", () => {
    const registry = setup();

    expect(registry.lookupType(`/${MsgResizeLease.$type}`)).toBe(MsgResizeLease);
    expect(registry.lookupType(`/${MsgCancelLeaseResize.$type}`)).toBe(MsgCancelLeaseResize);
  });

  function setup() {
    return (RegistryProvider as FactoryProvider<Registry>).useFactory() as Registry;
  }
});
