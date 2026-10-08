import { useTranslation } from "react-i18next";
import { useMeContext } from "../auth/me.js";
import { useCurrentBranch } from "./branch-context.js";

/** The signed-in person in the words the name menu and My settings show. */
export interface Who {
  name: string;
  /** First letter of the name, for the round badge. */
  initial: string;
  workspaceName: string;
  /** "Chauffeur · Douala", or the role alone until the branches load. */
  roleLine: string;
}

export function useWho(): Who | undefined {
  const { t } = useTranslation();
  const me = useMeContext();
  const { options, status } = useCurrentBranch();
  if (me === undefined) return undefined;

  const role = t(`users.roles.${me.role}`);
  let branch: string | undefined;
  if (me.branchScope === "ALL") {
    branch = t("shell.branch.all");
  } else if (status === "ready") {
    const names = options.filter((option) => me.branchScope.includes(option.id));
    branch =
      names.length === 1
        ? names[0]?.name
        : names.length > 1
          ? t("nameMenu.branchCount", { count: names.length })
          : undefined;
  }

  return {
    name: me.displayName,
    initial: Array.from(me.displayName.trim())[0]?.toLocaleUpperCase() ?? "?",
    workspaceName: me.workspaceName,
    roleLine: branch === undefined ? role : t("nameMenu.roleLine", { role, branch }),
  };
}
