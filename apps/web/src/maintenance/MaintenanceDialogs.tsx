import { useRef, useState } from "react";
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
import {
  CommandForm,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/money-input.js";
import { useActiveSession } from "../auth/store.js";
import { PinnedAssetField } from "../assets/PinnedAssetField.js";
import { useAssetOptions } from "../assets/useAssetOptions.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { parseMoneyXaf } from "../finance/model.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { ALL_BRANCHES } from "../shell/branch-context.js";
import { workOrderReference } from "./columns.js";
import { maintenanceQueryKey, useIssues } from "./useMaintenance.js";

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

/** What a decision on a signalement needs: the row, its version, what it says. */
export type IssueRef = Pick<IssueListItem, "id" | "rowVersion" | "description">;

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
 * What every maintenance form takes from its host: where it renders, the
 * record it was opened from, and what to do once it is finished. `onDone` runs
 * after a commit (the host refreshes its own reads there), `onDismiss` after
 * either a commit or a cancel.
 */
export interface MaintenanceFormHost {
  surface: CommandSurface;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * Every maintenance write moves the queue, the signalements and the open
 * sheet's detail; one prefix covers all three (ADR-0001 — the server decides
 * what a row now says, never the client).
 */
function useMaintenanceCommit() {
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: maintenanceQueryKey(session?.workspaceSlug),
    });

  return {
    commit: async (successKey: string, warnings: readonly string[]) => {
      notifyCommandSuccess("maintenance", successKey, warnings);
      await invalidate();
    },
    invalidate,
  };
}

/** The labels and outcome wiring every maintenance form shares. */
function useMaintenanceChrome(host: MaintenanceFormHost) {
  const { t } = useTranslation();
  const { commit, invalidate } = useMaintenanceCommit();

  return {
    commit,
    finish: () => {
      host.onDone?.();
      host.onDismiss();
    },
    chrome: {
      surface: host.surface,
      back: host.back,
      submittingLabel: t("maintenance.actions.submitting"),
      cancelLabel: t("maintenance.actions.cancel"),
      onReload: async () => {
        await invalidate();
        host.onDismiss();
      },
      onDismiss: host.onDismiss,
    },
  };
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

export function ReportIssueForm({
  pinnedAssetId,
  pinnedAssetLabel,
  ...host
}: MaintenanceFormHost & {
  /** Opened from a vehicle, the signalement is filed against it alone. */
  pinnedAssetId?: string | undefined;
  pinnedAssetLabel?: string | undefined;
}) {
  const { t } = useTranslation();
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  // Minted once per opening: a retry replays the same signalement rather than
  // filing a second one beside it (§6, offline capture).
  const issueId = useRef(crypto.randomUUID());
  const [chosenAssetId, setAssetId] = useState("");
  const [description, setDescription] = useState("");
  const [safetyCritical, setSafetyCritical] = useState(false);
  const [category, setCategory] = useState("");
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const intent = useRef<CommandIntent<ReportIssuePayload> | undefined>(undefined);

  const assetId = pinnedAssetId ?? chosenAssetId;
  const trimmedDescription = description.trim();
  const trimmedCategory = category.trim();
  const ready = !uploading && assetId !== "" && trimmedDescription !== "";

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<ReportIssuePayload>(client, "report-issue", 1);
      return intent.current.submit(
        {
          issueId: issueId.current,
          assetId,
          description: trimmedDescription,
          safetyCritical,
          ...(trimmedCategory === "" ? {} : { category: trimmedCategory }),
        },
        artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {},
      );
    });
    if (!result.ok) return;
    await commit("issueReported", result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("maintenance.issues.new")}
      description={t("maintenance.issues.newHint")}
      error={submission.error}
      submitLabel={t("maintenance.issues.newSubmit")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      {pinnedAssetId === undefined ? (
        <AssetField id="issue-asset" value={chosenAssetId} onChange={setAssetId} />
      ) : (
        <PinnedAssetField assetId={pinnedAssetId} label={pinnedAssetLabel} />
      )}

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

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("maintenance.fields.photos")}</span>
        <FileUpload
          accept="image/*"
          onChange={setArtifactIds}
          onUploadingChange={setUploading}
        />
      </div>
    </CommandForm>
  );
}

