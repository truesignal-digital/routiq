import { useTranslation } from "react-i18next";
import { LoadingState } from "@/components/page";
import { PageContainer } from "@/components/page-container";

/** A screen whose reads are still loading after the router's pending delay. */
export function RoutePending() {
  const { t } = useTranslation();
  return (
    <PageContainer width="wide">
      <LoadingState label={t("common.loading")} rows={4} />
    </PageContainer>
  );
}
