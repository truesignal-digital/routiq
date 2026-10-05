import { useRef, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQueryClient } from "@tanstack/react-query";
import type { AddOrRenewDocumentPayload } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import {
  CommandForm,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { ErrorBanner } from "@/components/error-banner.js";
import { FileUpload } from "@/components/ui/file-upload";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PinnedAssetField } from "../assets/PinnedAssetField.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { localizedLabel } from "../lib/format.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { renewalDefaults, type AssetDocument } from "./model.js";
import { useCategories } from "./useCategories.js";

/** Refusals that describe the asset or the document, not a failed save. */
const INFORMATIVE_CODES = ["ASSET_NOT_OPERATIONAL", "DOCUMENT_ALREADY_SUPERSEDED"] as const;

export interface DocumentFormProps {
  surface: CommandSurface;
  /** The vehicle the document belongs to. */
  pinnedAssetId: string;
  pinnedAssetLabel?: string | undefined;
  /** Renew mode: the document being superseded pre-fills the form. */
  renews?: AssetDocument | undefined;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  /** After the document committed and this asset's documents were refreshed. */
  onDone?: ((renewed: boolean) => void) | undefined;
  onDismiss: () => void;
}

/**
 * Adds a document to a vehicle, or renews one. A renewal is a new document
 * that supersedes the old; nothing already on file is edited.
 */
export function DocumentForm({
  surface,
  pinnedAssetId,
  pinnedAssetLabel,
  renews,
  client = commandClient,
  back,
  onDone,
  onDismiss,
}: DocumentFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const typesQuery = useCategories("DOCUMENT_TYPE");
  const submission = useCommandSubmission();
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

  const documentTypesFailed = typesQuery.isError;
  const ready = !attachmentsUploading && !documentTypesFailed && typeCode !== "";

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "asset", pinnedAssetId, "documents"],
    });

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intentRef.current ??= createCommandIntent(client, "add-or-renew-document", 1);
      return intentRef.current.submit(
        {
          documentId,
          assetId: pinnedAssetId,
          documentTypeCode: typeCode,
          ...(title === "" ? {} : { title }),
          ...(documentNumber === "" ? {} : { documentNumber }),
          ...(issuedAt === "" ? {} : { issuedAt }),
          ...(expiresAt === "" ? {} : { expiresAt }),
          ...(renews === undefined ? {} : { supersedesDocumentId: renews.id }),
        },
        artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {},
      );
    });
    if (!result.ok) return;
    const renewed = renews !== undefined;
    notifyCommandSuccess("documents", renewed ? "renewed" : "added");
    await invalidate();
    onDone?.(renewed);
    onDismiss();
  }

  return (
    <CommandForm
      surface={surface}
      title={
        renews
          ? t("documents.renewTitle", { name: renews.title ?? renews.type.code })
          : t("documents.addTitle")
      }
      back={back}
      error={submission.error}
      informativeCodes={INFORMATIVE_CODES}
      onReload={async () => {
        await invalidate();
        onDismiss();
      }}
      submitLabel={t("documents.save")}
      submittingLabel={t("assets.actions.working")}
      cancelLabel={t("assets.form.cancel")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
      className={surface === "page" ? "mt-4" : undefined}
    >
      {/* On the asset's own page the vehicle is the page; elsewhere it is named. */}
      {surface !== "page" && (
        <PinnedAssetField assetId={pinnedAssetId} label={pinnedAssetLabel} />
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="doc-type">{t("documents.fields.type")}</Label>
        {documentTypesFailed && <ErrorBanner message={t("documents.typesFailed")} />}
        <Select
          value={typeCode || null}
          onValueChange={(value) => setTypeCode(value ?? "")}
          disabled={renews !== undefined || documentTypesFailed}
        >
          <SelectTrigger className="min-h-11" id="doc-type">
            <SelectValue placeholder={t("assets.form.choose")} />
          </SelectTrigger>
          <SelectContent>
            {(typesQuery.data ?? []).map((type) => (
              <SelectItem key={type.code} value={type.code}>
                {localizedLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-title">{t("documents.fields.title")}</Label>
          <Input
            id="doc-title"
            className="min-h-11"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-number">{t("documents.fields.number")}</Label>
          <Input
            id="doc-number"
            className="min-h-11"
            value={documentNumber}
            onChange={(event) => setDocumentNumber(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-issued">{t("documents.fields.issuedAt")}</Label>
          <DateField id="doc-issued" value={issuedAt} onChange={setIssuedAt} />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-expires">{t("documents.fields.expiresAt")}</Label>
          <DateField id="doc-expires" value={expiresAt} onChange={setExpiresAt} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("finance.record.evidenceLabel")}</span>
        <FileUpload
          accept="image/jpeg,image/png,image/webp,application/pdf"
          onChange={setArtifactIds}
          onUploadingChange={setAttachmentsUploading}
        />
      </div>
    </CommandForm>
  );
}
