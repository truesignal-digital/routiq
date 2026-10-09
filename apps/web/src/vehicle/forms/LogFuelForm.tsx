import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  recordExpensePayload,
  recordMeterReadingPayload,
  type CommandResult,
} from "@routiq/contracts";
import { useCommandLabel } from "@/commands/labels.js";
import type { CommandFormBack } from "@/components/command-form.js";
import { DateTimeField } from "@/components/form/date-fields.js";
import { ChoiceField, FileField, MoneyField, ReadingField, TextField } from "@/components/form/fields.js";
import { FormGroup, FormLayout, FormOptional } from "@/components/form/form-layout.js";
import { useCommandForm, type CommandFormSent } from "@/components/use-command-form.js";
import { localToIso, nowLocal } from "../../activities/local-time.js";
import type { LastReading } from "../../activities/ReadingForm.js";
import { PinnedAssetField } from "../../assets/PinnedAssetField.js";
import { useActiveSession } from "../../auth/store.js";
import { commandClient, type CommandClient } from "../../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../../commands/intent.js";
import { toRecordExpensePayload } from "../../finance/model.js";

type ExpensePayload = ReturnType<typeof toRecordExpensePayload>;
type ReadingPayload = z.infer<typeof recordMeterReadingPayload>;

/** One fill-up as the driver types it, checked by the two contracts it becomes. */
const logFuelValues = z.object({
  amountMinor: recordExpensePayload.shape.amountMinor,
  paymentMethod: recordExpensePayload.shape.paymentMethod,
  at: z.iso.datetime({ local: true }),
  odometer: recordMeterReadingPayload.shape.value.optional(),
  station: recordExpensePayload.shape.counterpartyName,
  /** Stored receipt photos; they travel on the expense's envelope. */
  receipt: z.array(z.uuid()),
});
type LogFuelValues = z.infer<typeof logFuelValues>;

const PAYMENT_METHODS = recordExpensePayload.shape.paymentMethod.options;

export interface LogFuelFormProps {
  surface: "sheet" | "panel";
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
 * The driver's fill-up, in one Quick entry form: a FUEL expense on this
 * vehicle, then — when the odometer was read — a meter reading, as two
 * commands in that order. The expense is what the money needs, so it goes
 * first and stands on its own: if the reading is refused, the form says the
 * reading was not saved and offers to send just the reading again.
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
  const [ids] = useState(() => ({ entryId: crypto.randomUUID(), readingId: crypto.randomUUID() }));
  const expenseIntent = useRef<CommandIntent<ExpensePayload> | undefined>(undefined);
  const readingIntent = useRef<CommandIntent<ReadingPayload> | undefined>(undefined);
  /** Set once the expense committed: from then on only the reading is left. */
  const committed = useRef<CommandResult | undefined>(undefined);
  const [expenseLocked, setExpenseLocked] = useState(false);
  const announced = useRef(false);

  const invalidate = async (...reads: ReadonlyArray<readonly string[]>) => {
    for (const read of reads) {
      await queryClient.invalidateQueries({ queryKey: ["ws", session?.workspaceSlug, ...read] });
    }
  };

