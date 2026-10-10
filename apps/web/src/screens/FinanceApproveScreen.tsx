import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMeContext } from "@/auth/me.js";
import { canApproveEntries } from "@/finance/permissions.js";
import { WaitingApprovals } from "@/finance/WaitingApprovals.js";

/**
 * Money › To approve (#664): the entries this viewer may decide, the queue
 * that was the Entries list's waiting view (#314). Anyone else sent here
 * lands on Entries rather than on an empty queue.
 */
export function FinanceApproveScreen() {
  const navigate = useNavigate();
  const me = useMeContext();
  // role-config: only a decider has a queue.
  const canApprove = canApproveEntries(me?.role, me?.enabledModules);
  const search: { branch?: "all" | undefined } = useSearch({ strict: false });
  useEffect(() => {
    if (me !== undefined && !canApprove) void navigate({ to: "/finance/entries", replace: true });
  }, [me, canApprove, navigate]);
  if (!canApprove) return null;
  // `branch=all` arrives from an overflow line that already named the work
  // outside the shell's branch, so the queue opens widened.
  return <WaitingApprovals arrivingWidened={search.branch === "all"} />;
}
