import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useCommandLabel, type CommandName } from "@/commands/labels.js";
import {
  ROLES,
  type DeactivateMemberPayload,
  type MemberBranchScope,
  type MemberListItem,
  type ResetMemberPinPayload,
  type Role,
  type UpdateMemberRolePayload,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ErrorBanner } from "@/components/error-banner.js";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { BranchScopeField, type BranchOption } from "./BranchScopeField.js";
import { MIN_PIN_LENGTH } from "./pin.js";

export type MemberActionKey = "role" | "pin" | "deactivate" | "reactivate";

/** The command each action sends, whose words name it on the menu and in the dialog. */
export const MEMBER_ACTION_COMMANDS: Record<MemberActionKey, CommandName> = {
  role: "update-member-role",
  pin: "reset-member-pin",
  deactivate: "deactivate-member",
  reactivate: "reactivate-member",
};

/**
 * Which actions a member's row offers. A deactivated member has exactly one
 * way back and nothing else: editing the role of someone who cannot log in
 * would write an audit event about a decision nobody made.
 */
export function memberActions(member: MemberListItem): MemberActionKey[] {
  if (member.status === "DEACTIVATED") return ["reactivate"];
  const actions: MemberActionKey[] = ["role"];
  // A membership with no credential has no PIN to reset — only a login has one.
  if (member.username !== null) actions.push("pin");
  actions.push("deactivate");
  return actions;
}

type Outcome =
  | { kind: "form" }
  | { kind: "conflict" }
  | { kind: "error"; code: string };

/**
 * One member command, asked for and answered in place. The guard refusals —
 * LAST_ADMIN, SELF_DEACTIVATION — are answers about this person that the admin
 * has to read, so they replace nothing and appear in the open dialog rather
 * than as a toast that outlives it.
 */
