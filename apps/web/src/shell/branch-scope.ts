import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { NotifySuccessOptions } from "@/lib/notify.js";
import {
  ALL_BRANCHES,
  ambientBranchId,
  useCurrentBranch,
  useCurrentBranchCode,
  type BranchOption,
  type CurrentBranchId,
} from "./branch-context.js";

/**
 * The shape a branch-scoped read's params have to expose. Declaring it is the
 * whole opt-in: the read hook passes its params through
 * `useBranchScopedParams`, and the ambient branch is injected there rather than
 * by each screen that happens to remember to.
 *
 * A caller that names `branchId` itself keeps it — a crew picker follows the
 * sheet's branch, and a decision queue follows its own visible filter.
 * `ALL_BRANCHES` names the opposite: a command form's picker offers the whole
 * scope however the shell is filtered.
 */
export interface BranchScopedParams {
  branchId?: string;
}

export function useBranchScopedParams<T extends BranchScopedParams>(params: T): T {
  return scopedParams(params, useCurrentBranch().currentBranchId);
}

/** useBranchScopedParams without React, for a route loader: same params, same cache key (#496). */
export function scopedParams<T extends BranchScopedParams>(params: T, currentBranchId: CurrentBranchId): T {
  const branchId = ambientBranchId(currentBranchId, params.branchId);
  // `ALL_BRANCHES` resolves to `undefined`, and "every branch" is the absence of
  // the param — so the caller's own `branchId` is dropped before the rebuild
  // rather than spread back over the result as a sentinel the API would filter
  // on. A fresh object every render is what the callers already build; query
  // keys are hashed structurally, so identity never enters the cache decision.
  const { branchId: _requested, ...rest } = params;
  return { ...rest, ...(branchId === undefined ? {} : { branchId }) } as T;
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

/**
 * Keeps a creation form's branch field on the shell's current agency — or on
 * the only branch there is, when the workspace has one.
 *
 * Followed, not latched. Filling a blank field is the preselect; re-filling it
 * when the shell's agency *moves* is the part that matters — an operator who
 * sets this once and keeps capturing would otherwise go on filing into the
 * agency the shell has since left. Between moves it only repairs a blank, so an
 * explicit pick stands. The field stays editable throughout: the server
 * authorizes the branch either way.
 */
export function useFollowShellBranch(
  branches: readonly { code: string }[],
  current: string,
  fill: (branchCode: string) => void,
): void {
  const currentBranchCode = useCurrentBranchCode();
  const preselected =
    currentBranchCode ?? (branches.length === 1 ? branches[0]?.code : undefined);

  // `fill` is deliberately out of the effect's deps, so a caller writing its
  // setter inline does not re-run the follow every render — which leaves the
  // effect holding whichever closure the last dep change captured. The ref is
  // what keeps it calling the current one.
  const fillRef = useRef(fill);
  fillRef.current = fill;

  const lastPreselected = useRef<string>(undefined);
  useEffect(() => {
    if (preselected === undefined) return;
    const shellMoved = preselected !== lastPreselected.current;
    lastPreselected.current = preselected;
    if (shellMoved || current === "") fillRef.current(preselected);
  }, [preselected, current]);
}

/** A record's branch, by whichever of the two names the caller holds. */
export interface BranchBearing {
  branchId?: string | undefined;
  branchCode?: string | undefined;
}

/**
 * A branch the shell's lens is not currently on. `known` separates one the
 * switcher can still hold — nameable, and worth offering to follow — from one
 * that is deactivated or gone from this member's scope, which a record can name
 * by code at best and often not at all.
 */
export type OtherBranch =
  | { known: true; branch: BranchOption }
  | { known: false; code: string | undefined };

function branchOutsideLens(
  record: BranchBearing,
  currentBranch: BranchOption | undefined,
  options: readonly BranchOption[],
): OtherBranch | undefined {
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
  if (known !== undefined) return { known: true, branch: known };
  return { known: false, code: branchCode };
}

/**
 * Whether a record sits outside the branch the shell is scoped to. Record
 * identity is workspace-scoped, so this is a note on a detail page, never a
 * reason to redirect (design point 3).
 */
export function useOtherBranch(record: BranchBearing): OtherBranch | undefined {
  const { currentBranch, options } = useCurrentBranch();
  return branchOutsideLens(record, currentBranch, options);
}

/** What a creation form's success toast adds when the record landed elsewhere. */
export type CreatedElsewhereNotice = Pick<
  NotifySuccessOptions,
  "extraLines" | "action"
>;

/**
 * Builds what a creation form's success toast adds when the record landed
 * outside the shell's current agency: a line naming the branch, and an offer to
 * follow it. A row that never appears in the list it was captured from
 * otherwise reads as a save that failed. It rides under the domain's own
 * success title rather than replacing it — where a record landed does not
 * cancel what happened to it.
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

    // Only a branch the switcher can actually hold is worth offering: one
    // outside `options` is dropped on the next resolve (`branch-context.tsx`),
    // so the offer would take the operator nowhere.
    if (!other.known) {
      return {
        extraLines: [
          other.code === undefined
            ? t("shell.branch.createdInOtherBranch")
            : t("shell.branch.createdInBranch", { branch: other.code }),
        ],
      };
    }

    const { id, name } = other.branch;
    return {
      extraLines: [t("shell.branch.createdInBranch", { branch: name })],
      action: {
        label: t("shell.branch.view"),
        onClick: () => setCurrentBranchId(id),
      },
    };
  };
}
