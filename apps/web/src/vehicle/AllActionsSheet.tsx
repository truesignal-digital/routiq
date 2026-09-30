import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Lock, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { groupedActions } from "./actions.js";
import { useVehicle } from "./context.js";
import { useLockText } from "./parts.js";

/**
 * Every action this role has on the vehicle, by area, the role's own area
 * first. One line each says what it does; one that the vehicle's state blocks
 * stays listed, disabled, with what it waits for.
 */
export function AllActionsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { asset, viewer, availability, runAction } = useVehicle();
  const lockText = useLockText();
  const [query, setQuery] = useState("");

  const needle = query.trim().toLocaleLowerCase();
  const groups = groupedActions(viewer)
    .map(({ group, actions }) => ({
      group,
      actions: actions.filter((action) => {
        if (needle === "") return true;
        const haystack = [
          t(`vehicle.actions.${action.key}.label`),
          t(`vehicle.actions.${action.key}.description`),
          t(`vehicle.actions.groups.${group}`),
        ]
          .join(" ")
          .toLocaleLowerCase();
        return haystack.includes(needle);
      }),
    }))
    .filter((entry) => entry.actions.length > 0);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setQuery("");
      }}
    >
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        initialFocus={isMobile ? titleRef : true}
        className={cn("gap-0", isMobile ? "max-h-[88vh] rounded-t-xl" : "data-[side=right]:sm:max-w-md")}
      >
        <SheetHeader className="gap-1 border-b pr-12">
          <SheetTitle ref={titleRef} tabIndex={-1} className="text-base font-semibold outline-none">
            {t("vehicle.actions.all.title")}
          </SheetTitle>
          <SheetDescription>
            {t("vehicle.actions.all.description", { vehicle: asset.assetCode })}
          </SheetDescription>
          <div className="relative mt-2.5">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("vehicle.actions.all.searchPlaceholder")}
              className="h-9 pl-8"
              aria-label={t("vehicle.actions.all.search")}
            />
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-4">
          {groups.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              {t("vehicle.actions.all.noMatch", { query })}
            </p>
          ) : (
            groups.map(({ group, actions }) => (
              <section key={group} className="pt-2" aria-labelledby={`vehicle-actions-${group}`}>
                <h3 id={`vehicle-actions-${group}`} className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                  {t(`vehicle.actions.groups.${group}`)}
                </h3>
                <ul>
                  {actions.map((action) => {
                    const state = availability(action.key);
                    const lock = state.state === "locked" ? state.lock : undefined;
                    return (
                      <li key={action.key}>
                        <button
                          type="button"
                          disabled={lock !== undefined}
                          onClick={() => runAction(action.key)}
                          className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:hover:bg-transparent"
                        >
                          <span
                            className={cn(
                              "grid size-8 shrink-0 place-items-center rounded-md bg-muted",
                              lock ? "text-muted-foreground" : "text-foreground/80",
                            )}
                          >
                            <action.icon className="size-4" aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span
                              className={cn(
                                "flex items-center gap-1.5 text-sm font-medium",
                                lock && "text-muted-foreground",
                              )}
                            >
                              {t(`vehicle.actions.${action.key}.label`)}
                              {lock && <Lock className="size-3" aria-hidden />}
                            </span>
                            <span className="block text-xs leading-snug text-muted-foreground">
                              {lock ? lockText(lock) : t(`vehicle.actions.${action.key}.description`)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
