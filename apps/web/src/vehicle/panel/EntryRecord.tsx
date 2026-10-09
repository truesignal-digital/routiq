import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { EntryEvidenceFile, FinancialEntryDetail } from "@routiq/contracts";
import { AttachEvidenceForm } from "@/finance/AttachEvidenceForm.js";
import { ApproveEntryForm, RejectEntryForm, ReverseEntryForm } from "@/finance/EntryDecisionForms.js";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { RecordText } from "@/components/record-number";
import { SheetTitle } from "@/components/ui/sheet";
import { useEntry } from "@/finance/useEntry.js";
import { formatDate, formatDateTime, formatMoney, localizedLabel, notRecorded } from "@/lib/format.js";
import { useVehicle, type PanelForm } from "../context.js";
import { entrySteps, missingReceipt } from "../flow.js";
import { DetailHeader, DetailSection, FactList, LinkButton, Note } from "../parts.js";
import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";
import { cancellationReasonWords } from "@/finance/model.js";
import {
  EvidenceMark,
  PanelFooter,
  PanelLoading,
  PanelMissing,
  RecordFileRow,
  useFormHost,
} from "./shared.js";
import { RecordHistorySheet } from "@/components/record-history-sheet.js";

/** This vehicle's signed share of the entry: its own posting lines, nothing else. */
export function vehicleShare(entry: Pick<FinancialEntryDetail, "postings">, assetId: string): number {
  return entry.postings
    .filter((posting) => posting.assetId === assetId)
    .reduce((sum, posting) => sum + posting.amountMinor, 0);
}

