import { useNavigate } from "@tanstack/react-router";
import { WalletCards } from "lucide-react";
import { useTranslation } from "react-i18next";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { useMeContext } from "@/auth/me.js";
import { canRecordFinance, canRecordRevenue } from "@/finance/permissions.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { FinanceEntriesScreen } from "./FinanceEntriesScreen.js";

/**
 * `/finance/record` is Entries with the record panel open over it: recording
 * an entry is a fact, so it opens in the side panel with the list behind as
 * context. Closing the panel, or recording, lands on Entries.
 */
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

  const toEntries = () => void navigate({ to: "/finance/entries" });

  return (
    <>
      <FinanceEntriesScreen />
      <RecordEntryForm
        surface="sheet"
        // role-config: a role that records expenses only gets no revenue tab.
        lockDirection={!canRecordRevenue(me?.role, me?.enabledModules)}
        onRecorded={toEntries}
        onDismiss={toEntries}
      />
    </>
  );
}
