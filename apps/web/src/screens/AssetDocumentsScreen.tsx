import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { AddOrRenewDocumentPayload } from "@routiq/contracts";
import { ArrowLeft, FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttachmentField } from "../artifacts/AttachmentField.js";
import { useMeContext } from "../auth/me.js";
import { commandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { errorMessage } from "../lib/error-message.js";
import {
  expiryState,
  groupDocuments,
  renewalDefaults,
  type AssetDocument,
  type ExpiryState,
} from "../documents/model.js";
import { useAssetDocuments } from "../documents/useDocuments.js";
import { useCategories } from "../documents/useCategories.js";
import { canAccessDocuments, canManageDocuments } from "../documents/permissions.js";

const expiryBadgeStyles: Record<ExpiryState, string> = {
  expired: "bg-red-100 text-red-900 ring-red-200",
  expiringSoon: "bg-amber-100 text-amber-900 ring-amber-200",
  ok: "bg-emerald-100 text-emerald-900 ring-emerald-200",
  none: "bg-foreground/[0.05] text-muted-foreground ring-foreground/10",
};

interface FormState {
  open: boolean;
  /** When renewing: the document being superseded pre-fills the form. */
  renews?: AssetDocument;
}

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
    i18n.resolvedLanguage === "en" ? item.labelEn : item.labelFr;

  if (me !== undefined && !documentsEnabled) {
    return (
      <section className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-semibold">{t("documents.title")}</h1>
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {errorMessage(i18n, "MODULE_DISABLED")}
        </p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <button
        type="button"
        className="flex min-h-9 items-center gap-1.5 text-sm text-muted-foreground"
        onClick={() => void navigate({ to: "/assets" })}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t("documents.back")}
      </button>
      <h1 className="mt-2 text-2xl font-semibold">{t("documents.title")}</h1>

      {canManage && !form.open && (
        <Button className="mt-4 min-h-11 gap-2" onClick={() => setForm({ open: true })}>
          <Plus className="size-4" aria-hidden />
          {t("documents.add")}
        </Button>
      )}

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
          <p className="text-sm text-muted-foreground">{t("documents.loading")}</p>
        ) : documentsQuery.isError ? (
          <div role="alert" className="flex flex-col gap-3 text-sm text-destructive">
            <p>{t("documents.loadFailed")}</p>
            <Button variant="outline" className="min-h-11 self-start" onClick={() => void documentsQuery.refetch()}>
              {t("documents.retry")}
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("documents.empty")}</p>
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
                    <div key={doc.id} className="rounded-xl border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">
                          {doc.title ?? labelOf(group.type)}
                          {doc.documentNumber ? (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {doc.documentNumber}
                            </span>
                          ) : null}
                        </p>
                        <span
                          className={`inline-flex min-h-6 items-center rounded-full px-2 text-[0.65rem] font-bold uppercase ring-1 ring-inset ${expiryBadgeStyles[state]}`}
                        >
                          {state === "none"
                            ? t("documents.expiry.none")
                            : state === "expired"
                              ? t("documents.expiry.expired")
                              : state === "expiringSoon"
                                ? t("documents.expiry.expiringSoon", {
                                    date: doc.expiresAt,
                                  })
                                : t("documents.expiry.ok", { date: doc.expiresAt })}
                        </span>
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
                    </div>
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
    </section>
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
    i18n.resolvedLanguage === "en" ? item.labelEn : item.labelFr;

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
          <p role="alert" className="text-sm text-destructive">{t("documents.typesFailed")}</p>
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
        <AttachmentField onChange={setArtifactIds} onUploadingChange={setAttachmentsUploading} />
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