export function MemberActionDialog({
  member,
  action,
  branches,
  client = commandClient,
  onDismiss,
}: {
  member: MemberListItem;
  action: MemberActionKey;
  branches: readonly BranchOption[];
  client?: CommandClient;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const queryClient = useQueryClient();
  const session = useActiveSession();

  const [outcome, setOutcome] = useState<Outcome>({ kind: "form" });
  const [submitting, setSubmitting] = useState(false);
  const [role, setRole] = useState<Role>(member.role);
  const [branchScope, setBranchScope] = useState<MemberBranchScope>(member.branchScope);
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [pinReset, setPinReset] = useState(false);

  // One intent per dialog, minted on first submit: a retry of the same edit
  // replays the same envelope instead of writing a second audit event.
  const roleIntent = useRef<CommandIntent<UpdateMemberRolePayload> | undefined>(undefined);
  const pinIntent = useRef<CommandIntent<ResetMemberPinPayload> | undefined>(undefined);
  const statusIntent = useRef<CommandIntent<DeactivateMemberPayload> | undefined>(undefined);

  const scopeChanged = useMemo(
    () => JSON.stringify(branchScope) !== JSON.stringify(member.branchScope),
    [branchScope, member.branchScope],
  );
  const roleChanged = role !== member.role;
  const pinValid = pin.length >= MIN_PIN_LENGTH && pin === confirmPin;

  const ready =
    !submitting &&
    (action === "role"
      ? roleChanged || scopeChanged
      : action === "pin"
        ? pinValid
        : true);

  function invalidateMembers() {
    return queryClient.invalidateQueries({
      queryKey: ["ws", session?.workspaceSlug, "members"],
    });
  }

  async function submit() {
    if (!ready) return;
    setSubmitting(true);
    setOutcome({ kind: "form" });

    let result;
    if (action === "role") {
      // Only what the admin actually changed travels, and the version the row
      // was rendered at rides along so a stale screen cannot overwrite someone
      // else's edit.
      const payload: UpdateMemberRolePayload = {
        principalId: member.principalId,
        ...(roleChanged ? { role } : {}),
        ...(scopeChanged ? { branchScope } : {}),
      };
      roleIntent.current ??= createCommandIntent<UpdateMemberRolePayload>(
        client,
        "update-member-role",
        1,
      );
      result = await roleIntent.current.submit(payload, {
        expectedVersion: member.rowVersion,
      });
    } else if (action === "pin") {
      pinIntent.current ??= createCommandIntent<ResetMemberPinPayload>(
        client,
        "reset-member-pin",
        1,
      );
      result = await pinIntent.current.submit({
        principalId: member.principalId,
        pin,
      });
    } else {
      statusIntent.current ??= createCommandIntent<DeactivateMemberPayload>(
        client,
        action === "deactivate" ? "deactivate-member" : "reactivate-member",
        1,
      );
      result = await statusIntent.current.submit({ principalId: member.principalId });
    }

    setSubmitting(false);

    if (!result.ok) {
      if (result.code === "VERSION_CONFLICT") setOutcome({ kind: "conflict" });
      else setOutcome({ kind: "error", code: result.code });
      return;
    }

    await invalidateMembers();

    if (action === "pin") {
      // The value is dropped before the acknowledgement renders: the admin
      // reads the PIN off their own hand, never off this screen again.
      setPin("");
      setConfirmPin("");
      setPinReset(true);
      return;
    }
    onDismiss();
  }

  async function reload() {
    await invalidateMembers();
    onDismiss();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label(MEMBER_ACTION_COMMANDS[action])}</DialogTitle>
          <DialogDescription>
            {t(`users.actions.${action}Hint`, { name: member.displayName })}
          </DialogDescription>
        </DialogHeader>

        {outcome.kind === "conflict" ? (
          <>
            <div
              role="alert"
              className="rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning-foreground"
            >
              <p className="font-semibold">{t("users.actions.conflictTitle")}</p>
              <p className="mt-1">{t("users.actions.conflictBody")}</p>
            </div>
            <DialogFooter>
              <Button onClick={() => void reload()}>
                {t("users.actions.reload")}
              </Button>
            </DialogFooter>
          </>
        ) : pinReset ? (
          <>
            <div
              role="status"
              className="rounded-lg bg-info/10 px-3 py-2 text-sm text-info-foreground"
            >
              <p className="font-semibold">{t("users.actions.pinResetTitle")}</p>
              <p className="mt-1">
                {t("users.actions.pinResetBody", { name: member.displayName })}
              </p>
            </div>
            <DialogFooter>
              <Button onClick={onDismiss}>
                {t("common.close")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            {outcome.kind === "error" && <ErrorBanner code={outcome.code} />}

            {action === "role" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label>{t("users.form.role")}</Label>
                  <Select
                    value={role}
                    onValueChange={(value) => value && setRole(value as Role)}
                  >
                    <SelectTrigger className="w-full" aria-label={t("users.form.role")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t(`users.roles.${option}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <BranchScopeField
                  branches={branches}
                  value={branchScope}
                  onChange={setBranchScope}
                />
              </div>
            )}

            {action === "pin" && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="member-pin">{t("users.form.pin")}</Label>
                  <Input
                    id="member-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="member-confirm-pin">{t("users.form.confirmPin")}</Label>
                  <Input
                    id="member-confirm-pin"
                    type="password"
                    inputMode="numeric"
                    autoComplete="new-password"
                    value={confirmPin}
                    onChange={(event) => setConfirmPin(event.target.value)}
                  />
                  {confirmPin !== "" && confirmPin !== pin && (
                    <p className="text-sm text-destructive">{t("users.form.pinMismatch")}</p>
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
                {t("users.form.cancel")}
              </Button>
              <Button
                className="flex-1 sm:flex-none"
                variant={action === "deactivate" ? "destructive" : "default"}
                disabled={!ready}
                onClick={() => void submit()}
              >
                {label(MEMBER_ACTION_COMMANDS[action], submitting ? "submitting" : "submit")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
