import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Download, FileUp, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useActiveSession } from "@/auth/store.js";
import { useMeContext } from "@/auth/me.js";
import { commandClient } from "@/commands/instance.js";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { ErrorBanner } from "@/components/error-banner.js";
import { LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { errorMessage } from "@/lib/error-message.js";
import { useAssetRegistrationReference } from "@/reference/asset-registration.js";
import { ImportStatusBadge } from "../ImportStatusBadge.js";
import { canManageAssets } from "../permissions.js";
import { toCsv } from "./csv.js";
import { choiceLabels, headerLabels } from "./labels.js";
import {
  fieldLabelKey,
  importFields,
  parseImportFile,
  validateRows,
  type FileError,
  type ImportField,
  type RowIssue,
  type RowVerdict,
} from "./model.js";
import { sendImport, type SendResult } from "./send.js";
import { useExistingAssets } from "./useExistingAssets.js";

type Step =
  | { kind: "choose"; error?: FileError | { code: "NOT_CSV" } | { code: "READ_FAILED" } }
  | { kind: "preview"; fileName: string; verdicts: RowVerdict[] }
  | { kind: "sending"; fileName: string; total: number; done: number }
  | { kind: "done"; fileName: string; results: SendResult[]; skipped: number };

/**
 * Vehicles from a spreadsheet (#747; ARCHITECTURE.md §5.1): the file is read
 * and checked here, and each ready row is one `register-asset` sent through
 * the same command client as the form. Nothing is written in bulk.
 */
export function ImportVehiclesScreen() {
  const { t, i18n } = useTranslation();
  const me = useMeContext();
  const session = useActiveSession();
  const queryClient = useQueryClient();
  const reference = useAssetRegistrationReference();
  const existing = useExistingAssets();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: "choose" });

  const enabledPresets = me?.enabledPresets;
  const fields = useMemo(() => (enabledPresets === undefined ? [] : importFields(enabledPresets)), [enabledPresets]);

  // role-config
  if (me !== undefined && !canManageAssets(me.role, me.enabledModules)) {
    return (
      <PermissionDenied
        title={t("assets.import.title")}
        icon={<Truck className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }

  if (me === undefined || reference.data === undefined || existing.data === undefined) {
    if (reference.isError || existing.isError) {
      return (
        <PageContainer>
          <ErrorBanner message={t("common.readFailed")} />
        </PageContainer>
      );
    }
    return <PageContainer>
        <LoadingState label={t("assets.loading")} />
      </PageContainer>;
  }

  const ready = reference.data;
  const known = existing.data;
  const workspaceId = me.workspaceId;

  function downloadTemplate() {
    const separator = i18n.language.startsWith("en") ? "," : ";";
    const text = toCsv([fields.map((field) => t(fieldLabelKey(field)))], separator);
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = t("assets.import.template.fileName");
    link.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setStep({ kind: "choose", error: { code: "NOT_CSV" } });
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setStep({ kind: "choose", error: { code: "READ_FAILED" } });
      return;
    }
    const parsed = parseImportFile(text, headerLabels(i18n));
    if (!parsed.ok) {
      setStep({ kind: "choose", error: parsed.error });
      return;
    }
    const verdicts = validateRows(parsed.rows, {
      assetClasses: ready.assetClasses,
      branches: ready.branches,
      enabledPresets: me?.enabledPresets ?? [],
      ...choiceLabels(i18n),
      existing: known,
    });
    setStep({ kind: "preview", fileName: file.name, verdicts });
  }

  async function confirm(fileName: string, verdicts: RowVerdict[]) {
    const rows = verdicts.filter((v): v is Extract<RowVerdict, { status: "ready" }> => v.status === "ready");
    setStep({ kind: "sending", fileName, total: rows.length, done: 0 });
    const results = await sendImport(commandClient, workspaceId, rows, (_result, done) =>
      setStep({ kind: "sending", fileName, total: rows.length, done }),
    );
    setStep({ kind: "done", fileName, results, skipped: verdicts.length - rows.length });
    await queryClient.invalidateQueries({ queryKey: ["ws", session?.workspaceSlug, "assets"] });
  }

  const chooseFile = (
    <>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        aria-label={t("assets.import.file.choose")}
        onChange={(event) => void onFile(event)}
      />
      <Button type="button" variant={step.kind === "choose" ? "default" : "outline"} onClick={() => input.current?.click()}>
        <FileUp aria-hidden />
        {step.kind === "choose" ? t("assets.import.file.choose") : t("assets.import.file.another")}
      </Button>
    </>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t("assets.import.title")}
        description={t("assets.import.description")}
        actions={
          <Link to="/assets" className={buttonVariants({ variant: "outline" })}>
            {t("assets.import.back")}
          </Link>
        }
      />

      {step.kind === "choose" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("assets.import.template.title")}</CardTitle>
              <CardDescription>{t("assets.import.template.hint")}</CardDescription>
              <CardDescription>{t("assets.import.template.dateHint")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline" onClick={downloadTemplate}>
                <Download aria-hidden />
                {t("assets.import.template.download")}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("assets.import.file.title")}</CardTitle>
              <CardDescription>{t("assets.import.file.hint")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {step.error !== undefined && <ErrorBanner message={fileErrorMessage(t, step.error)} />}
              <div>{chooseFile}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {step.kind === "preview" && (
        <Preview
          fileName={step.fileName}
          verdicts={step.verdicts}
          chooseFile={chooseFile}
          onConfirm={() => void confirm(step.fileName, step.verdicts)}
        />
      )}

      {step.kind === "sending" && (
        <Card>
          <CardHeader>
            <CardTitle>{step.fileName}</CardTitle>
            <CardDescription aria-live="polite" className="tabular-nums">
              {t("assets.import.sending", { done: step.done, total: step.total })}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {step.kind === "done" && (
        <Results fileName={step.fileName} results={step.results} skipped={step.skipped} chooseFile={chooseFile} />
      )}
    </PageContainer>
  );
}

function Preview({
  fileName,
  verdicts,
  chooseFile,
  onConfirm,
}: {
  fileName: string;
  verdicts: RowVerdict[];
  chooseFile: React.ReactNode;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const readyCount = verdicts.filter((v) => v.status === "ready").length;
  const columns = useMemo<DataTableColumn<RowVerdict>[]>(
    () => [
      lineColumn(t),
      {
        id: "assetCode",
        header: t("assets.form.assetCode"),
        accessorFn: (verdict) => (verdict.status === "ready" ? verdict.payload.assetCode : ""),
        meta: { phone: "title", label: t("assets.form.assetCode") },
      },
      {
        id: "status",
        header: t("assets.import.columns.status"),
        cell: ({ row }) => <ImportStatusBadge status={row.original.status} />,
        meta: {
          phone: "status",
          label: t("assets.import.columns.status"),
          phoneText: (verdict) => t(`assets.import.status.${verdict.status}`),
        },
      },
      {
        id: "detail",
        header: t("assets.import.columns.detail"),
        accessorFn: (verdict) => (verdict.status === "error" ? issueText(t, verdict.issues) : ""),
        meta: { phone: "meta", label: t("assets.import.columns.detail") },
      },
    ],
    [t],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{fileName}</CardTitle>
        <CardDescription className="tabular-nums">
          {t("assets.import.preview.summary", { ready: readyCount, errors: verdicts.length - readyCount })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DataTable
          columns={columns}
          data={verdicts}
          getRowId={(verdict) => String(verdict.line)}
          pagination={{ defaultPageSize: 50 }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {chooseFile}
          <Button type="button" disabled={readyCount === 0} onClick={onConfirm}>
            {t("assets.import.confirm", { count: readyCount })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Results({
  fileName,
  results,
  skipped,
  chooseFile,
}: {
  fileName: string;
  results: SendResult[];
  skipped: number;
  chooseFile: React.ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const count = (status: SendResult["status"]) => results.filter((r) => r.status === status).length;
  const columns = useMemo<DataTableColumn<SendResult>[]>(() => {
    const statusText = (result: SendResult) => t(`assets.import.status.${resultStatus(result)}`);
    return [
      lineColumn(t),
      {
        id: "assetCode",
        header: t("assets.form.assetCode"),
        cell: ({ row }) =>
          row.original.status === "created" ? (
            <Link to="/assets/$assetId" params={{ assetId: row.original.assetId }} className="underline-offset-4 hover:underline">
              {row.original.assetCode}
            </Link>
          ) : (
            row.original.assetCode
          ),
        meta: { phone: "title", label: t("assets.form.assetCode"), phoneText: (result) => result.assetCode },
      },
      {
        id: "status",
        header: t("assets.import.columns.status"),
        cell: ({ row }) => <ImportStatusBadge status={resultStatus(row.original)} />,
        meta: { phone: "status", label: t("assets.import.columns.status"), phoneText: statusText },
      },
      {
        id: "detail",
        header: t("assets.import.columns.detail"),
        accessorFn: (result) =>
          result.status === "failed"
            ? t("assets.import.failedWith", { message: errorMessage(i18n, result.code), code: result.code })
            : result.status === "approval"
              ? errorMessage(i18n, "APPROVAL_REQUIRED")
              : "",
        meta: { phone: "meta", label: t("assets.import.columns.detail") },
      },
    ];
  }, [t, i18n]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{fileName}</CardTitle>
        <CardDescription className="tabular-nums">
          {t("assets.import.result.summary", {
            created: count("created"),
            approval: count("approval"),
            failed: count("failed"),
            skipped,
          })}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <DataTable
          columns={columns}
          data={results}
          getRowId={(result) => String(result.line)}
          pagination={{ defaultPageSize: 50 }}
        />
        <div className="flex flex-wrap justify-end gap-2">
          {chooseFile}
          <Link to="/assets" className={buttonVariants()}>
            {t("assets.import.back")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function resultStatus(result: SendResult) {
  return result.status === "created" && result.replay ? "replayed" : result.status;
}

function lineColumn<T extends { line: number }>(t: TFunction): DataTableColumn<T> {
  return {
    id: "line",
    header: t("assets.import.columns.line"),
    accessorFn: (row) => row.line,
    cell: ({ row }) => <span className="tabular-nums">{row.original.line}</span>,
    meta: {
      phone: "meta",
      label: t("assets.import.columns.line"),
      phoneText: (row) => t("assets.import.lineNumber", { line: row.line }),
    },
  };
}

function issueText(t: TFunction, issues: readonly RowIssue[]): string {
  return issues
    .map((issue) => t(`assets.import.issues.${issue.code}`, { field: fieldName(t, issue.field) }))
    .join(" · ");
}

function fieldName(t: TFunction, field: ImportField): string {
  return t(fieldLabelKey(field));
}

function fileErrorMessage(t: TFunction, error: FileError | { code: "NOT_CSV" } | { code: "READ_FAILED" }): string {
  switch (error.code) {
    case "UNKNOWN_HEADER":
      return error.header === ""
        ? t("assets.import.fileErrors.UNNAMED_COLUMN")
        : t("assets.import.fileErrors.UNKNOWN_HEADER", { header: error.header });
    case "DUPLICATE_HEADER":
      return t("assets.import.fileErrors.DUPLICATE_HEADER", { header: error.header });
    case "MISSING_HEADER":
      return t("assets.import.fileErrors.MISSING_HEADER", { header: fieldName(t, error.field) });
    case "TOO_MANY_ROWS":
      return t("assets.import.fileErrors.TOO_MANY_ROWS", { count: error.count, max: error.max });
    case "UNCLOSED_QUOTE":
      return t("assets.import.fileErrors.UNCLOSED_QUOTE", { line: error.line });
    default:
      return t(`assets.import.fileErrors.${error.code}`);
  }
}
