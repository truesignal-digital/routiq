import { useRef, useState } from "react";
import { DateTimeField } from "@/components/date-field";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { z } from "zod";
import type { CommandResult, recordMeterReadingPayload } from "@routiq/contracts";
import {
  CommandForm,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { ErrorBanner } from "@/components/error-banner.js";
import { MoneyInput } from "@/components/money-input.js";
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
import { localToIso, nowLocal, wholeNumber } from "../../activities/local-time.js";
import type { LastReading } from "../../activities/ReadingForm.js";
import { PinnedAssetField } from "../../assets/PinnedAssetField.js";
import { useActiveSession } from "../../auth/store.js";
import { commandClient, type CommandClient } from "../../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../../commands/intent.js";
import { parseMoneyXaf, toRecordExpensePayload } from "../../finance/model.js";
import { notifyCommandSuccess } from "../../lib/notify.js";

type ExpensePayload = ReturnType<typeof toRecordExpensePayload>;
type ReadingPayload = z.infer<typeof recordMeterReadingPayload>;

const PAYMENT_METHODS = ["CASH", "MOMO", "OM", "BANK", "OTHER"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface LogFuelFormProps {
  surface: CommandSurface;
  assetId: string;
  assetLabel?: string | undefined;
  /** The vehicle's home branch: the fuel is booked where the vehicle belongs. */
  branchCode: string;
  lastReading?: LastReading | undefined;
  /** The tenant's fuel category; the pilot packs name it FUEL. */
  fuelCategoryCode?: string | undefined;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * The driver's fill-up, in one form: a FUEL expense on this vehicle, then —
 * when the odometer was read — a meter reading, as two commands in that order.
 * The expense is what the money needs, so it goes first and stands on its own:
 * if the reading is refused, the form says the reading was not saved and
 * offers to send just the reading again.
 */
export function LogFuelForm({
  surface,
  assetId,
  assetLabel,
  branchCode,
  lastReading,
  fuelCategoryCode = "FUEL",
  client = commandClient,
  back,
  onDone,
  onDismiss,
}: LogFuelFormProps) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const queryClient = useQueryClient();
  const session = useActiveSession();

  // Both ids are minted once per opening, so any retry replays rather than
  // booking a second fill-up or a second reading.
  const [ids] = useState(() => ({
    entryId: crypto.randomUUID(),
    readingId: crypto.randomUUID(),
  }));
  const expenseIntent = useRef<CommandIntent<ExpensePayload> | undefined>(undefined);
  const readingIntent = useRef<CommandIntent<ReadingPayload> | undefined>(undefined);

  const [amountInput, setAmountInput] = useState("");
  const [when, setWhen] = useState(() => nowLocal());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CASH");
  const [station, setStation] = useState("");
  const [odometerRaw, setOdometerRaw] = useState("");
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [expenseError, setExpenseError] = useState<string>();
  /** Set once the expense committed: from then on only the reading is left. */
  const [expense, setExpense] = useState<CommandResult>();
  const [readingError, setReadingError] = useState<string>();

  const amountMinor = parseMoneyXaf(amountInput);
  const odometer = wholeNumber(odometerRaw);
  const odometerUsable = odometerRaw.trim() === "" || odometer !== undefined;
  const ready =
    expense === undefined
      ? amountMinor !== null && amountMinor > 0 && when !== "" && odometerUsable && !uploading
      : odometer !== undefined;

  const invalidate = async (...reads: ReadonlyArray<readonly string[]>) => {
    for (const read of reads) {
      await queryClient.invalidateQueries({
        queryKey: ["ws", session?.workspaceSlug, ...read],
      });
    }
  };

  function finish(
    outcome: CommandResult,
    warnings: readonly string[],
    readingSaved: boolean,
  ) {
    // Above the tenant's threshold the expense waits for an approver; the toast
    // says so instead of claiming it was posted.
    notifyCommandSuccess(
      "activities",
      outcome.recordStatus === "SUBMITTED" ? "expenseSubmitted" : "expenseRecorded",
      warnings,
      readingSaved ? { extraLines: [t("vehicle.forms.fuel.readingSaved")] } : {},
    );
    onDone?.();
    onDismiss();
  }

  async function submitReading(): Promise<
    { ok: true; warnings: readonly string[] } | { ok: false }
  > {
    if (odometer === undefined) return { ok: true, warnings: [] };
    readingIntent.current ??= createCommandIntent<ReadingPayload>(
      client,
      "record-meter-reading",
      1,
    );
    const result = await readingIntent.current.submit({
      readingId: ids.readingId,
      assetId,
      readingType: "ODOMETER",
      value: odometer,
      observedAt: localToIso(when),
      source: "MANUAL",
    });
    if (!result.ok) {
      setReadingError(result.code);
      return { ok: false };
    }
    await invalidate(["asset", assetId]);
    return { ok: true, warnings: result.outcome.warnings };
  }

  /** The expense, once: a retry after a refused reading does not send it again. */
  async function recordExpense(): Promise<CommandResult | undefined> {
    if (amountMinor === null) return undefined;
    expenseIntent.current ??= createCommandIntent<ExpensePayload>(
      client,
      "record-expense",
      1,
    );
    const trimmedStation = station.trim();
    const result = await expenseIntent.current.submit(
      toRecordExpensePayload({
        entryId: ids.entryId,
        branchCode,
        economicDate: when.slice(0, 10),
        categoryCode: fuelCategoryCode,
        amountMinor,
        paymentMethod,
        assetId,
        ...(trimmedStation === "" ? {} : { counterpartyName: trimmedStation }),
      }),
      artifactIds.length > 0 ? { sourceArtifactIds: artifactIds } : {},
    );
    if (!result.ok) {
      setExpenseError(result.code);
      return undefined;
    }
    setExpense(result.outcome);
    await invalidate(["finance"], ["asset", assetId]);
    return result.outcome;
  }

  async function submit() {
    if (!ready || submitting) return;
    setSubmitting(true);
    setExpenseError(undefined);
    setReadingError(undefined);

    const committed = expense ?? (await recordExpense());
    if (committed === undefined) {
      setSubmitting(false);
      return;
    }

    const reading = await submitReading();
    setSubmitting(false);
    if (!reading.ok) return;
    // One toast for the fill-up, including after a retried reading: the
    // expense was never announced on its own.
    finish(committed, [...committed.warnings, ...reading.warnings], odometer !== undefined);
  }

  const expenseLocked = expense !== undefined;

  return (
    <CommandForm
      surface={surface}
      title={label({ command: "record-expense", intent: "fuel" })}
      description={t("vehicle.forms.fuel.description")}
      back={back}
      error={expenseError}
      command={expenseLocked ? "record-meter-reading" : { command: "record-expense", intent: "fuel" }}
      cancelLabel={expenseLocked ? t("commandForm.close") : undefined}
      ready={ready}
      submitting={submitting}
      onSubmit={() => void submit()}
      onDismiss={() => {
        // Closing after a refused reading still leaves a recorded expense
        // behind; the host has to show it.
        if (expenseLocked) onDone?.();
        onDismiss();
      }}
    >
      {expenseLocked && readingError !== undefined && (
        <>
          <p
            role="status"
            className="rounded-lg bg-info/10 px-4 py-3 text-sm text-info-foreground"
          >
            {t("vehicle.forms.fuel.expenseStands")}
          </p>
          <ErrorBanner code={readingError} />
        </>
      )}

      <PinnedAssetField assetId={assetId} label={assetLabel} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="fuel-amount">{t("vehicle.forms.fuel.amount")}</Label>
        <MoneyInput
          id="fuel-amount"
          aria-label={t("vehicle.forms.fuel.amount")}
          value={amountInput}
          disabled={expenseLocked}
          onValueChange={setAmountInput}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fuel-when">{t("vehicle.forms.fuel.when")}</Label>
          <DateTimeField
            id="fuel-when"
            value={when}
            disabled={expenseLocked}
            onChange={setWhen}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("finance.record.paymentMethodLabel")}</Label>
          <Select
            value={paymentMethod}
            disabled={expenseLocked}
            onValueChange={(next) => {
              if (next) setPaymentMethod(next as PaymentMethod);
            }}
          >
            <SelectTrigger
              className="w-full"
              aria-label={t("finance.record.paymentMethodLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((method) => (
                <SelectItem key={method} value={method}>
                  {t(`finance.record.paymentMethods.${method.toLowerCase()}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fuel-station">{t("vehicle.forms.fuel.station")}</Label>
        <Input
          id="fuel-station"
          maxLength={160}
          value={station}
          disabled={expenseLocked}
          onChange={(event) => setStation(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="fuel-odometer">{t("vehicle.forms.fuel.odometer")}</Label>
        <Input
          id="fuel-odometer"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          aria-describedby={lastReading === undefined ? undefined : "fuel-odometer-last"}
          value={odometerRaw}
          onChange={(event) => setOdometerRaw(event.target.value)}
        />
        {lastReading !== undefined && (
          <p id="fuel-odometer-last" className="text-xs text-muted-foreground">
            {t("vehicle.forms.lastReading", {
              readingType: lastReading.readingType,
              value: lastReading.value,
            })}
          </p>
        )}
      </div>

      {!expenseLocked && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">{t("vehicle.forms.fuel.receipt")}</span>
          <FileUpload
            accept="image/*"
            onChange={setArtifactIds}
            onUploadingChange={setUploading}
          />
        </div>
      )}
    </CommandForm>
  );
}
