import { Building2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/page";
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
  count,
  hasMore = false,
  className,
}: {
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

  if (!scoped) return null;

  return (
    <p
      data-slot="branch-scope-line"
      className={cn("text-sm text-muted-foreground", className)}
    >
      {count === undefined
        ? t("shell.branch.scopeLineLoading", { branch: label })
        : hasMore
          ? t("shell.branch.scopeLineAtLeast", { branch: label, count })
          : t("shell.branch.scopeLine", { branch: label, count })}
    </p>
  );
}

/**
 * What an empty collection means while a branch is in force: this agency holds
 * none, not "you have never recorded one". The first-run state claims something
 * about the whole workspace, and a scoped list cannot see the whole workspace.
 */
export function BranchScopedEmptyState({
  icon,
  message,
}: {
  icon: ReactNode;
  message?: ReactNode;
}) {
  const { t } = useTranslation();
  const { label, showAllBranches } = useBranchScope();

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

  return (
    <StatusBadge tone="info" icon={Building2} className={className}>
      {/* A deactivated branch reaches here known only by id. Saying "another
          agency" is honest; interpolating its missing name is not. */}
      {other.name === ""
        ? t("shell.branch.otherBranchUnnamed")
        : t("shell.branch.otherBranch", { branch: other.name })}
    </StatusBadge>
  );
}
