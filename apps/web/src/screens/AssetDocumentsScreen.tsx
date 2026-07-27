import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { AddOrRenewDocumentPayload } from "@routiq/contracts";
import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { createCommandIntent, type CommandIntent } from "@/commands/intent.js";
import { commandClient } from "@/commands/instance.js";
import { ErrorBanner } from "@/components/error-banner.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  expiryState,
  groupDocuments,
  renewalDefaults,
  type AssetDocument,
  type ExpiryState,
} from "@/documents/model.js";
import { canAccessDocuments, canManageDocuments } from "@/documents/permissions.js";
import { useCategories } from "@/documents/useCategories.js";
import { useAssetDocuments } from "@/documents/useDocuments.js";
import { errorMessage } from "@/lib/error-message.js";
import { formatMoney, formatDate, formatDateTime, localizedLabel } from "@/lib/format.js";


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
  const { t, i18n } = useTranslation();
  const { assetId } = useParams({ from: "/app/assets/$assetId/documents" });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMeContext();
  const documentsEnabled = canAccessDocuments(me?.enabledModules);
  const canManage = canManageDocuments(me?.role, me?.enabledModules);

  const documentsQuery = useAssetDocuments(assetId);
  const typesQuery = useCategories("DOCUMENT_TYPE");
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
      <PageContainer>
        <PageHeader title={t("documents.title")} />
        <EmptyState
          className="mt-6"
          icon={<FileText className="size-7" aria-hidden />}
          message={errorMessage(i18n, "MODULE_DISABLED")}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t("documents.title")}
        onBack={() => void navigate({ to: "/assets" })}
        backLabel={t("documents.back")}
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
          assetId={assetId}
          renews={form.renews}
          documentTypes={typesQuery.data ?? []}
          documentTypesFailed={typesQuery.isError}
          onClose={() => setForm({ open: false })}
          onCommitted={async () => {
            setForm({ open: false });
            await queryClient.invalidateQueries({ queryKey: ["ws"] });
          }}
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

function DocumentForm({
  assetId,
  renews,
  documentTypes,
  documentTypesFailed,
  onClose,
  onCommitted,
}: {
  assetId: string;
  renews: AssetDocument | undefined;
  documentTypes: Array<{ code: string; labelFr: string; labelEn: string }>;
  documentTypesFailed: boolean;
  onClose: () => void;
  onCommitted: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [documentId] = useState(() => crypto.randomUUID());
  const intentRef = useRef<CommandIntent<AddOrRenewDocumentPayload> | undefined>(undefined);

  const defaults = renewalDefaults(renews);
  const [typeCode, setTypeCode] = useState(defaults.typeCode);
  const [title, setTitle] = useState(defaults.title);
  const [documentNumber, setDocumentNumber] = useState(defaults.documentNumber);
  const [issuedAt, setIssuedAt] = useState(defaults.issuedAt);
  const [expiresAt, setExpiresAt] = useState(defaults.expiresAt);
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [attachmentsUploading, setAttachmentsUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();

  const labelOf = (item: { labelFr: string; labelEn: string }) =>
    localizedLabel(item);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrorCode(undefined);
    setSubmitting(true);
    intentRef.current ??= createCommandIntent(commandClient, "add-or-renew-document", 1);
    const result = await intentRef.current.submit(
      {
        documentId,
        assetId,
        documentTypeCode: typeCode,
        ...(title === "" ? {} : { title }),
        ...(documentNumber === "" ? {} : { documentNumber }),
        ...(issuedAt === "" ? {} : { issuedAt }),
        ...(expiresAt === "" ? {} : { expiresAt }),
        ...(renews === undefined ? {} : { supersedesDocumentId: renews.id }),
      },
      artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {},
    );
    setSubmitting(false);
    if (!result.ok) {
      setErrorCode(result.code);
      return;
    }
    await onCommitted();
  }

  return (
    <form
      className="mt-4 flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
      onSubmit={(e) => void onSubmit(e)}
    >
      <p className="text-sm font-semibold">
        {renews ? t("documents.renewTitle", { name: renews.title ?? renews.type.code }) : t("documents.addTitle")}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="doc-type">{t("documents.fields.type")}</Label>
        {documentTypesFailed && (
          <ErrorBanner message={t("documents.typesFailed")} />
        )}
        <select
          id="doc-type"
          className="min-h-11 rounded-md border border-input bg-transparent px-3 text-sm"
          value={typeCode}
          onChange={(e) => setTypeCode(e.target.value)}
          disabled={renews !== undefined || documentTypesFailed}
          required
        >
          <option value="">{t("assets.form.choose")}</option>
          {documentTypes.map((c) => (
            <option key={c.code} value={c.code}>
              {labelOf(c)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-title">{t("documents.fields.title")}</Label>
          <Input id="doc-title" className="min-h-11" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-number">{t("documents.fields.number")}</Label>
          <Input
            id="doc-number"
            className="min-h-11"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-issued">{t("documents.fields.issuedAt")}</Label>
          <Input
            id="doc-issued"
            className="min-h-11"
            type="date"
            value={issuedAt}
            onChange={(e) => setIssuedAt(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-expires">{t("documents.fields.expiresAt")}</Label>
          <Input
            id="doc-expires"
            className="min-h-11"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("attachments.label")}</span>
        <FileUpload
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={setArtifactIds}
          onUploadingChange={setAttachmentsUploading}
        />
      </div>

      {errorCode !== undefined && (
        <p
          role={errorCode === "ASSET_NOT_OPERATIONAL" || errorCode === "DOCUMENT_ALREADY_SUPERSEDED" ? "status" : "alert"}
          className={
            errorCode === "ASSET_NOT_OPERATIONAL" || errorCode === "DOCUMENT_ALREADY_SUPERSEDED"
              ? "rounded-lg bg-sky-100 px-4 py-3 text-sm text-sky-900"
              : "rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
          }
        >
          {errorMessage(i18n, errorCode)}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" className="min-h-11 flex-1" disabled={submitting || attachmentsUploading || documentTypesFailed || typeCode === ""}>
          {submitting ? t("assets.actions.working") : t("documents.save")}
        </Button>
        <Button type="button" variant="outline" className="min-h-11" onClick={onClose}>
          {t("assets.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
