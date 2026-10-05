import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { formatMoney, localizedLabel } from "@/lib/format.js";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { RecordHistorySheet } from "@/components/record-history-sheet.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { useMeContext } from "@/auth/me.js";
import { useActiveSession } from "@/auth/store.js";
import { useEntry } from "@/finance/useEntry.js";
import { canEditPendingEntry, canReadFinance, canReverseEntry } from "@/finance/permissions.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { ReverseEntryForm } from "@/finance/EntryDecisionForms.js";
import { ReversalLink } from "@/finance/ReversalLink.js";
import { OtherBranchNotice } from "@/shell/BranchScopeNotices.js";

export function FinanceEntryDetailScreen() {
  const { t } = useTranslation();
  const me = useMeContext();
  if (me === undefined) return <LoadingState label={t("finance.entries.loading")} />;
  if (!canReadFinance(me.role, me.enabledModules)) {
    return <PermissionDenied title={t("finance.entries.detail.title")}
      icon={<FileText className="size-7" aria-hidden />}
      code={deniedCode(me.enabledModules.includes("FINANCE"))} />;
  }
  return <FinanceEntryDetailContent />;
}

function FinanceEntryDetailContent() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const { entryId } = useParams({ from: "/app/finance/entries/$entryId" });
  const navigate = useNavigate();
  const me = useMeContext();

  const entryQuery = useEntry(entryId);
  // `?reverse=1` is how the entries list's ⋯ menu hands an operator straight
  // into the dialog instead of duplicating it there.
  const { reverse: openReverse } = useSearch({
    from: "/app/finance/entries/$entryId",
  });
  const [reverseOpen, setReverseOpen] = useState(openReverse === true);
  const [editOpen, setEditOpen] = useState(false);
  const queryClient = useQueryClient();
  const session = useActiveSession();

  const labelOf = (item: { labelFr: string; labelEn: string }) =>
    localizedLabel(item);

  const canReverse = canReverseEntry(me?.role, entryQuery.data?.status);
  // role-config: the author alone, while it waits, and only an entry this
  // single-line form can write back whole.
  const canEdit =
    canEditPendingEntry(entryQuery.data, {
      principalId: me?.principalId,
      role: me?.role,
      enabledModules: me?.enabledModules,
    }) && entryQuery.data?.postings.length === 1;

  /** ADR-0001: server truth after the save or the conflict, never a local patch. */
  const refreshFinance = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "finance"],
    });
  };

  return (
    <PageContainer>
      <PageHeader
        title={t("finance.entries.detail.title")}
        actions={
          <RecordHistorySheet entityType="financial_entry" entityId={entryId} />
        }
      />

      {entryQuery.isPending ? (
        <LoadingState className="mt-6" label={t("finance.entries.loading")} />
      ) : entryQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("finance.entries.loadFailed")}
          retryLabel={t("finance.entries.retry")}
          onRetry={() => void entryQuery.refetch()}
        />
      ) : entryQuery.data ? (
        <div className="mt-6 space-y-6">
          {/* The record stays open: identity is workspace-scoped, so the ambient
              branch is a list lens and never an access boundary. */}
          <OtherBranchNotice branchId={entryQuery.data.branchId} />
          <Card>
            <CardContent>
              <EntrySummary entryId={entryId} />
            </CardContent>
          </Card>

          {entryQuery.data.postings.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-4 font-semibold">{t("finance.entries.detail.postings")}</h2>
              <div className="space-y-2">
                {entryQuery.data.postings.map((posting) => (
                  <div key={posting.lineNo} className="flex items-center justify-between border-t border-border/50 py-2 text-sm first:border-t-0 first:pt-0">
                    <div className="flex flex-col">
                      <span className="font-medium">{labelOf(posting.category)}</span>
                      {posting.assetCode && (
                        <span className="text-xs text-muted-foreground">{posting.assetCode}</span>
                      )}
                    </div>
                    <span className="font-mono font-semibold">
                      {formatMoney(posting.amountMinor, { signDisplay: "always" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(entryQuery.data.reversesEntryId || entryQuery.data.reversedByEntryId) && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="mb-3 font-semibold">{t("finance.entries.detail.reversalChain")}</h2>
              <div className="space-y-2">
                {entryQuery.data.reversesEntryId && (
                  <ReversalLink entryId={entryQuery.data.reversesEntryId} type="reverses" />
                )}
                {entryQuery.data.reversedByEntryId && (
                  <ReversalLink entryId={entryQuery.data.reversedByEntryId} type="reversedBy" />
                )}
              </div>
            </div>
          )}

          {canEdit && (
            <Button
              variant="outline"
              onClick={() => setEditOpen(true)}
              className="w-full"
            >
              {t("finance.entries.detail.editAction")}
            </Button>
          )}

          {canEdit && editOpen && (
            <RecordEntryForm
              surface="dialog"
              editing={entryQuery.data}
              onRecorded={() => {
                setEditOpen(false);
                void refreshFinance();
              }}
              onDismiss={() => {
                setEditOpen(false);
                void refreshFinance();
              }}
            />
          )}

          {canReverse && (
            <Button
              variant="destructive"
              onClick={() => setReverseOpen(true)}
              className="w-full"
            >
              {label("reverse-entry")}
            </Button>
          )}

          {canReverse && reverseOpen && (
            <ReverseEntryForm
              surface="dialog"
              entry={{ id: entryQuery.data.id, rowVersion: entryQuery.data.rowVersion }}
              onReversed={(reversalEntryId) => {
                setTimeout(() => {
                  void navigate({
                    to: "/finance/entries/$entryId",
                    params: { entryId: reversalEntryId },
                  });
                }, 1500);
              }}
              onDismiss={() => setReverseOpen(false)}
            />
          )}
        </div>
      ) : (
        <EmptyState
          className="mt-6"
          icon={<FileText className="size-7" aria-hidden />}
          message={t("finance.entries.detail.notFound")}
        />
      )}
    </PageContainer>
  );
}
