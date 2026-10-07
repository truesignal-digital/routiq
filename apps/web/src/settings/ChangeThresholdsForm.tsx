import { zodResolver } from "@hookform/resolvers/zod";
import {
  thresholdBandsProblem,
  type ApprovalChainStep,
  type ApprovalThresholdsResponse,
  type UpdateApprovalThresholdV2Payload,
} from "@routiq/contracts";
import { useMemo, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { CommandForm, type FormIssue } from "@/components/command-form.js";
import { MoneyInput } from "@/components/money-input.js";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { stepText } from "../approval-rules/chain-text.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { useCommandLabel } from "../commands/labels.js";
import { moneyAmountParts, parseWholeAmount } from "../lib/format.js";
import { notifyCommandSuccess } from "../lib/notify.js";

interface BandValues {
  recording: string;
  ceiling: string;
}

/** The company chain the two bands make, in the words the members' notice uses. */
export function companyChain(bands: UpdateApprovalThresholdV2Payload): ApprovalChainStep[] {
  return [
    { upToMinor: bands.recordingThresholdMinor, outcome: "POSTS_DIRECTLY" },
    { upToMinor: bands.financeCeilingMinor, outcome: "FINANCE_APPROVES" },
    { upToMinor: null, outcome: "DIRECTION_APPROVES" },
  ];
}

function parsedBands(values: BandValues): UpdateApprovalThresholdV2Payload | undefined {
  const recording = parseWholeAmount(values.recording);
  const ceiling = parseWholeAmount(values.ceiling);
  if (recording.kind !== "amount" || ceiling.kind !== "amount") return undefined;
  return { recordingThresholdMinor: recording.minor, financeCeilingMinor: ceiling.minor };
}

/**
 * Direction moves both bands of the money chain in one command (#354). The
 * form shows the chain the new amounts make and who will be told before it
 * sends anything, and sends nothing while both amounts are unchanged.
 */
export function ChangeThresholdsForm({
  current,
  recordingThresholdMinor,
  financeCeilingMinor,
  onDone,
  onReload,
  client = commandClient,
}: {
  current: ApprovalThresholdsResponse;
  recordingThresholdMinor: number;
  financeCeilingMinor: number;
  onDone: (saved: boolean) => void;
  onReload: () => Promise<void>;
  client?: CommandClient;
}) {
  const { t, i18n } = useTranslation();
  const label = useCommandLabel();
  const intent = useRef<CommandIntent<UpdateApprovalThresholdV2Payload> | undefined>(undefined);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const schema = useMemo(() => {
    const amount = z.string().superRefine((value, ctx) => {
      const parsed = parseWholeAmount(value);
      if (parsed.kind === "empty") ctx.addIssue({ code: "custom", message: t("form.errors.required") });
      if (parsed.kind === "invalid") ctx.addIssue({ code: "custom", message: t("settings.approvals.form.whole") });
    });
    return z
      .object({ recording: amount, ceiling: amount })
      .superRefine((values, ctx) => {
        const bands = parsedBands(values);
        if (bands === undefined) return;
        if (bands.financeCeilingMinor < 1) {
          ctx.addIssue({ code: "custom", path: ["ceiling"], message: t("form.errors.min", { min: 1 }) });
          return;
        }
        if (thresholdBandsProblem(bands) !== undefined) {
          ctx.addIssue({ code: "custom", path: ["recording"], message: t("settings.approvals.form.belowCeiling") });
        }
      });
  }, [t]);

  const form = useForm<BandValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      recording: moneyAmountParts(recordingThresholdMinor).amount,
      ceiling: moneyAmountParts(financeCeilingMinor).amount,
    },
  });
  const { errors, isSubmitted } = form.formState;
  const issues: FormIssue[] = isSubmitted
    ? (["recording", "ceiling"] as const).flatMap((name) => {
        const message = errors[name]?.message;
        return message === undefined ? [] : [{ name, message, focus: () => form.setFocus(name) }];
      })
    : [];
  const values = useWatch({ control: form.control }) as BandValues;
  const bands = parsedBands(values);
  const unchanged =
    bands !== undefined &&
    bands.recordingThresholdMinor === recordingThresholdMinor &&
    bands.financeCeilingMinor === financeCeilingMinor;

  const roles = new Intl.ListFormat(i18n.resolvedLanguage, { type: "conjunction" }).format(
    current.affectedRoles.map((role) => t(`users.roles.${role}`)),
  );
  const preview = bands !== undefined && thresholdBandsProblem(bands) === undefined ? companyChain(bands) : undefined;

  async function send(valid: BandValues) {
    const payload = parsedBands(valid);
    if (payload === undefined) return;
    setError(undefined);
    setSubmitting(true);
    intent.current ??= createCommandIntent<UpdateApprovalThresholdV2Payload>(
      client,
      "update-approval-threshold",
      2,
    );
    const result = await intent.current.submit(payload, { expectedVersion: current.version });
    setSubmitting(false);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    notifyCommandSuccess("settings", "thresholdsSaved", result.outcome.warnings);
    onDone(true);
  }

  return (
    <Form {...form}>
      <CommandForm
        surface="sheet"
        title={label("update-approval-threshold")}
        description={t("settings.approvals.form.description")}
        command="update-approval-threshold"
        error={error}
        issues={issues}
        conflict={{
          title: t("settings.approvals.form.conflictTitle"),
          body: t("settings.approvals.form.conflictBody"),
        }}
        onReload={onReload}
        ready={!unchanged}
        submitting={submitting}
        onSubmit={() => void form.handleSubmit(send)()}
        onDismiss={() => onDone(false)}
      >
        <FormField
          control={form.control}
          name="recording"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("settings.approvals.form.recording")}</FormLabel>
              <FormControl>
                <MoneyInput
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormDescription>{t("settings.approvals.form.recordingHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="ceiling"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("settings.approvals.form.ceiling")}</FormLabel>
              <FormControl>
                <MoneyInput
                  name={field.name}
                  ref={field.ref}
                  value={field.value}
                  onValueChange={field.onChange}
                  onBlur={field.onBlur}
                />
              </FormControl>
              <FormDescription>{t("settings.approvals.form.ceilingHint")}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex flex-col gap-2 rounded-lg bg-muted/50 px-3 py-3 text-sm">
          {unchanged ? (
            <p className="text-muted-foreground">{t("settings.approvals.form.unchanged")}</p>
          ) : (
            preview !== undefined && (
              <>
                <p className="font-medium">{t("settings.approvals.form.afterSaving")}</p>
                <ul className="flex flex-col gap-0.5 tabular-nums">
                  {preview.map((step, index) => (
                    <li key={step.outcome}>{stepText(t, preview, index, current.currency)}</li>
                  ))}
                </ul>
              </>
            )
          )}
          <p className="text-muted-foreground">{t("settings.approvals.form.whoIsTold", { roles })}</p>
        </div>
      </CommandForm>
    </Form>
  );
}
