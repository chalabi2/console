import { VolumesPage } from "@src/components/volumes/VolumesPage/VolumesPage";
import { defineServerSideProps } from "@src/lib/nextjs/defineServerSideProps/defineServerSideProps";
import { isFeatureEnabled } from "@src/lib/nextjs/pageGuards/pageGuards";

export default VolumesPage;

export const getServerSideProps = defineServerSideProps({
  route: "/volumes",
  if: context => isFeatureEnabled("dedicated_volumes", context)
});
