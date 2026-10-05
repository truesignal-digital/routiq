import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import { canReadFinanceEntries, canRecordFinance, canRecordRevenue } from "@/finance/permissions.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";

export function FinanceRecordScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const me = useMeContext();
  const canRecord = canRecordFinance(me?.role, me?.enabledModules);
  // A role that records but reads no entries stays here on a fresh form: the
  // entries list would only deny it.
  const canRead = canReadFinanceEntries(me?.role, me?.enabledModules);
  const [formKey, setFormKey] = useState(0);

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
          key={formKey}
          surface="page"
          // role-config: a role that records expenses only gets no revenue tab.
          lockDirection={!canRecordRevenue(me?.role, me?.enabledModules)}
          onRecorded={() =>
            canRead ? void navigate({ to: "/finance/entries" }) : setFormKey((key) => key + 1)
          }
        />
      </div>
    </PageContainer>
  );
}
