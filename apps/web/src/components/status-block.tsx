import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { RecordActionBar } from "@/components/record-page.js";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export type StatusTone = "critical" | "waiting" | "success" | "neutral";

export interface StatusNote {
  key: string;
  icon: LucideIcon;
  body: ReactNode;
}

export interface StatusBlockProps {
  tone: StatusTone;
  icon: LucideIcon;
  /** What is going on, in one short sentence: "Waiting for your approval". */
  lead: ReactNode;
  /** The rest of the sentence: why, and who acts. */
  follow?: ReactNode;
  /** Other hard stops, one line each, under the sentence. */
  notes?: readonly StatusNote[];
  /** The decision the status waits for (Approve, Release, Complete), beside the sentence. */
  action?: ReactNode;
  /**
   * Where a phone shows the action: `bar` moves it to the bottom action bar,
   * main button on the right; `inline` keeps it under the sentence, for a page
   * whose bottom bar already holds other actions (the truck's quick actions).
   */
  phoneAction?: "bar" | "inline";
}

/**
 * The status block of a record page (#662), generalised from the truck's
 * banner: shown only when something waits or blocks, it says what, who acts,
 * and holds the decision, so the decision never falls below the fold.
 */
export function StatusBlock({
  tone,
  icon: Icon,
  lead,
  follow,
  notes = [],
  action,
  phoneAction = "bar",
}: StatusBlockProps) {
  const isMobile = useIsMobile();
  const inBar = isMobile && phoneAction === "bar" && action !== undefined && action !== null;

  return (
    <>
      <div
        role="status"
        data-slot="status-block"
        data-tone={tone}
        className={cn(
          "flex flex-col gap-3 rounded-xl border px-4 py-3 md:flex-row md:items-start md:gap-8",
          tone === "critical" && "border-destructive/25 bg-destructive/[0.04] dark:bg-destructive/10",
          tone === "waiting" && "border-transparent bg-warning/10 ring-1 ring-warning/30",
          tone === "success" && "border-success/25 bg-success/[0.05] dark:bg-success/10",
          tone === "neutral" && "bg-muted/40",
        )}
      >
        <div className="flex min-w-0 flex-1 gap-3">
          <Icon
            className={cn(
              "mt-0.5 size-5 shrink-0 md:mt-1",
              tone === "critical" && "text-destructive",
              tone === "waiting" && "text-warning-foreground",
              tone === "success" && "text-success-foreground",
              tone === "neutral" && "text-muted-foreground",
            )}
            aria-hidden
          />
          <div className="min-w-0 space-y-1.5">
            <p className="text-base leading-snug text-pretty md:text-lg md:leading-snug">
              <span className="font-semibold">{lead}</span>
              {follow !== undefined && follow !== null && follow !== "" && (
                <>
                  {" "}
                  <span className="text-foreground/80">{follow}</span>
                </>
              )}
            </p>
            {notes.map((note) => (
              // A div: a note may hold a list (a trip's missing facts).
              <div key={note.key} className="flex gap-1.5 text-sm text-foreground/80">
                <note.icon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                <div className="min-w-0">{note.body}</div>
              </div>
            ))}
          </div>
        </div>
        {!inBar && action !== undefined && action !== null && (
          <div data-slot="status-action" className="flex shrink-0 flex-wrap items-center gap-2 pl-8 md:justify-end md:pl-0">
            {action}
          </div>
        )}
      </div>
      {inBar && <RecordActionBar>{action}</RecordActionBar>}
    </>
  );
}
