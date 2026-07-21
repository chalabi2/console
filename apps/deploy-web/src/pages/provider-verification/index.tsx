import Layout from "@src/components/layout/Layout";
import { ProviderVerificationPreview } from "@src/components/provider-verification/ProviderVerificationPreview";
import { CustomNextSeo } from "@src/components/shared/CustomNextSeo";
import { definePublicPage } from "@src/lib/pages/definePublicPage";
import { domainName } from "@src/utils/urlUtils";

function ProviderVerificationPage() {
  return (
    <Layout containerClassName="max-w-[1500px]">
      <CustomNextSeo title="Provider verification" url={`${domainName}/provider-verification`} description="Provider verification preview for Akash Console." />
      <ProviderVerificationPreview />
    </Layout>
  );
}

export default definePublicPage(ProviderVerificationPage);
