import { useTranslation } from "react-i18next";
import type { NotifySuccessOptions } from "@/lib/notify.js";
import {
  ALL_BRANCHES,
  useAmbientBranchId,
  useCurrentBranch,
  type BranchOption,
} from "./branch-context.js";

/**
 * The shape a branch-scoped read's params have to expose. Declaring it is the
 * whole opt-in: the read hook passes its params through
 * `useBranchScopedParams`, and the ambient branch is injected there rather than
 * by each screen that happens to remember to.
 *
 * A caller that names `branchId` itself keeps it — a crew picker follows the
 * sheet's branch, and a decision queue follows its own visible filter.
 */
export interface BranchScopedParams {
  branchId?: string;
}

export function useBranchScopedParams<T extends BranchScopedParams>(params: T): T {
  const branchId = useAmbientBranchId(params.branchId);
  // A fresh object every render is what the callers already build; query keys
  // are hashed structurally, so identity never enters the cache decision.
  return { ...params, ...(branchId === undefined ? {} : { branchId }) };
}

export interface BranchScopeState {
  /** A single branch is in force, so collections show part of the workspace. */
  scoped: boolean;
  branch: BranchOption | undefined;
  /** What a scope line calls the current branch. */
  label: string;
  showAllBranches: () => void;
}

/** What a screen needs to say which branch its rows came from. */
export function useBranchScope(): BranchScopeState {
  const { currentBranch, setCurrentBranchId } = useCurrentBranch();
  return {
    scoped: currentBranch !== undefined,
    branch: currentBranch,
    label: currentBranch?.name ?? "",
    showAllBranches: () => setCurrentBranchId(ALL_BRANCHES),
  };
}

/** A record's branch, by whichever of the two names the caller holds. */
export interface BranchBearing {
  branchId?: string | undefined;
  branchCode?: string | undefined;
}

function branchOutsideLens(
  record: BranchBearing,
  currentBranch: BranchOption | undefined,
  options: readonly BranchOption[],
): BranchOption | undefined {
  if (currentBranch === undefined) return undefined;

  // A form field that has not been answered yet names no branch at all.
  const branchId = record.branchId === "" ? undefined : record.branchId;
  const branchCode = record.branchCode === "" ? undefined : record.branchCode;
  if (branchId === undefined && branchCode === undefined) return undefined;
  if (branchId !== undefined && branchId === currentBranch.id) return undefined;
  if (branchCode !== undefined && branchCode === currentBranch.code) return undefined;

  const known = options.find(
    (option) => option.id === branchId || option.code === branchCode,
  );
  if (known !== undefined) return known;
  // Outside the caller's own branch list — deactivated, or gone from this
  // member's scope. Named by the code when the record carries one; `name` is
  // empty when only the id is known, and callers phrase that case themselves
  // rather than interpolating a blank into a sentence.
  const code = branchCode ?? "";
  return { id: branchId ?? "", code, name: code };
}

/**
 * Whether a record sits outside the branch the shell is scoped to. Record
 * identity is workspace-scoped, so this is a note on a detail page, never a
 * reason to redirect (design point 3).
 */
export function useOtherBranch(record: BranchBearing): BranchOption | undefined {
  const { currentBranch, options } = useCurrentBranch();
  return branchOutsideLens(record, currentBranch, options);
}

/** A success toast that names where the record actually landed. */
export interface CreatedElsewhereNotice extends NotifySuccessOptions {
  title: string;
}

/**
 * Builds what a creation form's success toast adds when the record landed
 * outside the shell's current agency: the branch named, and an offer to follow
 * it. A row that never appears in the list it was captured from otherwise reads
 * as a save that failed.
 *
 * A builder rather than a value, because the branch is only settled once the
 * command commits. It returns `undefined` when the record landed in the current
 * lens, or when the lens spans every branch — nothing happened out of sight.
 */
export function useCreatedElsewhereNotice(): (
  record: BranchBearing,
) => CreatedElsewhereNotice | undefined {
  const { t } = useTranslation();
  const { currentBranch, options, setCurrentBranchId } = useCurrentBranch();

  return (record) => {
    const other = branchOutsideLens(record, currentBranch, options);
    if (other === undefined) return undefined;

    const title =
      other.name === ""
        ? t("shell.branch.createdInOtherBranch")
        : t("shell.branch.createdInBranch", { branch: other.name });
    // Only a branch the switcher can actually hold is worth offering: an id
    // outside `options` is dropped on the next resolve (`branch-context.tsx`),
    // so the offer would take the operator nowhere.
    if (!options.some((option) => option.id === other.id)) return { title };
    return {
      title,
      action: {
        label: t("shell.branch.view"),
        onClick: () => setCurrentBranchId(other.id),
      },
    };
  };
}
