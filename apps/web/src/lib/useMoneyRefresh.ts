import { useQueryClient } from "@tanstack/react-query";
import { useActiveSession } from "@/auth/store.js";

/**
 * Every read a money entry moves: finance (lists, the entry, totals,
 * approvals, the money overview), Home's dashboard and the To do. A write that
 * records or decides an entry refreshes them all, so whichever page the user
 * lands on shows the server's figures without a reload (ADR-0001, #725).
 */
const MONEY_READS = ["finance", "dashboard", "attention"] as const;

export function useMoneyRefresh(): () => Promise<void> {
  const queryClient = useQueryClient();
  const slug = useActiveSession()?.workspaceSlug;
  return async () => {
    await Promise.all(
      MONEY_READS.map((read) => queryClient.invalidateQueries({ queryKey: ["ws", slug, read] })),
    );
  };
}
