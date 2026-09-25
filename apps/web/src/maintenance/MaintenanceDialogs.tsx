import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import type {
  cancelWorkOrderPayload,
  completeWorkOrderPayload,
  createWorkOrderPayload,
  IssueListItem,
  releaseAssetToServicePayload,
  reportIssuePayload,
  WorkOrderStatus,
} from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ErrorBanner } from "@/components/error-banner.js";
import { MoneyInput } from "@/components/money-input.js";
import { useActiveSession } from "../auth/store.js";
import { useAssetOptions } from "../assets/useAssetOptions.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { parseMoneyXaf } from "../finance/model.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { ALL_BRANCHES } from "../shell/branch-context.js";
import { workOrderReference } from "./columns.js";
import { maintenanceQueryKey } from "./useMaintenance.js";

type ReportIssuePayload = z.infer<typeof reportIssuePayload>;
type CreateWorkOrderPayload = z.infer<typeof createWorkOrderPayload>;
type CompleteWorkOrderPayload = z.infer<typeof completeWorkOrderPayload>;
type CancelWorkOrderPayload = z.infer<typeof cancelWorkOrderPayload>;
type ReleaseAssetPayload = z.infer<typeof releaseAssetToServicePayload>;
type DecisionPayload = Readonly<Record<string, string>>;

/**
 * What a decision or completion dialog needs to address one work order. No
 * currency: the command contracts pin it to XAF (`currencyCode` is a literal),
 * so carrying the row's own value here would only invite a payload the schema
 * rejects.
 */
export interface WorkOrderRef {
  id: string;
  assetId: string;
  status: WorkOrderStatus;
  /** The signalement the order answers; null on preventive work. */
  issueId: string | null;
  /** §5.3 optimistic concurrency — quoted on every work-order mutation. */
  rowVersion: number;
}

export type WorkOrderDecision =
  | "approve"
  | "reject"
  | "approve-completion"
  | "reject-completion";

export type IssueDecision = "resolve" | "dismiss";

export type MaintenanceDialog =
  | { kind: "none" }
  | { kind: "report-issue" }
  /** Opened from an issue row, the signalement is fixed and the asset with it. */
  | { kind: "create-work-order"; issue?: IssueListItem }
  | { kind: "decide-work-order"; decision: WorkOrderDecision; workOrder: WorkOrderRef }
  | { kind: "complete"; workOrder: WorkOrderRef }
  | { kind: "cancel"; workOrder: WorkOrderRef }
  | { kind: "release"; workOrder: WorkOrderRef }
  | { kind: "decide-issue"; decision: IssueDecision; issue: IssueListItem };

/**
 * Every maintenance write moves the queue, the signalements and the open
 * sheet's detail; one prefix covers all three (ADR-0001 — the server decides
 * what a row now says, never the client).
 */
function useMaintenanceCommit() {
  const queryClient = useQueryClient();
  const session = useActiveSession();

  return async (successKey: string, warnings: readonly string[]) => {
    notifyCommandSuccess("maintenance", successKey, warnings);
    await queryClient.invalidateQueries({
      queryKey: maintenanceQueryKey(session?.workspaceSlug),
    });
  };
}

/**
 * The shell every maintenance form shares: title, error banner, fields, and the
 * two-button footer. Keeps each dialog down to the fields that differ.
 */
