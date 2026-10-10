import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { MemberListItem, PersonListItem } from "@routiq/contracts";
import { LinkPersonLoginForm, loginChoices, UnlinkPersonLoginForm } from "./PersonLoginForms.js";
import type { MemberActor } from "./permissions.js";
import { useMembers } from "./useMembers.js";

export type PersonLoginAction = "link" | "relink" | "unlink";

/**
 * The login actions a person's row offers. Only member administrators call
 * this (the screen's role-config seam); the server holds them to the logins
 * they may manage. An inactive person gets no new login.
 */
export function personLoginActions(person: PersonListItem): PersonLoginAction[] {
  if (person.loginPrincipalId !== null) return person.active ? ["relink", "unlink"] : ["unlink"];
  return person.active ? ["link"] : [];
}

/** The workspace's logins by principal id, from the members read the admin may load. */
function useLoginIndex(): ReadonlyMap<string, MemberListItem> {
  const members = useMembers();
  return useMemo(
    () =>
      new Map(
        (members.data?.pages.flatMap((page) => page.items) ?? []).map((member) => [member.principalId, member]),
      ),
    [members.data],
  );
}

function useLoginLabel(principalId: string | null): string | undefined {
  const { t } = useTranslation();
  const login = useLoginIndex().get(principalId ?? "");
  if (login === undefined) return undefined;
  return login.username === null
    ? login.displayName
    : t("persons.login.option", { name: login.displayName, username: login.username });
}

/** The Login column's cell: the linked login's name and username, or none. */
export function PersonLoginCell({ principalId }: { principalId: string | null }) {
  const { t } = useTranslation();
  const label = useLoginLabel(principalId);
  if (principalId === null) {
    return <span className="text-muted-foreground">{t("persons.noLogin")}</span>;
  }
  return <span>{label ?? "…"}</span>;
}

/** Opens the form for one login action on one person. */
export function PersonLoginActionHost({
  person,
  action,
  persons,
  actor,
  onDone,
  onDismiss,
}: {
  person: PersonListItem;
  action: PersonLoginAction;
  /** The people on screen: a login one of them holds is not offered again. */
  persons: readonly PersonListItem[];
  actor: MemberActor | undefined;
  onDone: () => void;
  onDismiss: () => void;
}) {
  const index = useLoginIndex();
  const loginLabel = useLoginLabel(person.loginPrincipalId);
  const logins = useMemo(() => {
    const taken = new Set(
      persons.flatMap((other) =>
        other.id !== person.id && other.loginPrincipalId !== null ? [other.loginPrincipalId] : [],
      ),
    );
    return loginChoices([...index.values()], actor, { current: person.loginPrincipalId, taken });
  }, [index, persons, person, actor]);

  if (action === "unlink") {
    return (
      <UnlinkPersonLoginForm
        person={person}
        loginLabel={loginLabel ?? "…"}
        onDone={onDone}
        onDismiss={onDismiss}
      />
    );
  }
  return <LinkPersonLoginForm person={person} logins={logins} onDone={onDone} onDismiss={onDismiss} />;
}
