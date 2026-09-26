import { useTranslation } from "react-i18next";
import { DocumentForm } from "@/documents/DocumentForm.js";
import { expiryState, type AssetDocument } from "@/documents/model.js";
import { useAssetDocuments } from "@/documents/useDocuments.js";
import { formatDate, localizedLabel } from "@/lib/format.js";
import { useVehicle, type PanelForm } from "../context.js";
import type { RecordSteps } from "../flow.js";
import { may } from "../flow.js";
import { DetailHeader, DetailSection, FactList, Note } from "../parts.js";
import { DocumentState } from "../tabs/DocumentsTab.js";
import { PanelFooter, PanelLoading, PanelMissing, useFormHost } from "./shared.js";

/** The versions a document replaced, newest first, by following `supersedes`. */
export function earlierVersions(doc: AssetDocument, all: readonly AssetDocument[]): AssetDocument[] {
  const byId = new Map(all.map((candidate) => [candidate.id, candidate]));
  const out: AssetDocument[] = [];
  let next = doc.supersedesDocumentId === null ? undefined : byId.get(doc.supersedesDocumentId);
  while (next !== undefined && !out.includes(next)) {
    out.push(next);
    next = next.supersedesDocumentId === null ? undefined : byId.get(next.supersedesDocumentId);
  }
  return out;
}

export function DocumentRecord({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { gates } = useVehicle();
  if (!gates.documents) return <PanelMissing />;
  return <DocumentRecordBody id={id} form={form} />;
}

function DocumentRecordBody({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { t, i18n } = useTranslation();
  const { asset, viewer, panel, pinnedLabel } = useVehicle();
  const query = useAssetDocuments(asset.id);
  const host = useFormHost(t("vehicle.panel.documentTitle"));
  const locale = i18n.language;

  if (query.isPending) return <PanelLoading />;
  if (query.isError || query.data === undefined) return <PanelMissing onRetry={() => void query.refetch()} />;
  const all = query.data.documents;
  const doc = all.find((candidate) => candidate.id === id);
  if (doc === undefined) return <PanelMissing />;
  const typeLabel = localizedLabel(doc.type, locale);

  if (form?.key === "renew-document") {
    return (
      <DocumentForm
        surface="panel"
        pinnedAssetId={asset.id}
        pinnedAssetLabel={pinnedLabel}
        renews={doc}
        back={{ ...host.back, label: typeLabel }}
        onDone={host.onDone}
        onDismiss={host.onDismiss}
      />
    );
  }

  const state = expiryState(doc.expiresAt, new Date());
  const current = doc.supersededByDocumentId === null;
  const due = current && (state === "expired" || state === "expiringSoon");
  const earlier = earlierVersions(doc, all);
  const canRenew = current && may.renewDocuments(viewer);
  const steps: RecordSteps = {
    primary: canRenew && due ? { kind: "go", step: { key: "renew-document", record: { kind: "document", id } } } : { kind: "none" },
    offered: canRenew ? [{ step: { key: "renew-document", record: { kind: "document", id } } }] : [],
  };
  const notRecorded = t("vehicle.details.notRecorded");

  return (
    <>
      <DetailHeader
        eyebrow={t("vehicle.panel.documentEyebrow")}
        title={doc.title === null ? typeLabel : `${typeLabel} · ${doc.title}`}
        meta={<DocumentState doc={doc} />}
      />
      <div className="space-y-6 p-4">
        {current && state === "expired" && doc.expiresAt !== null && (
          <Note tone="danger">
            {t("vehicle.documents.expiredOn", { type: typeLabel, date: formatDate(doc.expiresAt, locale) })}
          </Note>
        )}
        {!current && <Note>{t("vehicle.documents.supersededNote")}</Note>}
        <FactList
          rows={[
            [t("documents.fields.number"), doc.documentNumber ?? notRecorded],
            [t("documents.fields.issuedAt"), doc.issuedAt === null ? notRecorded : formatDate(doc.issuedAt, locale)],
            [
              t("documents.fields.expiresAt"),
              doc.expiresAt === null ? t("vehicle.documents.noExpiry") : formatDate(doc.expiresAt, locale),
            ],
            [
              t("vehicle.documents.scan"),
              doc.artifactCount > 0
                ? t("vehicle.documents.filesOnFile", { count: doc.artifactCount })
                : t("vehicle.documents.noScan"),
            ],
          ]}
        />
        <DetailSection title={t("vehicle.documents.earlierVersions")}>
          {earlier.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("vehicle.documents.firstVersion")}</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {earlier.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => panel.openRecord({ kind: "document", id: version.id })}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/50"
                  >
                    <span className="min-w-0 truncate">{version.documentNumber ?? typeLabel}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {version.expiresAt === null
                        ? t("vehicle.documents.noExpiry")
                        : t("vehicle.documents.validUntil", { date: formatDate(version.expiresAt, locale) })}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DetailSection>
        <Note>{t("vehicle.documents.renewKeeps")}</Note>
      </div>
      <PanelFooter
        steps={steps}
        waiting={due && !canRenew ? t("vehicle.panel.waitingOn.documentRenewal") : null}
        onStep={panel.openStep}
      />
    </>
  );
}
