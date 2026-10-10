import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type {
  cancelWorkOrderPayload,
  ChangeIssueSeverityPayload,
  CompleteWorkOrderInput,
  createWorkOrderPayload,
  IssueListItem,
  releaseAssetToServicePayload,
  reportIssuePayload,
  WorkOrderStatus,
} from "@routiq/contracts";
import {
  CommandForm,
  ReasonField,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FileUpload } from "@/components/ui/file-upload";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
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
import { useMeContext } from "../auth/me.js";
import { useWorkspaceToday } from "../auth/workspace-day.js";
import { useActiveSession } from "../auth/store.js";
import { PinnedAssetField } from "../assets/PinnedAssetField.js";
import { useCategories } from "../categories/useCategories.js";
import { canAddWorkOrderCost } from "../finance/permissions.js";
import { formatDate, formatMoney, localizedLabel } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { useAssetOptions } from "../assets/useAssetOptions.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { useCommandLabel, type CommandName } from "../commands/labels.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { parseMoneyXaf } from "../lib/format.js";
import { notifyCommandSuccess } from "../lib/notify.js";
import { ALL_BRANCHES } from "../shell/branch-context.js";
import { recordNumberText } from "@/lib/record-number.js";
import {
  defaultCostChoice,
  newCostLine,
  recordedCost,
  REPAIR_CATEGORY_CODE,
  toCompletionCost,
  type CostChoice,
  type CostLineDraft,
} from "./close-cost.js";
import { maintenanceQueryKey, useIssues, useWorkOrder } from "./useMaintenance.js";

