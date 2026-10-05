import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import type {
  approveEntryPayload,
  rejectEntryPayload,
  reverseEntryPayload,
} from "@routiq/contracts";
import {
  CommandForm,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { notifyCommandError, notifyCommandSuccess } from "../lib/notify.js";
import { validateRejectionReason, validateReversalReason } from "./model.js";

type ApprovePayload = z.infer<typeof approveEntryPayload>;
type RejectPayload = z.infer<typeof rejectEntryPayload>;
type ReversePayload = z.infer<typeof reverseEntryPayload>;

/** The entry a decision is about, at the version the decider was shown. */
export interface EntryRef {
  id: string;
  rowVersion: number;
}

export interface EntryDecisionHost {
  surface: CommandSurface;
  entry: EntryRef;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  /** After the decision committed and the finance reads were refreshed. */
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * ADR-0001: a decided entry leaves the queue because the server says so, not
 * because the client crossed it off locally — so a decision refreshes the
 * reads it changed and nothing else.
 */
function useFinanceRefresh(...reads: ReadonlyArray<"approvals" | "entries" | "entry">) {
  const queryClient = useQueryClient();
  const session = useActiveSession();
  return async () => {
    for (const read of reads) {
      await queryClient.invalidateQueries({
        queryKey: ["ws", session?.workspaceSlug, "finance", read],
      });
    }
  };
}

function useDecisionChrome(host: EntryDecisionHost, refresh: () => Promise<void>) {
  const { t } = useTranslation();
  return {
    surface: host.surface,
    back: host.back,
    submittingLabel: t("finance.approvals.submitting"),
    cancelLabel: t("finance.approvals.cancel"),
    onReload: async () => {
      await refresh();
      host.onDismiss();
    },
    onDismiss: host.onDismiss,
  };
}

export function ApproveEntryForm(host: EntryDecisionHost) {
  const { t } = useTranslation();
  const refresh = useFinanceRefresh("approvals", "entries", "entry");
  const chrome = useDecisionChrome(host, refresh);
  const submission = useCommandSubmission();
  const [note, setNote] = useState("");
  const intent = useRef<CommandIntent<ApprovePayload> | undefined>(undefined);

  async function submit() {
    const trimmed = note.trim();
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<ApprovePayload>(
        host.client ?? commandClient,
        "approve-entry",
        1,
      );
      return intent.current.submit(
        { entryId: host.entry.id, ...(trimmed === "" ? {} : { note: trimmed }) },
        { expectedVersion: host.entry.rowVersion },
      );
    });
    if (!result.ok) return;
    notifyCommandSuccess("finance", "approved", result.outcome.warnings);
    await refresh();
    host.onDone?.();
    host.onDismiss();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("finance.approvals.approveTitle")}
      error={submission.error}
      submitLabel={t("finance.approvals.approve")}
      ready
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="note">
          {t("finance.approvals.noteLabel")} {t("finance.approvals.optional")}
        </Label>
        <Textarea
          id="note"
          placeholder={t("finance.approvals.notePlaceholder")}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </CommandForm>
  );
}

/**
 * Approve is one tap: no dialog, the outcome is a toast. One intent per entry,
 * so tapping again after a dropped connection replays the same envelope.
 */
export function useApproveEntry(client?: CommandClient) {
  const refresh = useFinanceRefresh("approvals", "entries", "entry");
  const [submitting, setSubmitting] = useState(false);
  const intents = useRef(new Map<string, CommandIntent<ApprovePayload>>());

  async function approve(entry: EntryRef): Promise<boolean> {
    let intent = intents.current.get(entry.id);
    if (intent === undefined) {
      intent = createCommandIntent<ApprovePayload>(client ?? commandClient, "approve-entry", 1);
      intents.current.set(entry.id, intent);
    }
    setSubmitting(true);
    const result = await intent.submit(
      { entryId: entry.id },
      { expectedVersion: entry.rowVersion },
    );
    setSubmitting(false);
    if (!result.ok) {
      notifyCommandError("finance", result.code);
      return false;
    }
    notifyCommandSuccess("finance", "approved", result.outcome.warnings);
    await refresh();
    return true;
  }

  return { approve, submitting };
}

