import { useNavigate } from "@tanstack/react-router";
import { WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import { canRecordFinance } from "@/finance/permissions.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";

export function FinanceRecordScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canRecord = canRecordFinance(me?.role, me?.enabledModules);

  if (me !== undefined && !canRecord) {
    return (
      <PermissionDenied
        title={t("finance.record.title")}
        icon={<WalletCards className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("FINANCE"))}
      />
    );
  }

  return (
    // Wide like every other finance page so the heading lines up, but the
    // fields stay in a readable column instead of stretching to the edge.
    <PageContainer width="wide">
      <PageHeader title={t("finance.record.title")} />

      <div className="max-w-xl">
        <RecordEntryForm
          surface="page"
          onRecorded={() => void navigate({ to: "/finance/entries" })}
        />
      </div>
    </PageContainer>
  );
}