type ReportIssuePayload = z.infer<typeof reportIssuePayload>;
type CreateWorkOrderPayload = z.infer<typeof createWorkOrderPayload>;
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
  /** The server's number (#608); null until it has one. */
  number: number | null;
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
  | { kind: "decide-issue"; decision: IssueDecision; issue: IssueListItem }
  | { kind: "issue-severity"; raise: boolean; issue: IssueListItem };

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
  const label = useCommandLabel();
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
  const issueTypes = useCategories("ISSUE_TYPE");
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const intent = useRef<CommandIntent<ReportIssuePayload> | undefined>(undefined);

  const assetId = pinnedAssetId ?? chosenAssetId;
  const trimmedDescription = description.trim();
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
          // The category's stable code, like every other category reference.
          ...(category === "" ? {} : { category }),
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
      title={label("report-issue")}
      description={t("maintenance.issues.newHint")}
      error={submission.error}
      command="report-issue"
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
        <Select
          value={category || null}
          onValueChange={(next) => {
            const code = (next as string | null) ?? "";
            setCategory(code);
            // A kind of fault that is usually dangerous pre-checks the box; the
            // reporter can still untick it.
            const picked = issueTypes.data?.find((type) => type.code === code);
            if (picked !== undefined) setSafetyCritical(picked.defaultSafetyCritical === true);
          }}
        >
          <SelectTrigger
            id="issue-category"
            className="w-full"
            aria-label={t("maintenance.fields.category")}
          >
            <SelectValue placeholder={t("maintenance.fields.choose")} />
          </SelectTrigger>
          <SelectContent>
            {(issueTypes.data ?? []).map((type) => (
              <SelectItem key={type.code} value={type.code}>
                {localizedLabel(type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
  const label = useCommandLabel();
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
  // Required: the approval threshold is read against it; 0 means no spend foreseen.
  const expectedCostMinor = parseMoneyXaf(expectedCost);
  const ready = assetId !== "" && trimmedDescription !== "" && expectedCostMinor !== null;

  // A work order references at most one signalement, and it has to be one filed
  // against the same truck — the server rejects the pairing otherwise. A
  // resolved or dismissed signalement has nothing left for a repair to answer.
  const linkable = issues.filter(
    (candidate) => candidate.asset.id === assetId && candidate.status === "OPEN",
  );

  async function submit() {
    if (!ready || expectedCostMinor === null) return;
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
        expectedCostMinor,
      });
    });
    if (!result.ok) return;
    await commit("workOrderCreated", result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={label("create-work-order")}
      description={t("maintenance.workOrders.newHint")}
      error={submission.error}
      command="create-work-order"
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

interface CloseFormValues {
  summary: string;
  resolveLinkedIssue: boolean;
  lines: CostLineDraft[];
}

/**
 * Closing a work order, with its cost (#81). The closer says what was done and
 * what it cost: one amount with everything else pre-filled (the repair
 * category, today, the truck, its branch, this order), or one of two explicit
 * alternatives. The expected cost is a hint, never a value. Costs already in
 * the books are shown first and nothing is added unless the closer says so.
 */
export function CompleteWorkOrderForm({
  workOrder,
  ...host
}: MaintenanceFormHost & { workOrder: WorkOrderRef }) {
  const { t, i18n } = useTranslation();
  const label = useCommandLabel();
  const locale = i18n.language;
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  const me = useMeContext();
  // role-config: recording cost is record-expense's right (the workshop's too).
  const canRecordCost = canAddWorkOrderCost(me?.role, me?.enabledModules);
  const detailQuery = useWorkOrder(workOrder.id);
  const detail = detailQuery.data;
  const categoriesQuery = useCategories("EXPENSE_CATEGORY", canRecordCost);
  const categories = categoriesQuery.data ?? [];
  const repairCategory = categories.find((category) => category.code === REPAIR_CATEGORY_CODE);
  // Loaded and without the repair category: the first line asks for one.
  const askCategory = categoriesQuery.isSuccess && repairCategory === undefined;
  const today = useWorkspaceToday();
  const [economicDate] = useState(today);
  const intent = useRef<CommandIntent<CompleteWorkOrderInput> | undefined>(undefined);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});

  const recorded = detail === undefined ? { totalMinor: 0, count: 0 } : recordedCost(detail);
  const hasRecorded = recorded.totalMinor !== 0;
  const [choice, setChoice] = useState<CostChoice | null | undefined>(undefined);
  const effectiveChoice =
    choice === undefined ? defaultCostChoice(recorded, canRecordCost) : choice;

  const formSchema = useMemo(
    () =>
      z.object({
        summary: z.string().max(500),
        resolveLinkedIssue: z.boolean(),
        lines: z.array(
          z.object({
            entryId: z.string(),
            categoryCode: z.string(),
            amountInput: z.string(),
            note: z.string().max(500),
            artifactIds: z.array(z.string()),
          }),
        ),
      }),
    [],
  );
  const form = useForm<CloseFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      summary: "",
      resolveLinkedIssue: true,
      lines: [newCostLine(askCategory ? "" : REPAIR_CATEGORY_CODE)],
    },
  });
  const lines = useFieldArray({ control: form.control, name: "lines", keyName: "key" });
  // The list arrived without the repair category: the first line has to ask.
  useEffect(() => {
    if (askCategory && form.getValues("lines.0.categoryCode") === REPAIR_CATEGORY_CODE) {
      form.setValue("lines.0.categoryCode", "");
    }
  }, [askCategory, form]);
  const values = form.watch();
  const hasIssue = workOrder.issueId !== null;
  const cost = toCompletionCost(effectiveChoice, values.lines, economicDate);
  const anyUploading = Object.values(uploading).some(Boolean);
  const ready = detail !== undefined && cost !== null && !anyUploading;

  const money = (minor: number) => formatMoney(minor, { currency: "XAF", locale });
  const categoryLabel = (code: string) => {
    const category = categories.find((candidate) => candidate.code === code);
    return category === undefined ? code : localizedLabel(category);
  };

  async function onValid(formValues: CloseFormValues) {
    const completion = toCompletionCost(effectiveChoice, formValues.lines, economicDate);
    if (completion === null) return;
    const summary = formValues.summary.trim();
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<CompleteWorkOrderInput>(
        client,
        "complete-work-order",
        2,
      );
      return intent.current.submit(
        {
          workOrderId: workOrder.id,
          currency: "XAF",
          costOutcome: completion.costOutcome,
          costLines: completion.costLines,
          ...(summary === "" ? {} : { summary }),
          ...(hasIssue ? { resolveLinkedIssue: formValues.resolveLinkedIssue } : {}),
        },
        {
          expectedVersion: workOrder.rowVersion,
          ...(completion.sourceArtifactIds.length === 0
            ? {}
            : { sourceArtifactIds: completion.sourceArtifactIds }),
        },
      );
    });
    if (!result.ok) return;
    // Say who has it next only when something went to review; no approval
    // vocabulary otherwise.
    const sentOn =
      result.outcome.recordStatus === "COMPLETION_SUBMITTED" ||
      (result.outcome.children ?? []).some((child) => child.status === "SUBMITTED");
    await commit(sentOn ? "workOrderClosedSentOn" : "workOrderClosed", result.outcome.warnings);
    finish();
  }

  const choose = (next: CostChoice) => setChoice(next);
  const choiceButton = (value: CostChoice, label: string) => (
    <Button
      key={value}
      type="button"
      variant="outline"
      aria-pressed={effectiveChoice === value}
      className={cn(
        "justify-start whitespace-normal text-left",
        effectiveChoice === value && "border-foreground bg-muted",
      )}
      onClick={() => choose(value)}
    >
      {label}
    </Button>
  );

  const amountSection = (
    <div className="flex flex-col gap-4">
      {lines.fields.map((field, index) => {
        const first = index === 0;
        const line = values.lines[index];
        return (
          <div
            key={field.key}
            className={cn("flex flex-col gap-3", !first && "border-t pt-4")}
            data-testid="cost-line"
          >
            {(!first || askCategory) && (
              <FormField
                control={form.control}
                name={`lines.${index}.categoryCode`}
                render={({ field: categoryField }) => (
                  <FormItem>
                    <FormLabel>{t("maintenance.close.category")}</FormLabel>
                    <Select
                      value={categoryField.value || null}
                      onValueChange={(value) => categoryField.onChange(value ?? "")}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={t("maintenance.fields.choose")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category.code} value={category.code}>
                            {localizedLabel(category)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            )}
            <FormField
              control={form.control}
              name={`lines.${index}.amountInput`}
              render={({ field: amountField }) => (
                <FormItem>
                  <FormLabel>
                    {first
                      ? hasRecorded
                        ? t("maintenance.close.amountToAdd")
                        : t("maintenance.close.amountQuestion")
                      : t("maintenance.close.lineAmount")}
                  </FormLabel>
                  <FormControl>
                    <MoneyInput
                      name={amountField.name}
                      ref={amountField.ref}
                      value={amountField.value}
                      onValueChange={amountField.onChange}
                      onBlur={amountField.onBlur}
                    />
                  </FormControl>
                  {first && (
                    <FormDescription>
                      {[
                        detail?.expectedCostMinor != null && detail.expectedCostMinor > 0
                          ? t("maintenance.close.expectedHint", {
                              amount: money(detail.expectedCostMinor),
                            })
                          : null,
                        askCategory
                          ? null
                          : t("maintenance.close.prefilled", {
                              category: categoryLabel(line?.categoryCode ?? REPAIR_CATEGORY_CODE),
                              date: formatDate(economicDate, locale),
                            }),
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </FormDescription>
                  )}
                </FormItem>
              )}
            />
            {!first && (
              <FormField
                control={form.control}
                name={`lines.${index}.note`}
                render={({ field: noteField }) => (
                  <FormItem>
                    <FormLabel>{t("maintenance.close.lineNote")}</FormLabel>
                    <FormControl>
                      <Input
                        maxLength={500}
                        placeholder={t("maintenance.close.lineNotePlaceholder")}
                        {...noteField}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">{t("maintenance.close.receipt")}</span>
              <FileUpload
                accept="image/*"
                onChange={(ids) =>
                  form.setValue(`lines.${index}.artifactIds`, ids, { shouldDirty: true })
                }
                onUploadingChange={(busy) =>
                  setUploading((current) => ({ ...current, [field.entryId]: busy }))
                }
              />
            </div>
            {!first && (
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() => {
                  setUploading((current) => ({ ...current, [field.entryId]: false }));
                  lines.remove(index);
                }}
              >
                {t("maintenance.close.removeLine")}
              </Button>
            )}
          </div>
        );
      })}
      <Button
        type="button"
        variant="ghost"
        className="self-start"
        onClick={() => lines.append(newCostLine(askCategory ? "" : REPAIR_CATEGORY_CODE))}
      >
        <Plus aria-hidden />
        {t("maintenance.close.addLine")}
      </Button>
    </div>
  );

  return (
    <Form {...form}>
      <CommandForm
        {...chrome}
        title={label("complete-work-order")}
        description={t("maintenance.close.hint")}
        width="line-items"
        error={submission.error}
        command="complete-work-order"
        ready={ready}
        submitting={submission.submitting}
        onSubmit={() => void form.handleSubmit(onValid)()}
      >
        <FormField
          control={form.control}
          name="summary"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("maintenance.fields.summary")}</FormLabel>
              <FormControl>
                <Textarea maxLength={500} {...field} />
              </FormControl>
            </FormItem>
          )}
        />

        {detail === undefined ? (
          <p className="text-sm text-muted-foreground" role="status">
            {detailQuery.isError ? t("maintenance.close.costsFailed") : t("maintenance.close.loading")}
          </p>
        ) : hasRecorded ? (
          <section className="flex flex-col gap-3" aria-label={t("maintenance.close.costSection")}>
            <p className="text-sm">
              {t("maintenance.close.recorded", {
                amount: money(recorded.totalMinor),
                count: recorded.count,
              })}
            </p>
            <div
              role="group"
              aria-label={t("maintenance.close.anythingElse")}
              className="flex flex-col gap-2"
            >
              <span className="text-sm font-medium">{t("maintenance.close.anythingElse")}</span>
              {choiceButton("NOTHING_MORE", t("maintenance.close.nothingMore"))}
              {canRecordCost && choiceButton("AMOUNT", t("maintenance.close.addMore"))}
              {choiceButton("INVOICE_PENDING", t("maintenance.close.invoicePending"))}
            </div>
            {effectiveChoice === "AMOUNT" && amountSection}
          </section>
        ) : (
          <section className="flex flex-col gap-3" aria-label={t("maintenance.close.costSection")}>
            {canRecordCost && effectiveChoice === "AMOUNT" && amountSection}
            {canRecordCost && effectiveChoice !== "AMOUNT" && (
              <div className="flex flex-col gap-1">
                <p className="text-sm">
                  {effectiveChoice === "NO_COST"
                    ? t("maintenance.close.noCostChosen")
                    : t("maintenance.close.invoicePendingChosen")}
                </p>
                <Button
                  type="button"
                  variant="link"
                  className="self-start px-0"
                  onClick={() => choose("AMOUNT")}
                >
                  {t("maintenance.close.enterAmount")}
                </Button>
              </div>
            )}
            <div
              role="group"
              aria-label={t("maintenance.close.alternatives")}
              className="flex flex-col gap-2"
            >
              {!canRecordCost && (
                <span className="text-sm font-medium">{t("maintenance.close.costQuestion")}</span>
              )}
              {choiceButton("NO_COST", t("maintenance.close.noCost"))}
              {choiceButton("INVOICE_PENDING", t("maintenance.close.invoicePending"))}
            </div>
          </section>
        )}

        {hasIssue && (
          <FormField
            control={form.control}
            name="resolveLinkedIssue"
            render={({ field }) => (
              <div className="flex items-start gap-2">
                <Checkbox
                  id="work-order-resolve-issue"
                  checked={field.value}
                  aria-label={t("maintenance.fields.resolveLinkedIssue")}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
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
          />
        )}
      </CommandForm>
    </Form>
  );
}

export function CancelWorkOrderForm({
  workOrder,
  ...host
}: MaintenanceFormHost & { workOrder: WorkOrderRef }) {
  const { t } = useTranslation();
  const label = useCommandLabel();
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
      title={label("cancel-work-order")}
      description={t("maintenance.actions.cancelWorkOrderHint")}
      error={submission.error}
      command="cancel-work-order"
      tone="destructive"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <ReasonField
        id="work-order-cancel-reason"
        label={t("maintenance.fields.reason")}
        value={reason}
        onChange={setReason}
      />
    </CommandForm>
  );
}

interface DecisionSpec {
  command: CommandName;
  text: "note" | "reason";
  successKey: string;
  hint: string;
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
  const label = useCommandLabel();
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
      title={label(spec.command)}
      description={t(spec.hint)}
      error={submission.error}
      command={spec.command}
      // A reason is asked only of the refusals: they are the destructive ones.
      tone={spec.text === "reason" ? "destructive" : "default"}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      {context !== undefined && (
        <p className="text-sm text-muted-foreground">{context}</p>
      )}

      {spec.text === "reason" ? (
        <ReasonField
          id="decision-text"
          label={t("maintenance.fields.reason")}
          value={value}
          onChange={setValue}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <Label htmlFor="decision-text">{t("maintenance.fields.note")}</Label>
          <Textarea
            id="decision-text"
            maxLength={500}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      )}
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
    hint: "maintenance.actions.approveHint",
  },
  reject: {
    command: "reject-work-order",
    text: "reason",
    successKey: "workOrderRejected",
    hint: "maintenance.actions.rejectHint",
  },
  "approve-completion": {
    command: "approve-work-order-closure",
    text: "note",
    successKey: "completionApproved",
    hint: "maintenance.actions.approveCompletionHint",
  },
  "reject-completion": {
    command: "reject-work-order-completion",
    text: "reason",
    successKey: "completionRejected",
    hint: "maintenance.actions.rejectCompletionHint",
  },
};

const ISSUE_DECISIONS: Record<IssueDecision, DecisionSpec> = {
  resolve: {
    command: "resolve-issue",
    text: "note",
    successKey: "issueResolved",
    hint: "maintenance.actions.resolveIssueHint",
  },
  dismiss: {
    command: "dismiss-issue",
    text: "reason",
    successKey: "issueDismissed",
    hint: "maintenance.actions.dismissIssueHint",
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
 * Adds the safety-critical mark to an open problem, or takes it off (#96).
 * Adding it grounds the vehicle, so the form says so; taking it off needs a
 * reason and never releases the vehicle.
 */
export function IssueSeverityForm({
  issue,
  raise,
  ...host
}: MaintenanceFormHost & { issue: IssueRef; raise: boolean }) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const { commit, finish, chrome } = useMaintenanceChrome(host);
  const submission = useCommandSubmission();
  const client = host.client ?? commandClient;
  const [reason, setReason] = useState("");
  const intent = useRef<CommandIntent<ChangeIssueSeverityPayload> | undefined>(undefined);
  const ref = raise
    ? ("change-issue-severity" as const)
    : ({ command: "change-issue-severity", intent: "lower" } as const);

  const trimmed = reason.trim();
  const ready = raise || trimmed !== "";

  async function submit() {
    if (!ready) return;
    const payload: ChangeIssueSeverityPayload = raise
      ? { issueId: issue.id, safetyCritical: true }
      : { issueId: issue.id, safetyCritical: false, reason: trimmed };
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<ChangeIssueSeverityPayload>(
        client,
        "change-issue-severity",
        1,
      );
      return intent.current.submit(payload, { expectedVersion: issue.rowVersion });
    });
    if (!result.ok) return;
    await commit(raise ? "severityRaised" : "severityLowered", result.outcome.warnings);
    finish();
  }

  return (
    <CommandForm
      {...chrome}
      title={label(ref)}
      description={t(raise ? "maintenance.actions.raiseSeverityHint" : "maintenance.actions.lowerSeverityHint")}
      error={submission.error}
      command={ref}
      tone={raise ? "default" : "destructive"}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <p className="text-sm text-muted-foreground">{issue.description}</p>
      {!raise && (
        <ReasonField
          id="issue-severity-reason"
          label={t("maintenance.fields.reason")}
          value={reason}
          onChange={setReason}
        />
      )}
    </CommandForm>
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
  const label = useCommandLabel();
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
      title={label("release-asset-to-service")}
      description={t("maintenance.actions.releaseHint")}
      error={submission.error}
      command="release-asset-to-service"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <p className="text-sm text-muted-foreground">
        {subject.kind === "work-order"
          ? t("maintenance.actions.releaseSubject", {
              reference: recordNumberText(t, "work_order", subject.workOrder.number),
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

// The /maintenance screen opens the forms that record a fact in the side
// panel, as the vehicle does, and keeps the dialog for decisions.

interface DialogHost {
  client?: CommandClient;
  onDismiss: () => void;
}

export function ReportIssueDialog(props: DialogHost) {
  return <ReportIssueForm surface="sheet" {...props} />;
}

export function CreateWorkOrderDialog({
  issues,
  ...props
}: DialogHost & {
  issue?: IssueListItem | undefined;
  issues: readonly IssueListItem[];
}) {
  return <CreateWorkOrderForm surface="sheet" issues={issues} {...props} />;
}

export function CompleteWorkOrderDialog(props: DialogHost & { workOrder: WorkOrderRef }) {
  return <CompleteWorkOrderForm surface="sheet" {...props} />;
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

export function IssueSeverityDialog(
  props: DialogHost & { issue: IssueListItem; raise: boolean },
) {
  return <IssueSeverityForm surface="dialog" {...props} />;
}

export function ReleaseAssetDialog({
  workOrder,
  ...props
}: DialogHost & { workOrder: WorkOrderRef }) {
  return (
    <ReleaseForm surface="dialog" subject={{ kind: "work-order", workOrder }} {...props} />
  );
}