export function EntryRecord({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { t, i18n } = useTranslation();
  const { asset, viewer, panel, gates, pinnedLabel } = useVehicle();
  // Entries are read by the roles that read some, as the server scopes them; the workshop never fetches them.
  const query = useEntry(gates.entries ? id : undefined);
  const host = useFormHost(t("vehicle.panel.entryTitle"));
  const locale = i18n.language;
  // After a "wrong details" cancellation, the same panel page records it again.
  const [recordingAgain, setRecordingAgain] = useState(false);

  if (!gates.entries) return <PanelMissing />;
  if (query.isPending) return <PanelLoading />;
  if (query.isError || query.data === undefined) return <PanelMissing onRetry={() => void query.refetch()} />;
  const entry = query.data;
  const steps = entrySteps(entry, viewer);
  const back = { ...host.back, label: entry.entryNumber };

  if (form !== undefined) {
    const common = {
      surface: "panel" as const,
      entry: { id: entry.id, rowVersion: entry.rowVersion },
      back,
      onDone: host.onDone,
      onDismiss: host.onDismiss,
    };
    switch (form.key) {
      case "attach-evidence":
        return (
          <AttachEvidenceForm
            surface="panel"
            entry={{ id: entry.id, entryNumber: entry.entryNumber }}
            back={back}
            onDone={host.onDone}
            onDismiss={host.onDismiss}
          />
        );
      case "approve-entry":
        return <ApproveEntryForm {...common} />;
      case "reject-entry":
        return <RejectEntryForm {...common} entry={entry} />;
      case "reverse-entry":
        if (recordingAgain) {
          const onThisVehicle = entry.postings[0]?.assetId === asset.id;
          return (
            <RecordEntryForm
              surface="panel"
              recordAgainFrom={entry}
              back={back}
              {...(onThisVehicle ? { pinnedAssetId: asset.id, pinnedAssetLabel: pinnedLabel } : {})}
              onRecorded={() => {
                setRecordingAgain(false);
                host.onDone();
                host.onDismiss();
              }}
              onDismiss={() => {
                setRecordingAgain(false);
                host.onDismiss();
              }}
            />
          );
        }
        return <ReverseEntryForm {...common} onRecordAgain={() => setRecordingAgain(true)} />;
      case "edit-entry": {
        // The recording form writes one line, so it cannot write a split entry
        // back whole; that one is rejected and recorded again.
        if (entry.postings.length !== 1) {
          return (
            <div className="space-y-3 p-4 pr-12">
              <SheetTitle>
                <RecordText text={t("finance.edit.title", { number: entry.entryNumber })} numbers={[entry.entryNumber]} />
              </SheetTitle>
              <Note>{t("vehicle.panel.splitEntryNotEditable")}</Note>
            </div>
          );
        }
        const onThisVehicle = entry.postings[0]?.assetId === asset.id;
        return (
          <RecordEntryForm
            surface="panel"
            editing={entry}
            back={back}
            {...(onThisVehicle ? { pinnedAssetId: asset.id, pinnedAssetLabel: pinnedLabel } : {})}
            onRecorded={() => {
              void query.refetch();
              host.onDone();
              host.onDismiss();
            }}
            onDismiss={() => {
              void query.refetch();
              host.onDismiss();
            }}
          />
        );
      }
      default:
        return null;
    }
  }

  const share = vehicleShare(entry, asset.id);
  const money = (minor: number) =>
    formatMoney(minor, { currency: entry.currency, locale, sign: { context: "record" } });
  const recorder = entry.recordedBy.displayName ?? t("history.actor.unknown");
  const waiting =
    entry.status === "SUBMITTED"
      ? t("vehicle.panel.waitingOn.entryReview")
      : missingReceipt(entry)
        ? t("vehicle.panel.waitingOn.entryReceipt", { name: recorder })
        : null;

  return (
    <>
      <DetailHeader
        eyebrow={
          <RecordText
            text={t("vehicle.panel.entryEyebrow", { direction: entry.direction, number: entry.entryNumber })}
            numbers={[entry.entryNumber]}
          />
        }
        title={
          <span className="flex items-baseline justify-between gap-3">
            <span>{localizedLabel(entry.category, locale)}</span>
            <span className="tabular-nums">
              {money(share)}
            </span>
          </span>
        }
        meta={
          <>
            <EntryStatusBadge status={entry.status} />
            <EvidenceMark entry={entry} />
          </>
        }
      />
      <div className="space-y-6 p-4">
        <FactList
          rows={[
            [t("vehicle.panel.date"), formatDate(entry.economicDate, locale)],
            [
              t("vehicle.panel.costType"),
              entry.category.layer === null ? notRecorded() : t(`vehicle.layers.${entry.category.layer}`),
            ],
            [t("vehicle.panel.thisVehicle"), money(share)],
            [
              t("vehicle.panel.wholeEntry"),
              share === entry.amountMinor
                ? t("vehicle.panel.notShared")
                : t("vehicle.panel.sharedWith", { amount: money(entry.amountMinor) }),
            ],
            [t("vehicle.panel.paidTo"), entry.counterpartyName ?? notRecorded()],
            [t("vehicle.panel.recordedBy"), recorder],
            [
              t("vehicle.panel.postingPeriod"),
              entry.postingPeriodCode ?? t("vehicle.panel.notPosted"),
            ],
            ...(entry.reversesEntryId === null
              ? []
              : ([
                  [
                    t("vehicle.panel.reverses"),
                    <LinkButton onClick={() => panel.openRecord({ kind: "entry", id: entry.reversesEntryId ?? "" })}>
                      {t("vehicle.panel.openOriginal")}
                    </LinkButton>,
                  ],
                ] as const)),
            ...(entry.cancellation === null
              ? []
              : ([
                  [t("finance.entries.detail.cancellationReason"), cancellationReasonWords(entry.cancellation, t)],
                ] as const)),
            ...(entry.reversedByEntryId === null
              ? []
              : ([
                  [
                    t("vehicle.panel.reversedBy"),
                    <LinkButton onClick={() => panel.openRecord({ kind: "entry", id: entry.reversedByEntryId ?? "" })}>
                      {t("vehicle.panel.openReversal")}
                    </LinkButton>,
                  ],
                ] as const)),
          ]}
        />
        {entry.rejectedReason !== null && (
          <DetailSection title={t("vehicle.panel.reason")}>
            <p className="text-sm">{entry.rejectedReason}</p>
          </DetailSection>
        )}
        <Note>
          {entry.status === "SUBMITTED"
            ? t("vehicle.panel.awaitingReviewNote")
            : t("vehicle.panel.postedNotPaid")}
        </Note>
        {entry.reversesEntryId === null && (
          <DetailSection
            title={t("vehicle.panel.receipt")}
            aside={t(`vehicle.evidence.${entry.evidence.state}`)}
          >
            {entry.evidenceFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("vehicle.panel.noFiles")}</p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {entry.evidenceFiles.map((file) => (
                  <EvidenceFileRow key={file.artifactId} entryId={entry.id} file={file} />
                ))}
              </ul>
            )}
          </DetailSection>
        )}
        <Link
          to="/finance/entries/$entryId"
          params={{ entryId: entry.id }}
          className="inline-block text-sm font-medium underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground"
        >
          {t("vehicle.panel.openFullEntry")}
        </Link>
        <div>
          <RecordHistorySheet entityType="financial_entry" entityId={entry.id} />
        </div>
      </div>
      <PanelFooter steps={steps} waiting={waiting} onStep={panel.openStep} />
    </>
  );
}

/** A receipt opens through the entry-scoped route, never the workspace-wide one. */
function EvidenceFileRow({ entryId, file }: { entryId: string; file: EntryEvidenceFile }) {
  const { t, i18n } = useTranslation();
  return (
    <RecordFileRow
      name={file.originalFileName ?? file.mimeType}
      meta={t(`vehicle.panel.evidenceVia.${file.via}`, {
        date: formatDateTime(file.attachedAt, i18n.language),
        name: file.attachedBy.displayName ?? t("history.actor.unknown"),
      })}
      downloadPath={`/v1/finance/entries/${entryId}/evidence/${file.artifactId}/download-url`}
    />
  );
}