function CommandDialog({
  title,
  description,
  error,
  submitLabel,
  ready,
  submitting,
  onSubmit,
  onDismiss,
  children,
}: {
  title: string;
  description?: string;
  error: string | undefined;
  submitLabel: string;
  ready: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description !== undefined && (
            <DialogDescription>{description}</DialogDescription>
          )}
        </DialogHeader>

        {error !== undefined && <ErrorBanner code={error} />}

        {children}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 flex-1 sm:flex-none"
            onClick={onDismiss}
          >
            {t("maintenance.actions.cancel")}
          </Button>
          <Button
            type="button"
            className="min-h-11 flex-1 sm:flex-none"
            disabled={!ready}
            onClick={onSubmit}
          >
            {submitting ? t("maintenance.actions.submitting") : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssetField({
  id,
  value,
  onChange,
  disabled = false,
}: {
  id: string;
  value: string;
  onChange: (assetId: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  // The whole fleet: the ambient branch narrows collections, never what a
  // command may reference (`branch-scope.ts`).
  const options = useAssetOptions(ALL_BRANCHES);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t("maintenance.fields.asset")}</Label>
      <Select
        value={value || null}
        disabled={disabled}
        onValueChange={(next) => onChange((next as string | null) ?? "")}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          aria-label={t("maintenance.fields.asset")}
        >
          <SelectValue placeholder={t("maintenance.fields.choose")} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ReportIssueDialog({
  client = commandClient,
  onDismiss,
}: {
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useMaintenanceCommit();
  // Minted once per opening: a retry replays the same signalement rather than
  // filing a second one beside it (§6, offline capture).
  const issueId = useRef(crypto.randomUUID());
  const [assetId, setAssetId] = useState("");
  const [description, setDescription] = useState("");
  const [safetyCritical, setSafetyCritical] = useState(false);
  const [category, setCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<ReportIssuePayload> | undefined>(undefined);

  const trimmedDescription = description.trim();
  const trimmedCategory = category.trim();
  const ready = !submitting && assetId !== "" && trimmedDescription !== "";

  async function submit() {
    if (!ready) return;
    setError(undefined);
    setSubmitting(true);

    intent.current ??= createCommandIntent<ReportIssuePayload>(client, "report-issue", 1);
    const result = await intent.current.submit({
      issueId: issueId.current,
      assetId,
      description: trimmedDescription,
      safetyCritical,
      ...(trimmedCategory === "" ? {} : { category: trimmedCategory }),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("issueReported", result.outcome.warnings);
    onDismiss();
  }

  return (
    <CommandDialog
      title={t("maintenance.issues.new")}
      description={t("maintenance.issues.newHint")}
      error={error}
      submitLabel={t("maintenance.issues.newSubmit")}
      ready={ready}
      submitting={submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      <AssetField id="issue-asset" value={assetId} onChange={setAssetId} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="issue-description">{t("maintenance.fields.description")}</Label>
        <Textarea
          id="issue-description"
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="issue-category">{t("maintenance.fields.category")}</Label>
        <Input
          id="issue-category"
          maxLength={80}
          placeholder={t("maintenance.fields.categoryPlaceholder")}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        />
      </div>

      {/* Safety-critical grounds the truck the moment it is filed — the caption
          says so, because the checkbox is not reversible from this screen. */}
      <div className="flex items-start gap-2">
        <Checkbox
          id="issue-safety"
          checked={safetyCritical}
          aria-label={t("maintenance.fields.safetyCritical")}
          onCheckedChange={(checked) => setSafetyCritical(checked === true)}
        />
        <Label htmlFor="issue-safety" className="flex flex-col items-start gap-0.5">
          <span>{t("maintenance.fields.safetyCritical")}</span>
          <span className="text-xs font-normal text-muted-foreground">
            {t("maintenance.fields.safetyCriticalHint")}
          </span>
        </Label>
      </div>
    </CommandDialog>
  );
}

export function CreateWorkOrderDialog({
  issue,
  issues,
  client = commandClient,
  onDismiss,
}: {
  /** Prefilled when the form was opened from a signalement row. */
  issue?: IssueListItem | undefined;
  /** Signalements already loaded by the screen, offered for the chosen asset. */
  issues: readonly IssueListItem[];
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useMaintenanceCommit();
  const workOrderId = useRef(crypto.randomUUID());
  const [assetId, setAssetId] = useState(issue?.asset.id ?? "");
  const [issueId, setIssueId] = useState(issue?.id ?? "");
  const [description, setDescription] = useState("");
  const [expectedCost, setExpectedCost] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<CreateWorkOrderPayload> | undefined>(undefined);

  const trimmedDescription = description.trim();
  const expectedCostMinor = parseMoneyXaf(expectedCost);
  const costUsable = expectedCost.trim() === "" || expectedCostMinor !== null;
  const ready =
    !submitting && assetId !== "" && trimmedDescription !== "" && costUsable;

  // A work order references at most one signalement, and it has to be one filed
  // against the same truck — the server rejects the pairing otherwise. A
  // resolved or dismissed signalement has nothing left for a repair to answer.
  const linkable = issues.filter(
    (candidate) => candidate.asset.id === assetId && candidate.status === "OPEN",
  );

  async function submit() {
    if (!ready) return;
    setError(undefined);
    setSubmitting(true);

    intent.current ??= createCommandIntent<CreateWorkOrderPayload>(
      client,
      "create-work-order",
      1,
    );
    const result = await intent.current.submit({
      workOrderId: workOrderId.current,
      assetId,
      description: trimmedDescription,
      currency: "XAF",
      ...(issueId === "" ? {} : { issueId }),
      ...(expectedCostMinor === null ? {} : { expectedCostMinor }),
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("workOrderCreated", result.outcome.warnings);
    onDismiss();
  }

  return (
    <CommandDialog
      title={t("maintenance.workOrders.new")}
      description={t("maintenance.workOrders.newHint")}
      error={error}
      submitLabel={t("maintenance.workOrders.newSubmit")}
      ready={ready}
      submitting={submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      <AssetField
        id="work-order-asset"
        value={assetId}
        disabled={issue !== undefined}
        onChange={(next) => {
          setAssetId(next);
          // The signalement belongs to the old truck; keeping it would send an
          // ISSUE_ASSET_MISMATCH the operator never chose.
          setIssueId("");
        }}
      />

      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-issue">{t("maintenance.fields.issue")}</Label>
        <Select
          value={issueId || null}
          disabled={issue !== undefined}
          onValueChange={(next) => setIssueId((next as string | null) ?? "")}
        >
          <SelectTrigger
            id="work-order-issue"
            className="w-full"
            aria-label={t("maintenance.fields.issue")}
          >
            <SelectValue placeholder={t("maintenance.fields.preventive")} />
          </SelectTrigger>
          <SelectContent>
            {linkable.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {t("maintenance.fields.issueHint")}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-description">
          {t("maintenance.fields.description")}
        </Label>
        <Textarea
          id="work-order-description"
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-expected-cost">
          {t("maintenance.fields.expectedCost")}
        </Label>
        <MoneyInput
          id="work-order-expected-cost"
          aria-label={t("maintenance.fields.expectedCost")}
          value={expectedCost}
          onValueChange={setExpectedCost}
        />
      </div>
    </CommandDialog>
  );
}

export function CompleteWorkOrderDialog({
  workOrder,
  client = commandClient,
  onDismiss,
}: {
  workOrder: WorkOrderRef;
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useMaintenanceCommit();
  const [actualCost, setActualCost] = useState("");
  const [summary, setSummary] = useState("");
  const [resolveLinkedIssue, setResolveLinkedIssue] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<CompleteWorkOrderPayload> | undefined>(undefined);

  const actualCostMinor = parseMoneyXaf(actualCost);
  const costUsable = actualCost.trim() === "" || actualCostMinor !== null;
  const trimmedSummary = summary.trim();
  const hasIssue = workOrder.issueId !== null;
  const ready = !submitting && costUsable;

  async function submit() {
    if (!ready) return;
    setError(undefined);
    setSubmitting(true);

    intent.current ??= createCommandIntent<CompleteWorkOrderPayload>(
      client,
      "complete-work-order",
      1,
    );
    const result = await intent.current.submit(
      {
        workOrderId: workOrder.id,
        currency: "XAF",
        ...(actualCostMinor === null ? {} : { actualCostMinor }),
        ...(trimmedSummary === "" ? {} : { summary: trimmedSummary }),
        ...(hasIssue ? { resolveLinkedIssue } : {}),
      },
      { expectedVersion: workOrder.rowVersion },
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("completionDeclared", result.outcome.warnings);
    onDismiss();
  }

  return (
    <CommandDialog
      title={t("maintenance.actions.completeTitle")}
      description={t("maintenance.actions.completeHint")}
      error={error}
      submitLabel={t("maintenance.actions.complete")}
      ready={ready}
      submitting={submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-actual-cost">
          {t("maintenance.fields.actualCost")}
        </Label>
        <MoneyInput
          id="work-order-actual-cost"
          aria-label={t("maintenance.fields.actualCost")}
          value={actualCost}
          onValueChange={setActualCost}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-summary">{t("maintenance.fields.summary")}</Label>
        <Textarea
          id="work-order-summary"
          maxLength={500}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
        />
      </div>

      {hasIssue && (
        <div className="flex items-start gap-2">
          <Checkbox
            id="work-order-resolve-issue"
            checked={resolveLinkedIssue}
            aria-label={t("maintenance.fields.resolveLinkedIssue")}
            onCheckedChange={(checked) => setResolveLinkedIssue(checked === true)}
          />
          <Label
            htmlFor="work-order-resolve-issue"
            className="flex flex-col items-start gap-0.5"
          >
            <span>{t("maintenance.fields.resolveLinkedIssue")}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("maintenance.fields.resolveLinkedIssueHint")}
            </span>
          </Label>
        </div>
      )}
    </CommandDialog>
  );
}

export function CancelWorkOrderDialog({
  workOrder,
  client = commandClient,
  onDismiss,
}: {
  workOrder: WorkOrderRef;
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useMaintenanceCommit();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<CancelWorkOrderPayload> | undefined>(undefined);

  // A cancellation with no motive leaves the audit trail unable to answer why
  // the job never happened, which is the only question it will be asked.
  const trimmedReason = reason.trim();
  const ready = !submitting && trimmedReason !== "";

  async function submit() {
    if (!ready) return;
    setError(undefined);
    setSubmitting(true);

    intent.current ??= createCommandIntent<CancelWorkOrderPayload>(
      client,
      "cancel-work-order",
      1,
    );
    const result = await intent.current.submit(
      { workOrderId: workOrder.id, reason: trimmedReason },
      { expectedVersion: workOrder.rowVersion },
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("workOrderCancelled", result.outcome.warnings);
    onDismiss();
  }

  return (
    <CommandDialog
      title={t("maintenance.actions.cancelWorkOrderTitle")}
      description={t("maintenance.actions.cancelWorkOrderHint")}
      error={error}
      submitLabel={t("maintenance.actions.cancelWorkOrder")}
      ready={ready}
      submitting={submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-cancel-reason">{t("maintenance.fields.reason")}</Label>
        <Textarea
          id="work-order-cancel-reason"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </CommandDialog>
  );
}

/**
 * One decision on one record. An approval or a resolution may carry a note; a
 * refusal or a dismissal must say why, because the trail is the only place the
 * motive survives.
 */
function DecisionDialog({
  commandName,
  subject,
  expectedVersion,
  text,
  copy,
  context,
  successKey,
  client,
  onDismiss,
}: {
  commandName: string;
  subject: DecisionPayload;
  expectedVersion: number;
  text: "note" | "reason";
  copy: { title: string; hint: string; submit: string };
  /** What the decision is about, when the dialog was not opened from its sheet. */
  context?: string | undefined;
  successKey: string;
  client: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useMaintenanceCommit();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<DecisionPayload> | undefined>(undefined);

  const trimmed = value.trim();
  const ready = !submitting && (text === "note" || trimmed !== "");

  async function submit() {
    if (!ready) return;
    setError(undefined);
    setSubmitting(true);

    intent.current ??= createCommandIntent<DecisionPayload>(client, commandName, 1);
    const result = await intent.current.submit(
      { ...subject, ...(trimmed === "" ? {} : { [text]: trimmed }) },
      { expectedVersion },
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit(successKey, result.outcome.warnings);
    onDismiss();
  }

  return (
    <CommandDialog
      title={copy.title}
      description={copy.hint}
      error={error}
      submitLabel={copy.submit}
      ready={ready}
      submitting={submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      {context !== undefined && (
        <p className="text-sm text-muted-foreground">{context}</p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="decision-text">{t(`maintenance.fields.${text}`)}</Label>
        <Textarea
          id="decision-text"
          maxLength={500}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    </CommandDialog>
  );
}

interface DecisionSpec {
  command: string;
  text: "note" | "reason";
  successKey: string;
  title: string;
  hint: string;
  submit: string;
}

/**
 * The four work-order decisions share a shape but never a command name: the
 * audit trail keeps authorizing the spend apart from accepting what it cost,
 * and each refusal apart from its approval.
 */
const WORK_ORDER_DECISIONS: Record<WorkOrderDecision, DecisionSpec> = {
  approve: {
    command: "approve-work-order",
    text: "note",
    successKey: "workOrderApproved",
    title: "maintenance.actions.approveTitle",
    hint: "maintenance.actions.approveHint",
    submit: "maintenance.actions.approve",
  },
  reject: {
    command: "reject-work-order",
    text: "reason",
    successKey: "workOrderRejected",
    title: "maintenance.actions.rejectTitle",
    hint: "maintenance.actions.rejectHint",
    submit: "maintenance.actions.reject",
  },
  "approve-completion": {
    command: "approve-work-order-closure",
    text: "note",
    successKey: "completionApproved",
    title: "maintenance.actions.approveCompletionTitle",
    hint: "maintenance.actions.approveCompletionHint",
    submit: "maintenance.actions.approveCompletion",
  },
  "reject-completion": {
    command: "reject-work-order-completion",
    text: "reason",
    successKey: "completionRejected",
    title: "maintenance.actions.rejectCompletionTitle",
    hint: "maintenance.actions.rejectCompletionHint",
    submit: "maintenance.actions.rejectCompletion",
  },
};

const ISSUE_DECISIONS: Record<IssueDecision, DecisionSpec> = {
  resolve: {
    command: "resolve-issue",
    text: "note",
    successKey: "issueResolved",
    title: "maintenance.actions.resolveIssueTitle",
    hint: "maintenance.actions.resolveIssueHint",
    submit: "maintenance.actions.resolveIssue",
  },
  dismiss: {
    command: "dismiss-issue",
    text: "reason",
    successKey: "issueDismissed",
    title: "maintenance.actions.dismissIssueTitle",
    hint: "maintenance.actions.dismissIssueHint",
    submit: "maintenance.actions.dismissIssue",
  },
};

export function WorkOrderDecisionDialog({
  workOrder,
  decision,
  client = commandClient,
  onDismiss,
}: {
  workOrder: WorkOrderRef;
  decision: WorkOrderDecision;
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const spec = WORK_ORDER_DECISIONS[decision];

  return (
    <DecisionDialog
      commandName={spec.command}
      subject={{ workOrderId: workOrder.id }}
      expectedVersion={workOrder.rowVersion}
      text={spec.text}
      copy={{ title: t(spec.title), hint: t(spec.hint), submit: t(spec.submit) }}
      successKey={spec.successKey}
      client={client}
      onDismiss={onDismiss}
    />
  );
}

export function IssueDecisionDialog({
  issue,
  decision,
  client = commandClient,
  onDismiss,
}: {
  issue: IssueListItem;
  decision: IssueDecision;
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const spec = ISSUE_DECISIONS[decision];

  return (
    <DecisionDialog
      commandName={spec.command}
      subject={{ issueId: issue.id }}
      expectedVersion={issue.rowVersion}
      text={spec.text}
      copy={{ title: t(spec.title), hint: t(spec.hint), submit: t(spec.submit) }}
      context={issue.description}
      successKey={spec.successKey}
      client={client}
      onDismiss={onDismiss}
    />
  );
}

export function ReleaseAssetDialog({
  workOrder,
  client = commandClient,
  onDismiss,
}: {
  workOrder: WorkOrderRef;
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const commit = useMaintenanceCommit();
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const intent = useRef<CommandIntent<ReleaseAssetPayload> | undefined>(undefined);

  const trimmedNote = note.trim();

  async function submit() {
    if (submitting) return;
    setError(undefined);
    setSubmitting(true);

    intent.current ??= createCommandIntent<ReleaseAssetPayload>(
      client,
      "release-asset-to-service",
      1,
    );
    const result = await intent.current.submit(
      {
        assetId: workOrder.assetId,
        workOrderId: workOrder.id,
        ...(trimmedNote === "" ? {} : { note: trimmedNote }),
      },
      { expectedVersion: workOrder.rowVersion },
    );
    setSubmitting(false);

    if (!result.ok) {
      setError(result.code);
      return;
    }
    await commit("assetReleased", result.outcome.warnings);
    onDismiss();
  }

  return (
    <CommandDialog
      title={t("maintenance.actions.releaseTitle")}
      description={t("maintenance.actions.releaseHint")}
      error={error}
      submitLabel={t("maintenance.actions.release")}
      ready={!submitting}
      submitting={submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      <p className="text-sm text-muted-foreground">
        {t("maintenance.actions.releaseSubject", {
          reference: workOrderReference(workOrder.id),
        })}
      </p>

      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-release-note">{t("maintenance.fields.note")}</Label>
        <Textarea
          id="work-order-release-note"
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </CommandDialog>
  );
}
