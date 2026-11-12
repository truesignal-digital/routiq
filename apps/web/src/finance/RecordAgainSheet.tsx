import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { useEntry } from "@/finance/useEntry.js";
import { useMoneyRefresh } from "@/lib/useMoneyRefresh.js";

/**
 * After a "wrong details" cancellation from a list: the recording form,
 * pre-filled from the cancelled entry. The form reads nothing back, so once
 * the new entry is recorded this refreshes every money read (ADR-0001) and
 * the list shows it without a reload, as the detail page does.
 */
export function RecordAgainSheet({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const refreshMoney = useMoneyRefresh();
  const entryQuery = useEntry(entryId);
  if (entryQuery.data === undefined) return null;
  return (
    <RecordEntryForm
      surface="sheet"
      recordAgainFrom={entryQuery.data}
      onRecorded={() => void refreshMoney().finally(onClose)}
      onDismiss={onClose}
    />
  );
}
