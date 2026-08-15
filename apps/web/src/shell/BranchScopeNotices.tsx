import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState, type EmptyStateProps } from "@/components/page";
import { StatusBadge } from "@/components/status-badge.js";
import { cn } from "@/lib/utils";
import { useBranchScope, useOtherBranch } from "./branch-scope.js";

/**
 * Why this collection holds these rows. Rendered above every branch-scoped
 * list, and nothing at all on "all my agencies" — there is no narrowing to
 * explain. Identity is carried by the branch's name, never by a colour: a
 * per-branch palette does not scale and would collide with the status tones.
 */
export function BranchScopeLine({
  branch,
  count,
  hasMore = false,
  className,
}: {
  /**
   * The branch to name, for a screen whose own visible filter decides the
   * narrowing rather than the shell. Omitted, the line follows the shell.
   */
  branch?: string | undefined;
  /** Rows the read returned. Omit while the query is still pending. */
  count?: number | undefined;
  /**
   * A cursor still has pages behind it, so `count` is what is loaded rather
   * than what the branch holds — the line says "at least" instead of claiming a
   * total nothing has counted (ADR-0003).
   */
  hasMore?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const { scoped, label } = useBranchScope();
  const name = branch ?? (scoped ? label : undefined);

  if (name === undefined) return null;

  return (
    <p
      data-slot="branch-scope-line"
      className={cn("text-sm text-muted-foreground", className)}
    >
      {count === undefined
        ? t("shell.branch.scopeLineLoading", { branch: name })
        : hasMore
          ? t("shell.branch.scopeLineAtLeast", { branch: name, count })
          : t("shell.branch.scopeLine", { branch: name, count })}
    </p>
  );
}

/**
 * What an empty collection means while a branch is in force: this agency holds
 * none, not "you have never recorded one". The first-run state claims something
 * about the whole workspace, and a scoped list cannot see the whole workspace —
 * so this decides between the two itself, as `BranchScopeLine` does, rather
 * than leaving every list to remember the distinction.
 */
export function BranchScopedEmptyState({
  icon,
  message,
  firstRun,
}: {
  /** Shared by both states; `firstRun.icon` overrides it for the unscoped one. */
  icon: ReactNode;
  /** What this agency holding none means. */
  message?: ReactNode;
  /** The whole-workspace state, shown while the lens spans every branch. */
  firstRun: Omit<EmptyStateProps, "icon"> & { icon?: ReactNode };
}) {
  const { t } = useTranslation();
  const { scoped, label, showAllBranches } = useBranchScope();

  if (!scoped) return <EmptyState {...firstRun} icon={firstRun.icon ?? icon} />;

  return (
    <EmptyState
      icon={icon}
      message={
        <span className="flex flex-col gap-1">
          <strong className="font-semibold text-foreground">
            {t("shell.branch.emptyTitle", { branch: label })}
          </strong>
          <span>{message ?? t("shell.branch.emptyHint")}</span>
        </span>
      }
      action={{
        label: t("shell.branch.showAll"),
        onClick: showAllBranches,
      }}
    />
  );
}

/**
 * A record that lives in another agency. Record identity is workspace-scoped
 * and the ambient branch is a list lens, so a detail page stays open and says
 * so rather than redirecting the operator away from what they opened.
 */
export function OtherBranchNotice({
  branchId,
  branchCode,
  className,
}: {
  branchId?: string | undefined;
  branchCode?: string | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const other = useOtherBranch({ branchId, branchCode });

  if (other === undefined) return null;

  // A deactivated branch reaches here known only by id. Saying "another agency"
  // is honest; interpolating its missing name is not.
  const name = other.known ? other.branch.name : other.code;

  return (
    <StatusBadge tone="info" icon={Building2} className={className}>
      {name === undefined
        ? t("shell.branch.otherBranchUnnamed")
        : t("shell.branch.otherBranch", { branch: name })}
    </StatusBadge>
  );
}
