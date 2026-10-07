import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { SectionCount } from "./sections.js";

/**
 * The expanded row's count: its own link into the filtered view, beside the
 * row's link to the page. As tall as the row, so it is a thumb target in the
 * phone sheet.
 */
export function NavCountLink({
  count,
  value,
  onNavigate,
}: {
  count: SectionCount;
  value: number;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={count.to}
      search={count.search}
      aria-label={t(count.labelKey, { count: value })}
      onClick={onNavigate}
      data-nav-count={count.key}
      className="absolute inset-y-0 right-0 flex items-center rounded-md px-1.5 outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
    >
      {/* Red because a count only ever means the work waits on you (sidebar.html, Rules). */}
      <span className="grid h-5 min-w-5 place-items-center rounded-md bg-destructive px-1.5 text-xs font-bold text-primary-foreground tabular-nums">
        {value}
      </span>
    </Link>
  );
}

/**
 * The collapsed rail's dot. Shown only in the rail; its text is for screen
 * readers there, where the row's tooltip carries the number for everyone else.
 */
export function NavCountDot({ count, value }: { count: SectionCount; value: number }) {
  const { t } = useTranslation();
  return (
    <span
      data-nav-count-dot={count.key}
      className="absolute top-1 right-1 hidden size-2 rounded-full bg-destructive group-data-[collapsible=icon]:block"
    >
      <span className="sr-only">{t(count.labelKey, { count: value })}</span>
    </span>
  );
}
