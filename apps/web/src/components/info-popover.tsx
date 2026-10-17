import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * How a figure is worked out, or what it leaves out, one tap away instead of
 * a sentence resting on the page. A popover, not a tooltip: a phone has no
 * hover. The icon trigger is a 44 px target on a phone and 24 px with a mouse.
 */
export function InfoPopover({
  label,
  children,
  trigger = "icon",
  icon,
  className,
}: {
  /** The trigger's accessible name, and its text when `trigger` is "text". */
  label: string;
  children: ReactNode;
  trigger?: "icon" | "text";
  /** Leads a text trigger, e.g. a warning sign when something is left out. */
  icon?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <Popover>
      <PopoverTrigger
        data-slot="info-popover-trigger"
        aria-label={trigger === "icon" ? label : undefined}
        className={cn(
          trigger === "icon"
            ? "-m-3 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring desktop:-m-0.5 desktop:size-6"
            : cn(buttonVariants({ variant: "link", size: "desktop-sm" }), "gap-1.5 px-0 text-sm text-foreground"),
          className,
        )}
      >
        {trigger === "icon" ? (
          <Info className="size-4" aria-hidden />
        ) : (
          <>
            {icon}
            {label}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent data-slot="info-popover" aria-label={label} align="start" className="w-80 max-w-[calc(100vw-2rem)] text-sm leading-relaxed">
        {children}
      </PopoverContent>
    </Popover>
  );
}
