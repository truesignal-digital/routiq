import { useMemo, useState } from "react";
import { useParams } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DocumentForm } from "@/documents/DocumentForm.js";
import {
  expiryState,
  groupDocuments,
  type AssetDocument,
  type ExpiryState,
} from "@/documents/model.js";
import { canAccessDocuments, canManageDocuments } from "@/documents/permissions.js";
import { useAssetDocuments } from "@/documents/useDocuments.js";
import { formatDate, localizedLabel } from "@/lib/format.js";


interface FormState {
  open: boolean;
  /** When renewing: the document being superseded pre-fills the form. */
  renews?: AssetDocument;
}

const EXPIRY_TONES: Record<ExpiryState, "neutral" | "success" | "warning" | "danger"> = {
  none: "neutral",
  ok: "success",
  expiringSoon: "warning",
  expired: "danger",
};


export function AssetDocumentsScreen() {
  const { t } = useTranslation();
  const { assetId } = useParams({ from: "/app/assets/$assetId/documents" });
  const me = useMeContext();
  const documentsEnabled = canAccessDocuments(me?.enabledModules);
  const canManage = canManageDocuments(me?.role, me?.enabledModules);

  const documentsQuery = useAssetDocuments(assetId);
  const [form, setForm] = useState<FormState>({ open: false });
  const [inspecting, setInspecting] = useState<string>();

  const groups = useMemo(
    () => groupDocuments(documentsQuery.data?.documents ?? []),
    [documentsQuery.data],
  );
  const byId = useMemo(
    () => new Map((documentsQuery.data?.documents ?? []).map((d) => [d.id, d])),
    [documentsQuery.data],
  );
  const today = new Date();

  const labelOf = (item: { labelFr: string; labelEn: string }) =>
    localizedLabel(item);

  if (me !== undefined && !documentsEnabled) {
    return (
      <PermissionDenied
        title={t("documents.title")}
        icon={<FileText className="size-7" aria-hidden />}
        code={deniedCode(documentsEnabled)}
      />
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t("documents.title")}
        actions={
          canManage && !form.open ? (
            <Button className="min-h-11 gap-2" onClick={() => setForm({ open: true })}>
              <Plus className="size-4" aria-hidden />
              {t("documents.add")}
            </Button>
          ) : undefined
        }
      />

      {form.open && (
        <DocumentForm
          key={form.renews?.id ?? "new"}
          surface="page"
          pinnedAssetId={assetId}
          renews={form.renews}
          onDismiss={() => setForm({ open: false })}
        />
      )}

      <div className="mt-6 flex flex-col gap-6">
        {documentsQuery.isPending || me === undefined ? (
          <LoadingState label={t("documents.loading")} />
        ) : documentsQuery.isError ? (
          <ErrorState
            message={t("documents.loadFailed")}
            retryLabel={t("documents.retry")}
            onRetry={() => void documentsQuery.refetch()}
          />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<FileText className="size-7" aria-hidden />}
            message={t("documents.empty")}
            action={
              canManage
                ? {
                    label: t("documents.add"),
                    onClick: () => setForm({ open: true }),
                  }
                : undefined
            }
          />
        ) : (
          groups.map((group) => (
            <div key={group.type.code}>
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <FileText className="size-4" aria-hidden />
                {labelOf(group.type)}
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {group.current.map((doc) => {
                  const state = expiryState(doc.expiresAt, today);
                  return (
                    <Card key={doc.id}>
                      <CardContent className="p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium">
                            {doc.title ?? labelOf(group.type)}
                            {doc.documentNumber ? (
                              <span className="ml-2 font-mono text-xs text-muted-foreground">
                                {doc.documentNumber}
                              </span>
                            ) : null}
                          </p>
                          <StatusBadge tone={EXPIRY_TONES[state]}>
                            {state === "none"
                              ? t("documents.expiry.none")
                              : state === "expired"
                                ? t("documents.expiry.expired")
                                : state === "expiringSoon"
                                  ? t("documents.expiry.expiringSoon", {
                                      date: formatDate(doc.expiresAt),
                                    })
                                  : t("documents.expiry.ok", {
                                      date: formatDate(doc.expiresAt),
                                    })}
                          </StatusBadge>
                        </div>
                        {canManage && !form.open && (
                          <Button
                            variant="outline"
                            className="mt-2 min-h-9"
                            onClick={() => setForm({ open: true, renews: doc })}
                          >
                            {t("documents.renew")}
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
                {group.superseded.map((doc) => (
                  <div key={doc.id} className="rounded-xl border border-dashed border-border/70 p-3 opacity-70">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 text-left"
                      onClick={() => setInspecting(inspecting === doc.id ? undefined : doc.id)}
                    >
                      <p className="min-w-0 truncate text-sm">
                        {doc.title ?? labelOf(group.type)}
                        {doc.documentNumber ? (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            {doc.documentNumber}
                          </span>
                        ) : null}
                      </p>
                      <span className="text-[0.65rem] font-bold uppercase text-muted-foreground">
                        {t("documents.superseded")}
                      </span>
                    </button>
                    {inspecting === doc.id && (
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                        <dt>{t("documents.fields.issuedAt")}</dt>
                        <dd>{doc.issuedAt ?? "—"}</dd>
                        <dt>{t("documents.fields.expiresAt")}</dt>
                        <dd>{doc.expiresAt ?? "—"}</dd>
                        <dt>{t("documents.replacedBy")}</dt>
                        <dd className="font-mono">
                          {doc.supersededByDocumentId
                            ? (byId.get(doc.supersededByDocumentId)?.documentNumber ??
                              byId.get(doc.supersededByDocumentId)?.title ??
                              t("documents.renewal"))
                            : "—"}
                        </dd>
                      </dl>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </PageContainer>
  );
}
