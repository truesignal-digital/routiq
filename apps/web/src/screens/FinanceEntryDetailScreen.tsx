import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FinancialEntryDetail } from "@routiq/contracts";
import { useCommandLabel } from "@/commands/labels.js";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
import { LatestHistory, RecordHistory } from "@/components/record-history-sheet.js";
import { RecordBody, RecordHeader, RecordTabs, TabCount } from "@/components/record-page.js";
import { StatusBlock } from "@/components/status-block.js";
import { Button } from "@/components/ui/button";
import { useMeContext } from "@/auth/me.js";
import { useActiveSession } from "@/auth/store.js";
import { AttachEvidenceForm } from "@/finance/AttachEvidenceForm.js";
import {
  entryAssets,
  EntryLinked,
  EntryMoneyBox,
  EntryOverview,
  EntryReceiptTab,
  useEntryStatus,
  type EntryAbilities,
  type EntryTab,
} from "@/finance/EntryPage.js";
import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";
import { useEntry } from "@/finance/useEntry.js";
import { amountKind, isOwnSubmission } from "@/finance/model.js";
import {
  canApproveEntries,
  canEditPendingEntry,
  canReadFinanceEntries,
  canReverseEntry,
  recordAgainStep,
} from "@/finance/permissions.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import {
  EntryDecisionButtons,
  RejectEntryForm,
  ReverseEntryForm,
} from "@/finance/EntryDecisionForms.js";
import { localizedLabel } from "@/lib/format.js";
import { OtherBranchNotice } from "@/shell/BranchScopeNotices.js";
import { entrySteps } from "@/vehicle/flow.js";
import { viewerOf } from "@/vehicle/model.js";

export function FinanceEntryDetailScreen() {
  const { t } = useTranslation();
  const me = useMeContext();
  if (me === undefined) return <LoadingState label={t("finance.entries.loading")} />;
  if (!canReadFinanceEntries(me.role, me.enabledModules)) {
    return <PermissionDenied title={t("finance.entries.detail.title")}
      icon={<FileText className="size-7" aria-hidden />}
      code="ROLE_FORBIDDEN" />;
  }
  return <FinanceEntryDetailContent />;
}