  async function send(values: LogFuelValues): Promise<CommandFormSent> {
    let expense = committed.current;
    if (expense === undefined) {
      expenseIntent.current ??= createCommandIntent<ExpensePayload>(client, "record-expense", 1);
      const station = values.station?.trim();
      const result = await expenseIntent.current.submit(
        toRecordExpensePayload({
          entryId: ids.entryId,
          branchCode,
          economicDate: values.at.slice(0, 10),
          categoryCode: fuelCategoryCode,
          amountMinor: values.amountMinor,
          paymentMethod: values.paymentMethod,
          assetId,
          ...(station === undefined || station === "" ? {} : { counterpartyName: station }),
        }),
        values.receipt.length > 0 ? { sourceArtifactIds: values.receipt } : {},
      );
      if (!result.ok) return result;
      expense = result.outcome;
      committed.current = expense;
      setExpenseLocked(true);
      await invalidate(["finance"], ["asset", assetId]);
    }

    if (values.odometer === undefined) return { ok: true, outcome: expense };
    readingIntent.current ??= createCommandIntent<ReadingPayload>(client, "record-meter-reading", 1);
    const reading = await readingIntent.current.submit({
      readingId: ids.readingId,
      assetId,
      readingType: "ODOMETER",
      value: values.odometer,
      observedAt: localToIso(values.at),
      source: "MANUAL",
    });
    if (!reading.ok) return reading;
    await invalidate(["asset", assetId]);
    // One toast for the fill-up, including after a retried reading: the
    // expense was never announced on its own.
    return {
      ok: true,
      outcome: { ...expense, warnings: [...expense.warnings, ...reading.outcome.warnings] },
      extraLines: [t("vehicle.forms.fuel.readingSaved")],
    };
  }

  const fuel = useCommandForm(logFuelValues, "record-expense", 1, {
    defaults: () => ({ paymentMethod: "CASH" as const, at: nowLocal(), receipt: [] }),
    // Above the tenant's threshold the expense waits for an approver; the
    // toast says so instead of claiming it was posted.
    success: (outcome) => ({
      namespace: "activities",
      message: outcome.recordStatus === "SUBMITTED" ? "expenseSubmitted" : "expenseRecorded",
    }),
    send,
    onDone: () => {
      announced.current = true;
      onDone?.();
    },
    onDismiss: () => {
      // Closing after a refused reading still leaves a recorded expense
      // behind; the host has to show it.
      if (committed.current !== undefined && !announced.current) onDone?.();
      onDismiss();
    },
    client,
  });
  const odometer = fuel.form.watch("odometer");
  const odometerLast = lastReading?.readingType === "ODOMETER" ? lastReading.value : undefined;

  return (
    <FormLayout
      kind="quick-entry"
      form={fuel}
      surface={surface}
      title={label({ command: "record-expense", intent: "fuel" })}
      description={t("vehicle.forms.fuel.description")}
      hint={t("vehicle.forms.logFuel.hint")}
      pinned={<PinnedAssetField assetId={assetId} label={assetLabel} />}
      back={back}
      command={expenseLocked ? "record-meter-reading" : { command: "record-expense", intent: "fuel" }}
      cancelLabel={expenseLocked ? t("commandForm.close") : undefined}
      ready={!expenseLocked || (typeof odometer === "number" && Number.isFinite(odometer))}
    >
      {expenseLocked && fuel.formProps.error !== undefined && (
        <p role="status" className="rounded-lg bg-info/10 px-4 py-3 text-sm text-info-foreground">
          {t("vehicle.forms.fuel.expenseStands")}
        </p>
      )}
      <FormGroup title={t("form.group.howMuch")}>
        <MoneyField name="amountMinor" label={t("vehicle.forms.logFuel.amount")} main disabled={expenseLocked} />
        <ChoiceField
          name="paymentMethod"
          label={t("vehicle.forms.logFuel.paymentMethod")}
          disabled={expenseLocked}
          options={PAYMENT_METHODS.map((method) => ({
            value: method,
            label: t(`finance.record.paymentMethods.${method.toLowerCase()}`),
          }))}
        />
        <DateTimeField name="at" label={t("vehicle.forms.logFuel.when")} disabled={expenseLocked} />
      </FormGroup>
      <FormGroup title={t("form.group.odometer")}>
        <ReadingField
          name="odometer"
          label={t("vehicle.forms.logFuel.odometer")}
          readingType="ODOMETER"
          last={odometerLast}
        />
      </FormGroup>
      {!expenseLocked && (
        <FormOptional>
          <TextField name="station" label={t("vehicle.forms.logFuel.station")} maxLength={160} />
          <FileField name="receipt" label={t("vehicle.forms.logFuel.receipt")} camera />
        </FormOptional>
      )}
    </FormLayout>
  );
}
