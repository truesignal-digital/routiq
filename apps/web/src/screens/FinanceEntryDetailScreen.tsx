import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EntrySummary } from "@/finance/EntrySummary.js";
import { useMeContext } from "@/auth/me.js";
import { useActiveSession } from "@/auth/store.js";
import { useEntry } from "@/finance/useEntry.js";
import { isOwnSubmission } from "@/finance/model.js";
import {
  canApproveEntries,
  canEditPendingEntry,
  canReadFinance,
  canReverseEntry,
} from "@/finance/permissions.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import {
  EntryDecisionButtons,
  RejectEntryForm,
  ReverseEntryForm,
} from "@/finance/EntryDecisionForms.js";
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
  const [rejectOpen, setRejectOpen] = useState(false);
  const queryClient = useQueryClient();
  const session = useActiveSession();

  const canReverse = canReverseEntry(me?.role, entryQuery.data?.status);
  // role-config: an approver decides while the entry waits, never on their own
  // entry (the maker guard the server also enforces), and never above their
  // approval band, where the Director decides.
  const canDecide =
    entryQuery.data?.status === "SUBMITTED" &&
    canApproveEntries(me?.role, me?.enabledModules) &&
    !isOwnSubmission(entryQuery.data.recordedBy.principalId ?? "", me?.principalId) &&
    !entryQuery.data.directionDecides;
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
      <PageHeader title={t("finance.entries.detail.title")} />

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

          {canDecide && (
            <EntryDecisionButtons
              entry={{ id: entryQuery.data.id, rowVersion: entryQuery.data.rowVersion }}
              onReject={() => setRejectOpen(true)}
            />
          )}

          {canDecide && rejectOpen && (
            <RejectEntryForm
              surface="dialog"
              entry={{ id: entryQuery.data.id, rowVersion: entryQuery.data.rowVersion }}
              onDismiss={() => setRejectOpen(false)}
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