interface CreateWorkOrderProps extends MaintenanceFormHost {
  /** Prefilled when the form was opened from a signalement row. */
  issue?: IssueListItem | undefined;
  /**
   * Signalements the host already loaded, offered for the chosen asset. A
   * form pinned to one vehicle loads that vehicle's open ones itself.
   */
  issues?: readonly IssueListItem[] | undefined;
  pinnedAssetId?: string | undefined;
  pinnedAssetLabel?: string | undefined;
}

export function CreateWorkOrderForm(props: CreateWorkOrderProps) {
  if (props.issues === undefined && props.pinnedAssetId !== undefined) {
    return <CreateWorkOrderWithOpenIssues {...props} assetId={props.pinnedAssetId} />;
  }
  return <CreateWorkOrderFields {...props} issues={props.issues ?? []} />;
}

function CreateWorkOrderWithOpenIssues(props: CreateWorkOrderProps & { assetId: string }) {
  const issuesQuery = useIssues({
    assetId: props.assetId,
    status: "OPEN",
    branchId: ALL_BRANCHES,
  });
  const issues = issuesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  return <CreateWorkOrderFields {...props} issues={issues} />;
}

function CreateWorkOrderFields({
  issue,
  issues,
  pinnedAssetId,
  pinnedAssetLabel,
  ...host
}: CreateWorkOrderProps & { issues: readonly IssueListItem[] }) {
  const { t } = useTranslation();
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  const workOrderId = useRef(crypto.randomUUID());
  const [chosenAssetId, setAssetId] = useState(issue?.asset.id ?? "");
  const [issueId, setIssueId] = useState(issue?.id ?? "");
  const [description, setDescription] = useState("");
  const [expectedCost, setExpectedCost] = useState("");
  const intent = useRef<CommandIntent<CreateWorkOrderPayload> | undefined>(undefined);

  const assetId = pinnedAssetId ?? chosenAssetId;
  const trimmedDescription = description.trim();
  const expectedCostMinor = parseMoneyXaf(expectedCost);
  const costUsable = expectedCost.trim() === "" || expectedCostMinor !== null;
  const ready = assetId !== "" && trimmedDescription !== "" && costUsable;

  // A work order references at most one signalement, and it has to be one filed
  // against the same truck — the server rejects the pairing otherwise. A
  // resolved or dismissed signalement has nothing left for a repair to answer.
  const linkable = issues.filter(
    (candidate) => candidate.asset.id === assetId && candidate.status === "OPEN",
  );

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<CreateWorkOrderPayload>(
        client,
        "create-work-order",
        1,
      );
      return intent.current.submit({
        workOrderId: workOrderId.current,
        assetId,
        description: trimmedDescription,
        currency: "XAF",
        ...(issueId === "" ? {} : { issueId }),
        ...(expectedCostMinor === null ? {} : { expectedCostMinor }),
      });
    });
    if (!result.ok) return;
    await commit("workOrderCreated", result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("maintenance.workOrders.new")}
      description={t("maintenance.workOrders.newHint")}
      error={submission.error}
      submitLabel={t("maintenance.workOrders.newSubmit")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      {pinnedAssetId === undefined ? (
        <AssetField
          id="work-order-asset"
          value={chosenAssetId}
          disabled={issue !== undefined}
          onChange={(next) => {
            setAssetId(next);
            // The signalement belongs to the old truck; keeping it would send an
            // ISSUE_ASSET_MISMATCH the operator never chose.
            setIssueId("");
          }}
        />
      ) : (
        <PinnedAssetField assetId={pinnedAssetId} label={pinnedAssetLabel} />
      )}

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
            {(issue !== undefined && !linkable.some((c) => c.id === issue.id)
              ? [issue, ...linkable]
              : linkable
            ).map((candidate) => (
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
    </CommandForm>
  );
}

export function CompleteWorkOrderForm({
  workOrder,
  ...host
}: MaintenanceFormHost & { workOrder: WorkOrderRef }) {
  const { t } = useTranslation();
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  const [actualCost, setActualCost] = useState("");
  const [summary, setSummary] = useState("");
  const [resolveLinkedIssue, setResolveLinkedIssue] = useState(true);
  const intent = useRef<CommandIntent<CompleteWorkOrderPayload> | undefined>(undefined);

  const actualCostMinor = parseMoneyXaf(actualCost);
  const costUsable = actualCost.trim() === "" || actualCostMinor !== null;
  const trimmedSummary = summary.trim();
  const hasIssue = workOrder.issueId !== null;

  async function submit() {
    if (!costUsable) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<CompleteWorkOrderPayload>(
        client,
        "complete-work-order",
        1,
      );
      return intent.current.submit(
        {
          workOrderId: workOrder.id,
          currency: "XAF",
          ...(actualCostMinor === null ? {} : { actualCostMinor }),
          ...(trimmedSummary === "" ? {} : { summary: trimmedSummary }),
          ...(hasIssue ? { resolveLinkedIssue } : {}),
        },
        { expectedVersion: workOrder.rowVersion },
      );
    });
    if (!result.ok) return;
    await commit("completionDeclared", result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("maintenance.actions.completeTitle")}
      description={t("maintenance.actions.completeHint")}
      error={submission.error}
      submitLabel={t("maintenance.actions.complete")}
      ready={costUsable}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
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
    </CommandForm>
  );
}

