import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useForm,
  type DefaultValues,
  type FieldErrors,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { z } from "zod";
import type { CommandResult } from "@routiq/contracts";
import { commandClient, type CommandClient } from "@/commands/instance.js";
import { createCommandIntent } from "@/commands/intent.js";
import type { CommandName } from "@/commands/labels.js";
import { notifyCommandSuccess, type NotifyNamespace } from "@/lib/notify.js";
import type { FormIssue } from "@/components/command-form.js";

/** The success toast: `<namespace>.notify.success.<message>`. */
export interface CommandFormSuccess {
  namespace: NotifyNamespace;
  message: string;
}

/**
 * What a form that sends more than its one command reports back: the outcome
 * the toast describes, or the first refusal's code for the banner.
 */
export type CommandFormSent =
  | { ok: true; outcome: CommandResult; extraLines?: readonly string[] | undefined }
  | { ok: false; code: string };

export interface UseCommandFormOptions<Values extends FieldValues, Payload> {
  /** Called once per opening: mint record ids here, so a retry replays them. */
  defaults: () => DefaultValues<Values>;
  success: CommandFormSuccess | ((outcome: CommandResult) => CommandFormSuccess);
  /**
   * Replaces the one command intent, for a form whose values become more than
   * one command (Log fuel: an expense, then a reading). It keeps its own
   * intents, so a retry replays them too.
   */
  send?: ((payload: Payload) => Promise<CommandFormSent>) | undefined;
  /** After the command committed, before the surface closes. */
  onDone?: ((outcome: CommandResult) => void) | undefined;
  onDismiss: () => void;
  client?: CommandClient | undefined;
}

export interface CommandFormState<Values extends FieldValues, Payload> {
  form: UseFormReturn<Values, unknown, Payload>;
  /** The schema the form validates with: the field kit reads "required" from it. */
  schema: z.ZodType<Payload, Values>;
  /** Spread onto `<CommandForm>`. */
  formProps: {
    command: CommandName;
    error: string | undefined;
    issues: readonly FormIssue[];
    ready: true;
    submitting: boolean;
    onSubmit: () => void;
    onDismiss: () => void;
  };
}

/**
 * One command form: react-hook-form validated by the contract's own payload
 * schema, one command intent per opening (so a retry of the same values replays
 * the same envelope, and reopening the form mints a new one), the server's
 * refusal code for the banner, and the success toast. A host that keeps the
 * form mounted while closed must remount it to open it again.
 */
export function useCommandForm<Values extends FieldValues, Payload>(
  schema: z.ZodType<Payload, Values>,
  command: CommandName,
  version: number,
  options: UseCommandFormOptions<Values, Payload>,
): CommandFormState<Values, Payload> {
  const { t } = useTranslation();
  const { client = commandClient, onDismiss } = options;
  const [intent] = useState(() => createCommandIntent<Payload>(client, command, version));
  const [defaultValues] = useState(options.defaults);
  const [error, setError] = useState<string>();
  const form = useForm<Values, unknown, Payload>({
    resolver: zodResolver(schema, { error: (issue) => issueMessage(t, issue) }),
    defaultValues,
    // The error summary takes focus instead; it names every field to fix.
    shouldFocusError: false,
  });
  const { errors, isSubmitted, isSubmitting } = form.formState;

  const send = form.handleSubmit(async (payload) => {
    setError(undefined);
    const result: CommandFormSent =
      options.send === undefined ? await intent.submit(payload) : await options.send(payload);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    const { outcome } = result;
    const success = typeof options.success === "function" ? options.success(outcome) : options.success;
    const extraLines = "extraLines" in result ? result.extraLines : undefined;
    notifyCommandSuccess(
      success.namespace,
      success.message,
      outcome.warnings,
      extraLines === undefined || extraLines.length === 0 ? {} : { extraLines: [...extraLines] },
    );
    options.onDone?.(outcome);
    onDismiss();
  });

  const issues = isSubmitted
    ? fieldIssues(errors).map(({ name, message }) => ({
        name,
        message,
        focus: () => form.setFocus(name as Path<Values>),
      }))
    : [];

  return {
    form,
    schema,
    formProps: {
      command,
      error,
      issues,
      ready: true,
      submitting: isSubmitting,
      onSubmit: () => void send(),
      onDismiss,
    },
  };
}

type Issue = Parameters<NonNullable<NonNullable<Parameters<typeof zodResolver>[1]>["error"]>>[0];

/** The contract's rule, said in the reader's language: never its English default. */
function issueMessage(t: TFunction, issue: Issue): string {
  const { input } = issue as { input?: unknown };
  if (input === undefined || input === null || input === "") return t("form.errors.required");
  const bound = issue as { origin?: string; minimum?: unknown; maximum?: unknown; inclusive?: boolean };
  const text = bound.origin === "string";
  switch (issue.code) {
    case "too_small":
      if (text && Number(bound.minimum) <= 1) return t("form.errors.required");
      if (!text && bound.inclusive === false) return t("form.errors.above", { min: Number(bound.minimum) });
      return t(text ? "form.errors.tooShort" : "form.errors.min", { min: Number(bound.minimum) });
    case "too_big":
      return t(text ? "form.errors.tooLong" : "form.errors.max", { max: Number(bound.maximum) });
    default:
      return t("form.errors.invalid");
  }
}

function fieldIssues(errors: FieldErrors, prefix = ""): { name: string; message: string }[] {
  return Object.entries(errors).flatMap(([key, value]) => {
    if (typeof value !== "object" || value === null) return [];
    const name = `${prefix}${key}`;
    const { message } = value as { message?: unknown };
    if (typeof message === "string") return [{ name, message }];
    return fieldIssues(value as FieldErrors, `${name}.`);
  });
}
