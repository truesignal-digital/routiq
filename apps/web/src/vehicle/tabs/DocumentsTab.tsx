import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { Card } from "@/components/ui/card";
import { DocumentStatusBadge, documentIconTone } from "@/documents/DocumentStatusBadge.js";
import { expiryState } from "@/documents/model.js";
import { useAssetDocuments } from "@/documents/useDocuments.js";
import { formatDate, formatRelativeTime, localizedLabel } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { useVehicle } from "../context.js";
import { may } from "../flow.js";
import { RecordRow, RowIcon, RowMenu, Sep, TabHeader } from "../parts.js";
import { earlierVersions } from "../panel/DocumentRecord.js";
import { TabAction } from "./MaintenanceTab.js";

export function DocumentsTab() {
  const { t } = useTranslation();
  const { gates } = useVehicle();
  if (!gates.documents) {
    return (
      <PermissionDenied
        title={t("vehicle.tabs.documents")}
        icon={<FileText className="size-7" aria-hidden />}
        code={deniedCode(false)}
      />
    );
  }
  return <DocumentsSection />;
}

/** The vehicle's current documents; renewing keeps every earlier version. */
function DocumentsSection() {
  const { t, i18n } = useTranslation();
  const { asset, viewer, panel } = useVehicle();
  const query = useAssetDocuments(asset.id);
  const locale = i18n.language;
  const all = query.data?.documents ?? [];
  const current = all.filter((doc) => doc.supersededByDocumentId === null);
  const canRenew = may.renewDocuments(viewer);
  const now = new Date();

  return (
    <section>
      <TabHeader
        title={t("vehicle.documents.title")}
        description={t("vehicle.documents.description")}
        action={<TabAction actionKey="add-document" />}
      />
      {query.isPending ? (
        <LoadingState label={t("documents.loading")} />
      ) : query.isError ? (
        <ErrorState
          message={t("documents.loadFailed")}
          retryLabel={t("documents.retry")}
          onRetry={() => void query.refetch()}
        />
      ) : current.length === 0 ? (
        <EmptyState icon={<FileText className="size-6" aria-hidden />} message={t("vehicle.documents.empty")} />
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y">
            {current.map((doc) => {
              const state = expiryState(doc.expiresAt, now);
              const earlier = earlierVersions(doc, all).length;
              const typeLabel = localizedLabel(doc.type, locale);
              return (
                <RecordRow
                  key={doc.id}
                  icon={<RowIcon icon={FileText} tone={documentIconTone(state)} />}
                  title={doc.title === null ? typeLabel : `${typeLabel} · ${doc.title}`}
                  detail={
                    <span className="flex flex-wrap items-center gap-x-1.5">
                      <span className="tabular-nums">{doc.documentNumber ?? t("vehicle.documents.noNumber")}</span>
                      <Sep />
                      <span>
                        {earlier > 0
                          ? t("vehicle.documents.earlierKept", { count: earlier })
                          : t("vehicle.documents.firstVersion")}
                      </span>
                      <Sep />
                      {doc.artifactCount > 0 ? (
                        <span>{t("vehicle.documents.scanOnFile")}</span>
                      ) : (
                        <span className="font-medium text-warning-foreground">
                          {t("vehicle.documents.noScan")}
                        </span>
                      )}
                    </span>
                  }
                  status={<DocumentStatusBadge doc={doc} />}
                  aside={
                    doc.expiresAt === null ? (
                      <div className="text-muted-foreground">{t("vehicle.documents.noExpiry")}</div>
                    ) : (
                      <>
                        <div className={cn(state === "expired" && "font-medium text-destructive")}>
                          {formatDate(doc.expiresAt, locale)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {state === "expired"
                            ? formatRelativeTime(`${doc.expiresAt}T00:00:00`, locale)
                            : t("vehicle.documents.validUntilShort")}
                        </div>
                      </>
                    )
                  }
                  menu={
                    <RowMenu
                      label={typeLabel}
                      steps={
                        canRenew
                          ? [{ step: { key: "renew-document", record: { kind: "document", id: doc.id } } }]
                          : []
                      }
                      onStep={panel.openStep}
                    />
                  }
                  onOpen={() => panel.openRecord({ kind: "document", id: doc.id })}
                />
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
