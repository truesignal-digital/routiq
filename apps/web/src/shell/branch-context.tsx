import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { useAssetRegistrationReference } from "@/assets/reference.js";
import { toast } from "@/components/ui/toast.js";
import { useActiveSession } from "../auth/store.js";

/**
 * "Log into a branch" is a client-side stance, not a session (spec decision 6):
 * the server keeps deriving branch scope from the membership, and this only
 * ever narrows inside it. `ALL` is the default — the caller's whole scope.
 */
export const ALL_BRANCHES = "ALL";

export type CurrentBranchId = string | typeof ALL_BRANCHES;

export interface BranchOption {
  id: string;
  code: string;
  name: string;
}

/**
 * Whether the branches behind the ambient scope are known. `error` is not
 * `loading`: a scope resolved against branches that never arrived would narrow
 * every list by an id nothing on screen can name or reset.
 */
export type BranchOptionsStatus = "loading" | "ready" | "error";

export interface BranchContextValue {
  currentBranchId: CurrentBranchId;
  /** The selected branch, or undefined while on "all my branches". */
  currentBranch: BranchOption | undefined;
  /** Active branches inside the caller's scope, in the read's own order. */
  options: BranchOption[];
  status: BranchOptionsStatus;
  /** Scope is a single branch: nothing to switch, so the pill is inert. */
  locked: boolean;
  /** The last explicit switch, phrased for the shell's live region. */
  announcement: string;
  setCurrentBranchId: (branchId: CurrentBranchId) => void;
  /** Re-reads the branch list after it failed to load. */
  retry: () => void;
}

/** Per workspace, so two workspaces on one device do not share a branch. */
export function branchStorageKey(workspaceSlug: string): string {
  return `routiq.branch.${workspaceSlug}`;
}

function readStoredBranch(workspaceSlug: string | undefined): string | null {
  if (workspaceSlug === undefined) return null;
  return localStorage.getItem(branchStorageKey(workspaceSlug));
}

/**
 * What a stored choice resolves to once the branches are known.
 *
 * `loading` distinguishes "no branches in scope" from "branches not fetched
 * yet": before they land a previously valid id is honoured, or every list would
 * flash the whole scope and then narrow back one render later. `error` is the
 * opposite call — the branches may never land, so an unvalidated id is dropped
 * rather than left narrowing lists that nothing can widen again.
 */
export function resolveCurrentBranchId(
  stored: string | null,
  options: readonly BranchOption[],
  status: BranchOptionsStatus,
): CurrentBranchId {
  if (status === "error") return ALL_BRANCHES;
  const soleBranch = options.length === 1 ? options[0] : undefined;
  if (status === "ready" && soleBranch !== undefined) return soleBranch.id;
  if (stored === null || stored === ALL_BRANCHES) return ALL_BRANCHES;
  if (status === "loading") return stored;
  return options.some((option) => option.id === stored) ? stored : ALL_BRANCHES;
}

/**
 * Defaulted rather than undefined: a screen rendered outside the shell behaves
 * as "all my branches" instead of throwing.
 */
const BranchCtx = createContext<BranchContextValue>({
  currentBranchId: ALL_BRANCHES,
  currentBranch: undefined,
  options: [],
  status: "ready",
  locked: false,
  announcement: "",
  setCurrentBranchId: () => {},
  retry: () => {},
});

export function BranchProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const session = useActiveSession();
  const workspaceSlug = session?.workspaceSlug;
  // The reference read is already the list of active branches inside the
  // caller's scope — the same one the record forms pick a branch from.
  const reference = useAssetRegistrationReference();
  const options = useMemo(() => reference.data?.branches ?? [], [reference.data]);
  const status: BranchOptionsStatus =
    reference.data !== undefined
      ? "ready"
      : reference.isError
        ? "error"
        : "loading";
  const { refetch } = reference;

  const [stored, setStored] = useState<string | null>(() =>
    readStoredBranch(workspaceSlug),
  );
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    setStored(readStoredBranch(workspaceSlug));
  }, [workspaceSlug]);

  const currentBranchId = resolveCurrentBranchId(stored, options, status);

  // A branch that was deactivated, or that left this member's scope, is not a
  // filter any more: forget it so the next load starts from "all my agencies"
  // rather than resurrecting it the moment it comes back. A failed read proves
  // nothing about the branch, so it never triggers the cleanup.
  useEffect(() => {
    if (workspaceSlug === undefined || stored === null || status !== "ready") return;
    if (stored === ALL_BRANCHES) return;
    if (options.some((option) => option.id === stored)) return;
    localStorage.removeItem(branchStorageKey(workspaceSlug));
    setStored(null);
  }, [workspaceSlug, stored, options, status]);

  const setCurrentBranchId = useCallback(
    (branchId: CurrentBranchId) => {
      setStored(branchId);
      if (workspaceSlug !== undefined) {
        localStorage.setItem(branchStorageKey(workspaceSlug), branchId);
      }
      const branch =
        branchId === ALL_BRANCHES
          ? t("shell.branch.all")
          : (options.find((option) => option.id === branchId)?.name ?? branchId);
      const message = t("shell.branch.switched", { branch });
      // One transient toast plus the live region: switching is a change of lens,
      // not an operation with an outcome, so it never blocks a collection.
      toast.add({ type: "info", title: message });
      setAnnouncement(message);
    },
    [workspaceSlug, options, t],
  );

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo<BranchContextValue>(
    () => ({
      currentBranchId,
      currentBranch: options.find((option) => option.id === currentBranchId),
      options,
      status,
      locked: status === "ready" && options.length === 1,
      announcement,
      setCurrentBranchId,
      retry,
    }),
    [currentBranchId, options, status, announcement, setCurrentBranchId, retry],
  );

  return <BranchCtx.Provider value={value}>{children}</BranchCtx.Provider>;
}

export function useCurrentBranch(): BranchContextValue {
  return useContext(BranchCtx);
}

/**
 * The ambient branch as a list filter. An explicit value — a form's branch, or
 * a decision queue's own filter — always wins: the switcher is a default, not a
 * lock.
 *
 * Branch-scoped reads declare themselves through `useBranchScopedParams`
 * (`branch-scope.ts`), which is the one place the ambient branch enters a
 * query — screens do not reach for it themselves.
 *
 * The exception is a screen whose filter is its own visible control rather than
 * a narrowing: the approvals queue reads the ambient branch to *preset* that
 * filter, then lets the approver widen it back (`FinanceApprovalsScreen.tsx`).
 */
export function useAmbientBranchId(explicit?: string): string | undefined {
  const { currentBranchId } = useCurrentBranch();
  if (explicit !== undefined && explicit !== "") return explicit;
  return currentBranchId === ALL_BRANCHES ? undefined : currentBranchId;
}

/** The current branch's `code` — what a command names a branch by. */
export function useCurrentBranchCode(): string | undefined {
  return useCurrentBranch().currentBranch?.code;
}
