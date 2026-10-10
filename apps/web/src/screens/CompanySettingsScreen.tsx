import { Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import { ApprovalSettings } from "@/settings/ApprovalSettings.js";
import { canManageCompanySettings } from "@/settings/permissions.js";

/** Company → Company settings: rules for everyone in the company, Direction's to set (#354). */
export function CompanySettingsScreen() {
  const { t } = useTranslation();
  const me = useMeContext();

  if (me === undefined) return null;
  if (!canManageCompanySettings(me.role)) {
    return (
      <PermissionDenied
        title={t("settings.title")}
        icon={<Settings className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader title={t("settings.title")} />
      <p className="mt-2 text-sm text-muted-foreground">{t("settings.description")}</p>
      <div className="mt-6">
        <ApprovalSettings />
      </div>
    </PageContainer>
  );
}
