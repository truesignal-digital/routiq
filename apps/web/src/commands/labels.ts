import type { QueueableCommandName } from "@routiq/contracts";
import { useTranslation } from "react-i18next";

/** Every registered workspace command; each has its words under `commands.<name>`. */
export type CommandName = QueueableCommandName;

/**
 * A few commands do two jobs the operator names differently: `assign-asset`
 * moves a vehicle to another branch or names its custodian. Each job keeps its
 * words in the same `commands.<name>` block, under the intent's key, so the
 * command still has one place for its labels.
 */
export const COMMAND_INTENTS = {
  "record-expense": ["fuel"],
  "assign-asset": ["custodian"],
  "add-or-renew-document": ["renew"],
  "set-branch-status": ["deactivate", "reactivate"],
  "record-journey-sheet": ["close"],
} as const satisfies Partial<Record<CommandName, readonly string[]>>;

type Intents = typeof COMMAND_INTENTS;

export type CommandIntentRef = {
  [C in keyof Intents]: { command: C; intent: Intents[C][number] };
}[keyof Intents];

/** A command, or one of its named jobs. */
export type CommandLabelRef = CommandName | CommandIntentRef;

/**
 * `label` names the command on every menu, header and button that opens it;
 * `short` is the quick bar's word; `submit` and `submitting` are its form's
 * button; `dismiss` is what the form's other button says when "Annuler" would
 * read as the command itself.
 */
export type CommandLabelPart = "label" | "short" | "submit" | "submitting" | "dismiss";

/** Catalog keys to try in order: the intent's own words, then the command's. */
export function commandLabelKeys(ref: CommandLabelRef, part: CommandLabelPart): string[] {
  const block = `commands.${typeof ref === "string" ? ref : ref.command}`;
  const own = typeof ref === "string" ? block : `${block}.${ref.intent}`;
  const keys = [`${own}.${part}`];
  if (part === "short") keys.push(`${own}.label`);
  if (own !== block && part !== "label" && part !== "short") keys.push(`${block}.${part}`);
  if (part === "dismiss") keys.push("commandForm.cancel");
  return keys;
}

export function useCommandLabel() {
  const { t } = useTranslation();
  return (ref: CommandLabelRef, part: CommandLabelPart = "label"): string =>
    t(commandLabelKeys(ref, part));
}
