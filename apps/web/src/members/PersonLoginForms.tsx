import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  linkPersonLoginPayload,
  unlinkPersonLoginPayload,
  type LinkPersonLoginPayload,
  type MemberListItem,
  type PersonListItem,
  type UnlinkPersonLoginPayload,
} from "@routiq/contracts";
import { useCommandLabel } from "@/commands/labels.js";
import { PinnedField } from "@/components/command-form.js";
import { ChoiceField } from "@/components/form/fields.js";
import { FormLayout } from "@/components/form/form-layout.js";
import { useCommandForm } from "@/components/use-command-form.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent } from "../commands/intent.js";
import { canManageMember, type MemberActor } from "./permissions.js";

/** The person a login form is opened on: its version rides along as expectedVersion. */
export type PersonLoginTarget = Pick<PersonListItem, "id" | "displayName" | "rowVersion" | "loginPrincipalId">;

/** A login the form may offer. */
export interface LoginChoice {
  principalId: string;
  displayName: string;
  username: string;
}

/**
 * The logins a person may be linked to: active ones with a username (only a
 * login can sign in), that the actor may manage, other than the one the person
 * holds now, and not held by another person on screen. The server refuses the
 * rest anyway (LOGIN_ALREADY_LINKED, MEMBER_ROLE_NOT_GRANTABLE).
 */
export function loginChoices(
  members: readonly MemberListItem[],
  actor: MemberActor | undefined,
  held: { current: string | null; taken: ReadonlySet<string> },
): LoginChoice[] {
  return members.flatMap((member) =>
    member.status !== "DEACTIVATED" &&
    member.username !== null &&
    member.principalId !== held.current &&
    !held.taken.has(member.principalId) &&
    canManageMember(actor, member)
      ? [{ principalId: member.principalId, displayName: member.displayName, username: member.username }]
      : [],
  );
}

interface PersonLoginFormProps {
  person: PersonLoginTarget;
  client?: CommandClient | undefined;
  /** After the command committed; the host reloads the list. */
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * Gives a person their login, or changes it (#569). One command for both:
 * relinking ends the old link on the server, which keeps it on record.
 */
export function LinkPersonLoginForm({
  person,
  logins,
  client = commandClient,
  onDone,
  onDismiss,
}: PersonLoginFormProps & { logins: readonly LoginChoice[] }) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const relink = person.loginPrincipalId !== null;
  const ref = relink ? ({ command: "link-person-login", intent: "relink" } as const) : "link-person-login";
  const [intent] = useState(() => createCommandIntent<LinkPersonLoginPayload>(client, "link-person-login", 1));
  const form = useCommandForm(linkPersonLoginPayload, "link-person-login", 1, {
    defaults: () => ({ personId: person.id, principalId: "" }),
    send: (payload) => intent.submit(payload, { expectedVersion: person.rowVersion }),
    success: { namespace: "users", message: relink ? "loginRelinked" : "loginLinked" },
    onDone,
    onDismiss,
    client,
  });

  return (
    <FormLayout
      kind="quick-entry"
      form={form}
      command={ref}
      title={label(ref)}
      description={t(relink ? "persons.login.relinkHint" : "persons.login.linkHint")}
      pinned={<PinnedField label={t("persons.login.person")}>{person.displayName}</PinnedField>}
      ready={logins.length > 0}
    >
      {logins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("persons.login.noneFree")}</p>
      ) : (
        <ChoiceField
          name="principalId"
          label={t("persons.login.field")}
          placeholder={t("persons.login.placeholder")}
          options={logins.map((login) => ({
            value: login.principalId,
            label: t("persons.login.option", { name: login.displayName, username: login.username }),
          }))}
        />
      )}
    </FormLayout>
  );
}

/**
 * Ends a person's link to their login: a decision on the person, with nothing
 * to fill. The person, the login and what either recorded stay as they are.
 */
export function UnlinkPersonLoginForm({
  person,
  loginLabel,
  client = commandClient,
  onDone,
  onDismiss,
}: PersonLoginFormProps & { loginLabel: string }) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const [intent] = useState(() => createCommandIntent<UnlinkPersonLoginPayload>(client, "unlink-person-login", 1));
  const form = useCommandForm(unlinkPersonLoginPayload, "unlink-person-login", 1, {
    defaults: () => ({ personId: person.id }),
    send: (payload) => intent.submit(payload, { expectedVersion: person.rowVersion }),
    success: { namespace: "users", message: "loginUnlinked" },
    onDone,
    onDismiss,
    client,
  });

  return (
    <FormLayout
      kind="decision"
      form={form}
      title={label("unlink-person-login")}
      description={t("persons.login.unlinkHint", { name: person.displayName })}
      pinned={<PinnedField label={t("persons.login.field")}>{loginLabel}</PinnedField>}
      tone="destructive"
    >
      {null}
    </FormLayout>
  );
}