export function CancelWorkOrderForm({
  workOrder,
  ...host
}: MaintenanceFormHost & { workOrder: WorkOrderRef }) {
  const { t } = useTranslation();
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  const [reason, setReason] = useState("");
  const intent = useRef<CommandIntent<CancelWorkOrderPayload> | undefined>(undefined);

  // A cancellation with no motive leaves the audit trail unable to answer why
  // the job never happened, which is the only question it will be asked.
  const trimmedReason = reason.trim();
  const ready = trimmedReason !== "";

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<CancelWorkOrderPayload>(
        client,
        "cancel-work-order",
        1,
      );
      return intent.current.submit(
        { workOrderId: workOrder.id, reason: trimmedReason },
        { expectedVersion: workOrder.rowVersion },
      );
    });
    if (!result.ok) return;
    await commit("workOrderCancelled", result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("maintenance.actions.cancelWorkOrderTitle")}
      description={t("maintenance.actions.cancelWorkOrderHint")}
      error={submission.error}
      submitLabel={t("maintenance.actions.cancelWorkOrder")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
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
    </CommandForm>
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
 * One decision on one record. An approval or a resolution may carry a note; a
 * refusal or a dismissal must say why, because the trail is the only place the
 * motive survives.
 */
function DecisionForm({
  spec,
  subject,
  expectedVersion,
  context,
  ...host
}: MaintenanceFormHost & {
  spec: DecisionSpec;
  subject: DecisionPayload;
  expectedVersion: number;
  /** What the decision is about, when the form was not opened from its record. */
  context?: string | undefined;
}) {
  const { t } = useTranslation();
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  const [value, setValue] = useState("");
  const intent = useRef<CommandIntent<DecisionPayload> | undefined>(undefined);

  const trimmed = value.trim();
  const ready = spec.text === "note" || trimmed !== "";

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<DecisionPayload>(client, spec.command, 1);
      return intent.current.submit(
        { ...subject, ...(trimmed === "" ? {} : { [spec.text]: trimmed }) },
        { expectedVersion },
      );
    });
    if (!result.ok) return;
    await commit(spec.successKey, result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={t(spec.title)}
      description={t(spec.hint)}
      error={submission.error}
      submitLabel={t(spec.submit)}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      {context !== undefined && (
        <p className="text-sm text-muted-foreground">{context}</p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="decision-text">{t(`maintenance.fields.${spec.text}`)}</Label>
        <Textarea
          id="decision-text"
          maxLength={500}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
    </CommandForm>
  );
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

export function WorkOrderDecisionForm({
  workOrder,
  decision,
  ...host
}: MaintenanceFormHost & { workOrder: WorkOrderRef; decision: WorkOrderDecision }) {
  return (
    <DecisionForm
      {...host}
      spec={WORK_ORDER_DECISIONS[decision]}
      subject={{ workOrderId: workOrder.id }}
      expectedVersion={workOrder.rowVersion}
    />
  );
}

export function IssueDecisionForm({
  issue,
  decision,
  ...host
}: MaintenanceFormHost & { issue: IssueRef; decision: IssueDecision }) {
  return (
    <DecisionForm
      {...host}
      spec={ISSUE_DECISIONS[decision]}
      subject={{ issueId: issue.id }}
      expectedVersion={issue.rowVersion}
      context={issue.description}
    />
  );
}

/**
 * What a return to service stands on. Normally the completed work order that
 * answered the grounding signalement; failing that, the signalement itself once
 * it was resolved or dismissed, with a reason saying why no repair was needed.
 */
export type ReleaseSubject =
  | { kind: "work-order"; workOrder: WorkOrderRef }
  | { kind: "override"; assetId: string; issue: IssueRef };

export function ReleaseForm({
  subject,
  ...host
}: MaintenanceFormHost & { subject: ReleaseSubject }) {
  const { t } = useTranslation();
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  const [note, setNote] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const intent = useRef<CommandIntent<ReleaseAssetPayload> | undefined>(undefined);

  const trimmedNote = note.trim();
  const trimmedReason = overrideReason.trim();
  const ready = subject.kind === "work-order" || trimmedReason !== "";

  async function submit() {
    if (!ready) return;
    // The version quoted is the record the release stands on: the work order,
    // or on the override path the grounding signalement (the server checks
    // the same row).
    const payload: ReleaseAssetPayload =
      subject.kind === "work-order"
        ? { assetId: subject.workOrder.assetId, workOrderId: subject.workOrder.id }
        : { assetId: subject.assetId, overrideReason: trimmedReason };
    const expectedVersion =
      subject.kind === "work-order" ? subject.workOrder.rowVersion : subject.issue.rowVersion;

    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<ReleaseAssetPayload>(
        client,
        "release-asset-to-service",
        1,
      );
      return intent.current.submit(
        { ...payload, ...(trimmedNote === "" ? {} : { note: trimmedNote }) },
        { expectedVersion },
      );
    });
    if (!result.ok) return;
    await commit("assetReleased", result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("maintenance.actions.releaseTitle")}
      description={t("maintenance.actions.releaseHint")}
      error={submission.error}
      submitLabel={t("maintenance.actions.release")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <p className="text-sm text-muted-foreground">
        {subject.kind === "work-order"
          ? t("maintenance.actions.releaseSubject", {
              reference: workOrderReference(subject.workOrder.id),
            })
          : subject.issue.description}
      </p>

      {subject.kind === "override" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="release-override-reason">
            {t("maintenance.fields.overrideReason")}
          </Label>
          <Textarea
            id="release-override-reason"
            maxLength={500}
            value={overrideReason}
            onChange={(event) => setOverrideReason(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {t("maintenance.fields.overrideReasonHint")}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="work-order-release-note">{t("maintenance.fields.note")}</Label>
        <Textarea
          id="work-order-release-note"
          maxLength={500}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </CommandForm>
  );
}

// The /maintenance screen opens each form as a dialog.

interface DialogHost {
  client?: CommandClient;
  onDismiss: () => void;
}

export function ReportIssueDialog(props: DialogHost) {
  return <ReportIssueForm surface="dialog" {...props} />;
}

export function CreateWorkOrderDialog({
  issues,
  ...props
}: DialogHost & {
  issue?: IssueListItem | undefined;
  issues: readonly IssueListItem[];
}) {
  return <CreateWorkOrderForm surface="dialog" issues={issues} {...props} />;
}

export function CompleteWorkOrderDialog(props: DialogHost & { workOrder: WorkOrderRef }) {
  return <CompleteWorkOrderForm surface="dialog" {...props} />;
}

export function CancelWorkOrderDialog(props: DialogHost & { workOrder: WorkOrderRef }) {
  return <CancelWorkOrderForm surface="dialog" {...props} />;
}

export function WorkOrderDecisionDialog(
  props: DialogHost & { workOrder: WorkOrderRef; decision: WorkOrderDecision },
) {
  return <WorkOrderDecisionForm surface="dialog" {...props} />;
}

export function IssueDecisionDialog(
  props: DialogHost & { issue: IssueListItem; decision: IssueDecision },
) {
  return <IssueDecisionForm surface="dialog" {...props} />;
}

export function ReleaseAssetDialog({
  workOrder,
  ...props
}: DialogHost & { workOrder: WorkOrderRef }) {
  return (
    <ReleaseForm surface="dialog" subject={{ kind: "work-order", workOrder }} {...props} />
  );
}
