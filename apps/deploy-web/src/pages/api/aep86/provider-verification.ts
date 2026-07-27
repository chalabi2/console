import { fetchProviderVerificationFeed } from "@src/components/provider-verification/providerVerification.server";
import { defineApiHandler } from "@src/lib/nextjs/defineApiHandler/defineApiHandler";

export default defineApiHandler({
  route: "/api/aep86/provider-verification",
  method: "GET",
  async handler({ res, services }) {
    const restApiUrl = services.privateConfig.AEP86_REST_API_URL;
    if (!restApiUrl) {
      res.status(503).json({ message: "AEP-86 testnet REST endpoint is not configured" });
      return;
    }

    try {
      const feed = await fetchProviderVerificationFeed(restApiUrl);
      res.setHeader("Cache-Control", "no-store");
      res.status(200).json(feed);
    } catch (error) {
      services.logger.error({ event: "AEP86_PROVIDER_VERIFICATION_FETCH_ERROR", error });
      res.status(502).json({ message: "Unable to read provider verification state from the AEP-86 testnet" });
    }
  }
});
