import { useQueryClient } from "@tanstack/react-query";
import { useActiveSession } from "@/auth/store.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { useEntry } from "@/finance/useEntry.js";

/**
 * After a "wrong details" cancellation from a list: the recording form,
 * pre-filled from the cancelled entry. The form reads nothing back, so once
 * the new entry is recorded this refreshes every finance read (ADR-0001) and
 * the list shows it without a reload, as the detail page does.
 */
export function RecordAgainSheet({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const entryQuery = useEntry(entryId);
  if (entryQuery.data === undefined) return null;
  return (
    <RecordEntryForm
      surface="sheet"
      recordAgainFrom={entryQuery.data}
      onRecorded={() =>
        void queryClient
          .invalidateQueries({ queryKey: ["ws", session?.workspaceSlug, "finance"] })
          .finally(onClose)
      }
      onDismiss={onClose}
    />
  );
}
