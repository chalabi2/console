import { netConfig } from "@akashnetwork/net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { services as rootContainer } from "@src/services/app-di-container/browser-di-container";
import networkStore from "@src/store/networkStore";
import { ServicesProvider, useServices } from "./ServicesProvider";

import { render, screen } from "@testing-library/react";

describe(ServicesProvider.name, () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes the chain api base url on the very first render", () => {
    setup({ chainRestApiUrl: undefined });

    expect(screen.getByTestId("chain-api-base-url")).toHaveTextContent(netConfig.getBaseAPIUrl(networkStore.selectedNetworkId));
  });

  it("reads the chain through the node the environment names, as a local chain needs", () => {
    setup({ chainRestApiUrl: "http://localhost:31317" });

    expect(screen.getByTestId("chain-api-base-url")).toHaveTextContent("http://localhost:31317");
  });

  function setup(input: { chainRestApiUrl: string | undefined }) {
    const publicConfig = rootContainer.publicConfig;
    vi.spyOn(rootContainer, "publicConfig", "get").mockReturnValue({ ...publicConfig, NEXT_PUBLIC_CHAIN_REST_API_URL: input.chainRestApiUrl });

    render(
      <ServicesProvider>
        <ChainApiBaseUrlProbe />
      </ServicesProvider>
    );
  }
});

function ChainApiBaseUrlProbe() {
  const { chainApiHttpClient } = useServices();
  return <span data-testid="chain-api-base-url">{chainApiHttpClient.defaults.baseURL}</span>;
}