/**
 * The decision pair for a record surface's footer: Reject hands off to the
 * reason dialog, Approve commits on the spot and comes last.
 */
export function EntryDecisionButtons({
  entry,
  client,
  onApproved,
  onReject,
}: {
  entry: EntryRef;
  client?: CommandClient | undefined;
  onApproved?: (() => void) | undefined;
  onReject: () => void;
}) {
  const { t } = useTranslation();
  const { approve, submitting } = useApproveEntry(client);

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        type="button"
        variant="destructive"
        className="min-h-11"
        disabled={submitting}
        onClick={onReject}
      >
        {t("finance.approvals.reject")}
      </Button>
      <Button
        type="button"
        className="min-h-11"
        disabled={submitting}
        onClick={() =>
          void approve(entry).then((approved) => {
            if (approved) onApproved?.();
          })
        }
      >
        {submitting ? t("finance.approvals.submitting") : t("finance.approvals.approve")}
      </Button>
    </div>
  );
}

export function RejectEntryForm(host: EntryDecisionHost) {
  const { t } = useTranslation();
  const refresh = useFinanceRefresh("approvals", "entries", "entry");
  const chrome = useDecisionChrome(host, refresh);
  const submission = useCommandSubmission();
  const [reason, setReason] = useState("");
  const intent = useRef<CommandIntent<RejectPayload> | undefined>(undefined);

  // A refusal must say why: the trail is the only place the motive survives.
  const ready = validateRejectionReason(reason);

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<RejectPayload>(
        host.client ?? commandClient,
        "reject-entry",
        1,
      );
      return intent.current.submit(
        { entryId: host.entry.id, reason },
        { expectedVersion: host.entry.rowVersion },
      );
    });
    if (!result.ok) return;
    notifyCommandSuccess("finance", "rejected", result.outcome.warnings);
    await refresh();
    host.onDone?.();
    host.onDismiss();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("finance.approvals.rejectTitle")}
      error={submission.error}
      submitLabel={t("finance.approvals.reject")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">{t("finance.approvals.reasonLabel")}</Label>
        <Textarea
          id="reason"
          placeholder={t("finance.approvals.reasonPlaceholder")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </CommandForm>
  );
}

/**
 * A posted entry is never edited: reversing it adds a second entry whose
 * postings cancel the first. The new entry's id is minted once per opening, so
 * a retry replays the same reversal instead of booking another.
 */
export function ReverseEntryForm({
  onReversed,
  ...host
}: EntryDecisionHost & {
  /** The reversal entry just created, for a host that wants to show it. */
  onReversed?: ((reversalEntryId: string) => void) | undefined;
}) {
  const { t } = useTranslation();
  const refresh = useFinanceRefresh("entry", "entries");
  const chrome = useDecisionChrome(host, refresh);
  const submission = useCommandSubmission();
  const [reversalEntryId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const intent = useRef<CommandIntent<ReversePayload> | undefined>(undefined);

  const ready = validateReversalReason(reason);

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<ReversePayload>(
        host.client ?? commandClient,
        "reverse-entry",
        1,
      );
      return intent.current.submit(
        { reversalEntryId, originalEntryId: host.entry.id, reason },
        { expectedVersion: host.entry.rowVersion },
      );
    });
    if (!result.ok) return;
    notifyCommandSuccess("finance", "reversed", result.outcome.warnings);
    // A reversal rewrites this entry and adds one to the list; nothing else moves.
    await refresh();
    host.onDone?.();
    onReversed?.(reversalEntryId);
    host.onDismiss();
  }

  return (
    <CommandForm
      {...chrome}
      title={t("finance.entries.reversal.title")}
      error={submission.error}
      submitLabel={t("finance.entries.reversal.submit")}
      submittingLabel={t("finance.entries.reversal.submitting")}
      cancelLabel={t("finance.entries.reversal.cancel")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="reason">{t("finance.entries.reversal.reasonLabel")}</Label>
        <Textarea
          id="reason"
          placeholder={t("finance.entries.reversal.reasonPlaceholder")}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </div>
    </CommandForm>
  );
}