function FinanceEntryDetailContent() {
  const { t } = useTranslation();
  const { entryId } = useParams({ from: "/app/finance/entries/$entryId" });
  const navigate = useNavigate();
  const me = useMeContext();

  const entryQuery = useEntry(entryId);
  // `?reverse=1` is how the entries list's ⋯ menu hands an operator straight
  // into the dialog instead of duplicating it there.
  const { reverse: openReverse, tab } = useSearch({
    from: "/app/finance/entries/$entryId",
  });
  const [reverseOpen, setReverseOpen] = useState(openReverse === true);
  const [editOpen, setEditOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [recordAgainOpen, setRecordAgainOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const queryClient = useQueryClient();
  const session = useActiveSession();

  const canReverse = canReverseEntry(me?.role, entryQuery.data);
  // role-config: an approver decides while the entry waits, never on their own
  // entry (the maker guard the server also enforces), and never above their
  // approval band, where the Director decides.
  const mayDecideOthers =
    entryQuery.data?.status === "SUBMITTED" &&
    canApproveEntries(me?.role, me?.enabledModules) &&
    !isOwnSubmission(entryQuery.data.recordedBy.principalId ?? "", me?.principalId);
  const canDecide = mayDecideOthers && !entryQuery.data?.directionDecides;
  // Says why Approve and Reject are missing above the band (#542).
  const decidesAboveBand = mayDecideOthers && entryQuery.data?.directionDecides === true;
  // role-config: the author alone, while it waits, and only an entry this
  // single-line form can write back whole.
  const canEdit =
    canEditPendingEntry(entryQuery.data, {
      principalId: me?.principalId,
      role: me?.role,
      enabledModules: me?.enabledModules,
    }) && entryQuery.data?.postings.length === 1;
  // role-config: the receipt is missing and the viewer may attach it (the
  // vehicle panel's rule: drivers and the workshop to their own entries only).
  const canAttach =
    entryQuery.data !== undefined &&
    me !== undefined &&
    entrySteps(entryQuery.data, viewerOf(me)).offered.some((offer) => offer.step.key === "attach-evidence");

  /** ADR-0001: server truth after the save or the conflict, never a local patch. */
  const refreshFinance = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "finance"],
    });
  };

  if (entryQuery.isPending) {
    return (
      <PageContainer>
        <LoadingState label={t("finance.entries.loading")} />
      </PageContainer>
    );
  }
  if (entryQuery.isError) {
    return (
      <PageContainer>
        <ErrorState
          message={t("finance.entries.loadFailed")}
          retryLabel={t("finance.entries.retry")}
          onRetry={() => void entryQuery.refetch()}
        />
      </PageContainer>
    );
  }
  const entry = entryQuery.data;
  if (entry === undefined) {
    return (
      <PageContainer>
        <EmptyState icon={<FileText className="size-7" aria-hidden />} message={t("finance.entries.detail.notFound")} />
      </PageContainer>
    );
  }

  return (
    <EntryPage
      entry={entry}
      can={{ decide: canDecide, aboveBand: decidesAboveBand, attach: canAttach, edit: canEdit }}
      canReverse={canReverse}
      tab={tab ?? "overview"}
      onTab={(next) =>
        void navigate({
          to: ".",
          search: (previous: Record<string, unknown>) => ({
            ...previous,
            tab: next === "overview" ? undefined : next,
          }),
          // A tab is a view of the same record: Back leaves the record, not the tab.
          replace: true,
        })
      }
      onEdit={() => setEditOpen(true)}
      onReject={() => setRejectOpen(true)}
      onReverse={() => setReverseOpen(true)}
      onAttach={() => setAttachOpen(true)}
    >
      {canEdit && editOpen && (
        <RecordEntryForm
          surface="sheet"
          editing={entry}
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

      {canAttach && attachOpen && (
        <AttachEvidenceForm
          surface="sheet"
          entry={{ id: entry.id, entryNumber: entry.entryNumber }}
          onDone={() => void refreshFinance()}
          onDismiss={() => setAttachOpen(false)}
        />
      )}

      {canDecide && rejectOpen && (
        <RejectEntryForm surface="dialog" entry={entry} onDismiss={() => setRejectOpen(false)} />
      )}

      {/* Stays mounted once the entry reads Cancelled: a "wrong details"
          cancellation ends on the Record again step. */}
      {reverseOpen && (canReverse || entry.status === "REVERSED") && (
        <ReverseEntryForm
          surface="dialog"
          entry={{ id: entry.id, rowVersion: entry.rowVersion }}
          onReversed={(reversalEntryId, reasonCode) => {
            if (reasonCode === "WRONG_DETAILS") return;
            setTimeout(() => {
              void navigate({
                to: "/finance/entries/$entryId",
                params: { entryId: reversalEntryId },
              });
            }, 1500);
          }}
          // role-config: a work-order cost is recorded again by the roles that book one (#559).
          {...recordAgainStep(me, entry, {
            recordAgain: () => {
              setReverseOpen(false);
              setRecordAgainOpen(true);
            },
            openWorkOrder: (assetId, workOrderId) =>
              void navigate({
                to: "/assets/$assetId/maintenance",
                params: { assetId },
                search: { panel: `work_order:${workOrderId}` },
              }),
          })}
          onDismiss={() => setReverseOpen(false)}
        />
      )}

      {recordAgainOpen && (
        <RecordEntryForm
          surface="sheet"
          recordAgainFrom={entry}
          onRecorded={(outcome) => {
            setRecordAgainOpen(false);
            void refreshFinance();
            void navigate({
              to: "/finance/entries/$entryId",
              params: { entryId: outcome.recordId },
            });
          }}
          onDismiss={() => setRecordAgainOpen(false)}
        />
      )}
    </EntryPage>
  );
}

/**
 * The money entry as a record page (#662): header with its number and status,
 * the status block holding the decision it waits for, Overview · Receipt ·
 * History, and the context column with its amount, links and latest history.
 */
function EntryPage({
  entry,
  can,
  canReverse,
  tab,
  onTab,
  onEdit,
  onReject,
  onReverse,
  onAttach,
  children,
}: {
  entry: FinancialEntryDetail;
  can: EntryAbilities;
  canReverse: boolean;
  tab: EntryTab;
  onTab: (tab: EntryTab) => void;
  onEdit: () => void;
  onReject: () => void;
  onReverse: () => void;
  onAttach: () => void;
  /** The forms and dialogs the page opens. */
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const label = useCommandLabel();
  const locale = i18n.language;
  const attachButton = (
    <Button onClick={onAttach}>{label("attach-evidence")}</Button>
  );
  const status = useEntryStatus(entry, can, {
    decision: (
      <EntryDecisionButtons entry={{ id: entry.id, rowVersion: entry.rowVersion }} onReject={onReject} />
    ),
    attach: attachButton,
  });
  // The status block holds Attach receipt when the missing receipt is the news.
  const attachInHeader = can.attach && status?.action !== attachButton;
  const assets = entryAssets(entry);

  return (
    <PageContainer className="pb-28 md:pb-6">
      <RecordHeader
        name={entry.entryNumber}
        status={<EntryStatusBadge status={entry.status} />}
        facts={[
          t("finance.entries.detail.amountKind", { kind: amountKind(entry) }),
          localizedLabel(entry.category, locale),
          assets.length === 0 ? null : <span className="tabular-nums">{assets.map((asset) => asset.code).join(", ")}</span>,
          t("finance.entries.detail.recordedBy", { name: entry.recordedBy.displayName ?? t("history.actor.unknown") }),
        ]}
        actions={
          attachInHeader || can.edit || canReverse ? (
            <>
              {attachInHeader && (
                <Button variant="outline" onClick={onAttach}>
                  {label("attach-evidence")}
                </Button>
              )}
              {can.edit && (
                <Button variant="outline" onClick={onEdit}>
                  {t("finance.entries.detail.editAction")}
                </Button>
              )}
              {canReverse && (
                <Button variant="destructive" onClick={onReverse}>
                  {label("reverse-entry")}
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {/* The record stays open: identity is workspace-scoped, so the ambient
            branch is a list lens and never an access boundary. */}
        <OtherBranchNotice branchId={entry.branchId} />
      </RecordHeader>

      {status !== undefined && (
        <div className="mt-4">
          <StatusBlock {...status} />
        </div>
      )}

      <RecordBody
        overview={tab === "overview"}
        tabs={
          <RecordTabs
            label={t("finance.entries.detail.tabs.label")}
            overview={{ key: "overview", label: t("record.tabs.overview") }}
            work={[
              {
                key: "receipt",
                label: t("finance.entries.detail.tabs.receipt"),
                marker: <TabCount n={entry.evidenceFiles.length} />,
              },
            ]}
            history={{ key: "history", label: t("record.tabs.history") }}
            active={tab}
            onSelect={onTab}
          />
        }
        lead={<EntryMoneyBox entry={entry} />}
        context={
          <>
            <EntryLinked entry={entry} />
            <LatestHistory entityType="financial_entry" entityId={entry.id} onShowAll={() => onTab("history")} />
          </>
        }
      >
        {tab === "overview" && <EntryOverview entry={entry} can={can} onEdit={onEdit} onAttach={onAttach} />}
        {tab === "receipt" && <EntryReceiptTab entry={entry} />}
        {tab === "history" && <RecordHistory entityType="financial_entry" entityId={entry.id} />}
      </RecordBody>

      {children}
    </PageContainer>
  );
}
