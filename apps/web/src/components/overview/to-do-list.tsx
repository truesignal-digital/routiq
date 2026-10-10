import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { buttonVariants } from "@/components/ui/button";

export interface ToDoItem {
  key: string;
  icon?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** One button per row: the page where the work is done. */
  action: { label: string; to: string; search?: Record<string, string | undefined> };
}

/** At most five rows: past that a list stops being "what needs me". */
export const TO_DO_LIMIT = 5;

/**
 * What needs me? (dashboards.html, ToDo): the caller ranks the rows; the list
 * keeps the first five, each with its one button. Nothing waiting is said in
 * words, never left blank.
 */
export function ToDoList({ items, empty }: { items: readonly ToDoItem[]; empty: ReactNode }) {
  if (items.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul data-slot="to-do-list" className="flex flex-col">
      {items.slice(0, TO_DO_LIMIT).map((item) => (
        <li
          key={item.key}
          data-slot="to-do-row"
          className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0 sm:flex-nowrap"
        >
          {item.icon !== undefined && <span className="text-muted-foreground">{item.icon}</span>}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{item.title}</p>
            {item.detail !== undefined && <p className="text-xs text-muted-foreground">{item.detail}</p>}
          </div>
          <Link
            to={item.action.to}
            {...(item.action.search === undefined ? {} : { search: item.action.search })}
            className={buttonVariants({ variant: "outline", size: "desktop-sm" })}
          >
            {item.action.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
