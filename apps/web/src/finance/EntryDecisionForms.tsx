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
  ReasonField,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { useCommandLabel } from "../commands/labels.js";
import { notifyCommandSuccess } from "../lib/notify.js";
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
  return {
    surface: host.surface,
    back: host.back,
    onReload: async () => {
      await refresh();
      host.onDismiss();
    },
    onDismiss: host.onDismiss,
  };
}

export function ApproveEntryForm(host: EntryDecisionHost) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const refresh = useFinanceRefresh("approvals", "entries");
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
      title={label("approve-entry")}
      error={submission.error}
      command="approve-entry"
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

export function RejectEntryForm(host: EntryDecisionHost) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const refresh = useFinanceRefresh("approvals", "entries");
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
      title={label("reject-entry")}
      error={submission.error}
      command="reject-entry"
      tone="destructive"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <ReasonField
        id="reason"
        label={t("finance.approvals.reasonLabel")}
        placeholder={t("finance.approvals.reasonPlaceholder")}
        value={reason}
        onChange={setReason}
      />
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
  const label = useCommandLabel();
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
      title={label("reverse-entry")}
      error={submission.error}
      command="reverse-entry"
      tone="destructive"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <ReasonField
        id="reason"
        label={t("finance.entries.reversal.reasonLabel")}
        placeholder={t("finance.entries.reversal.reasonPlaceholder")}
        value={reason}
        onChange={setReason}
      />
    </CommandForm>
  );
}
