import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAssetRegistrationReference } from "@/assets/reference.js";
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

export interface BranchContextValue {
  currentBranchId: CurrentBranchId;
  /** The selected branch, or undefined while on "all my branches". */
  currentBranch: BranchOption | undefined;
  /** Active branches inside the caller's scope, in the read's own order. */
  options: BranchOption[];
  /** Scope is a single branch: nothing to switch, so no switcher renders. */
  locked: boolean;
  setCurrentBranchId: (branchId: CurrentBranchId) => void;
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
 * `loaded` distinguishes "no branches in scope" from "branches not fetched
 * yet": before they land a previously valid id is honoured, or every list would
 * flash the whole scope and then narrow back one render later.
 */
export function resolveCurrentBranchId(
  stored: string | null,
  options: readonly BranchOption[],
  loaded: boolean,
): CurrentBranchId {
  const soleBranch = options.length === 1 ? options[0] : undefined;
  if (loaded && soleBranch !== undefined) return soleBranch.id;
  if (stored === null || stored === ALL_BRANCHES) return ALL_BRANCHES;
  if (!loaded) return stored;
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
  locked: false,
  setCurrentBranchId: () => {},
});

export function BranchProvider({ children }: { children: ReactNode }) {
  const session = useActiveSession();
  const workspaceSlug = session?.workspaceSlug;
  // The reference read is already the list of active branches inside the
  // caller's scope — the same one the record forms pick a branch from.
  const reference = useAssetRegistrationReference();
  const options = useMemo(() => reference.data?.branches ?? [], [reference.data]);
  const loaded = reference.data !== undefined;

  const [stored, setStored] = useState<string | null>(() =>
    readStoredBranch(workspaceSlug),
  );
  useEffect(() => {
    setStored(readStoredBranch(workspaceSlug));
  }, [workspaceSlug]);

  const currentBranchId = resolveCurrentBranchId(stored, options, loaded);

  // A branch that was deactivated, or that left this member's scope, is not a
  // filter any more: forget it so the next load starts from "all my agencies"
  // rather than resurrecting it the moment it comes back.
  useEffect(() => {
    if (workspaceSlug === undefined || stored === null || !loaded) return;
    if (stored === ALL_BRANCHES) return;
    if (options.some((option) => option.id === stored)) return;
    localStorage.removeItem(branchStorageKey(workspaceSlug));
    setStored(null);
  }, [workspaceSlug, stored, options, loaded]);

  const setCurrentBranchId = useCallback(
    (branchId: CurrentBranchId) => {
      setStored(branchId);
      if (workspaceSlug !== undefined) {
        localStorage.setItem(branchStorageKey(workspaceSlug), branchId);
      }
    },
    [workspaceSlug],
  );

  const value = useMemo<BranchContextValue>(
    () => ({
      currentBranchId,
      currentBranch: options.find((option) => option.id === currentBranchId),
      options,
      locked: loaded && options.length === 1,
      setCurrentBranchId,
    }),
    [currentBranchId, options, loaded, setCurrentBranchId],
  );

  return <BranchCtx.Provider value={value}>{children}</BranchCtx.Provider>;
}

export function useCurrentBranch(): BranchContextValue {
  return useContext(BranchCtx);
}

/**
 * The ambient branch as a list filter. An explicit value — a table's own branch
 * filter, or a form's branch — always wins: the switcher is a default, not a
 * lock.
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
