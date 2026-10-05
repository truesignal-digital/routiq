import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  BranchListItem,
  RenameBranchPayload,
  SetBranchStatusPayload,
} from "@routiq/contracts";
import { Button } from "@/components/ui/button";
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
import { ErrorBanner } from "@/components/error-banner.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { useInvalidateBranches } from "./useBranches.js";
import { BRANCH_NAME_MAX_LENGTH, branchNameProblem } from "./validation.js";

export type BranchActionKey = "rename" | "deactivate" | "reactivate";

/**
 * Which actions a branch's row offers. An inactive branch has exactly one way
 * back and nothing else: renaming a branch nobody may write to is an edit about
 * a decision nobody made.
 */
export function branchActions(branch: BranchListItem): BranchActionKey[] {
  return branch.active ? ["rename", "deactivate"] : ["reactivate"];
}

type Outcome = { kind: "form" } | { kind: "conflict" } | { kind: "error"; code: string };

/**
 * One branch command, asked for and answered in place. The guard refusals —
 * LAST_BRANCH above all — are answers about this branch that the admin has to
 * read, so they appear in the open dialog rather than as a toast that outlives
 * it.
 *
 * The code never appears as an input: it is embedded in every record number the
 * branch has printed, so rename changes the name and nothing else.
 */
export function BranchActionDialog({
  branch,
  action,
  client = commandClient,
  onDismiss,
}: {
  branch: BranchListItem;
  action: BranchActionKey;
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const invalidateBranches = useInvalidateBranches();

  const [outcome, setOutcome] = useState<Outcome>({ kind: "form" });
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState(branch.name);
  const [duplicateName, setDuplicateName] = useState(false);

  // One intent per dialog, minted on first submit: a retry of the same edit
  // replays the same envelope instead of writing a second audit event.
  const renameIntent = useRef<CommandIntent<RenameBranchPayload> | undefined>(undefined);
  const statusIntent = useRef<CommandIntent<SetBranchStatusPayload> | undefined>(
    undefined,
  );

  /*
   * The same rule the command schema applies, asked of the schema itself: a name
   * the dialog accepts is a name `rename-branch` accepts. Without this a
   * 121-character paste reached the server and came back as an unattributed
   * VALIDATION_FAILED banner with no indication that length was the problem.
   */
  const trimmedName = name.trim();
  const nameProblem = branchNameProblem(name);
  const nameError =
    nameProblem === "tooLong"
      ? t("branches.form.nameTooLong", { max: BRANCH_NAME_MAX_LENGTH })
      : duplicateName
        ? t("errors.DUPLICATE_BRANCH_NAME")
        : undefined;
  const nameChanged = nameProblem === undefined && trimmedName !== branch.name;
  const ready = !submitting && (action === "rename" ? nameChanged : true);

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setOutcome({ kind: "form" });
    setDuplicateName(false);

    let result;
    if (action === "rename") {
      renameIntent.current ??= createCommandIntent<RenameBranchPayload>(
        client,
        "rename-branch",
        1,
      );
      // The version the row was rendered at rides along, so a stale screen
      // cannot overwrite a name someone else just fixed.
      result = await renameIntent.current.submit(
        { branchId: branch.id, name: trimmedName },
        { expectedVersion: branch.rowVersion },
      );
    } else {
      statusIntent.current ??= createCommandIntent<SetBranchStatusPayload>(
        client,
        "set-branch-status",
        1,
      );
      // No expectedVersion: the target state is absolute ("close this branch"),
      // and the server refuses a flip that would change nothing, so a stale
      // screen is already caught without losing to a concurrent rename.
      result = await statusIntent.current.submit({
        branchId: branch.id,
        active: action === "reactivate",
      });
    }

    setSubmitting(false);

    if (!result.ok) {
      if (result.code === "VERSION_CONFLICT") setOutcome({ kind: "conflict" });
      // A name already in use is about one field, so it is answered on that
      // field rather than as a banner the admin has to translate into an edit.
      else if (result.code === "DUPLICATE_BRANCH_NAME") setDuplicateName(true);
      else setOutcome({ kind: "error", code: result.code });
      return;
    }

    await invalidateBranches();
    onDismiss();
  }

  async function reload() {
    await invalidateBranches();
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`branches.actions.${action}`)}</DialogTitle>
          <DialogDescription>
            {t(`branches.actions.${action}Hint`, { name: branch.name })}
          </DialogDescription>
        </DialogHeader>

        {outcome.kind === "conflict" ? (
          <>
            <div
              role="alert"
              className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
            >
              <p className="font-semibold">{t("branches.actions.conflictTitle")}</p>
              <p className="mt-1">{t("branches.actions.conflictBody")}</p>
            </div>
            <DialogFooter>
              <Button onClick={() => void reload()}>
                {t("branches.actions.reload")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {outcome.kind === "error" && <ErrorBanner code={outcome.code} />}

            {action === "rename" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="branch-code">{t("branches.form.code")}</Label>
                  <Input
                    id="branch-code"
                    type="text"
                    readOnly
                    disabled
                    className="font-mono"
                    value={branch.code}
                  />
                  <p className="text-sm text-muted-foreground">
                    {t("branches.form.codeHint")}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="branch-name">{t("branches.form.name")}</Label>
                  <Input
                    id="branch-name"
                    type="text"
                    aria-invalid={nameError !== undefined}
                    aria-describedby={nameError === undefined ? undefined : "branch-name-error"}
                    value={name}
                    onChange={(event) => {
                      setDuplicateName(false);
                      setName(event.target.value);
                    }}
                  />
                  {nameError && (
                    <p id="branch-name-error" role="alert" className="text-sm text-destructive">
                      {nameError}
                    </p>
                  )}
                </div>
              </div>
            )}

            <DialogFooter>
              <Button
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={onDismiss}
              >
                {t("branches.form.cancel")}
              </Button>
              <Button
                className="flex-1 sm:flex-none"
                variant={action === "deactivate" ? "destructive" : "default"}
                disabled={!ready}
                onClick={() => void submit()}
              >
                {submitting
                  ? t("branches.form.submitting")
                  : t(`branches.actions.${action}Confirm`)}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
