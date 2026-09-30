import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { formatRelativeTime } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { useVehicle } from "../context.js";
import { LinkButton, Sep, withNodes } from "../parts.js";

/** One quiet line of facts under the sentence; the Details card holds the rest. */
export function FactsLine({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t, i18n } = useTranslation();
  const { asset, gates, panel } = useVehicle();
  const locale = i18n.language;
  const reading = asset.lastReading;

  return (
    <div className="hidden items-center gap-x-2.5 gap-y-1 px-1 text-sm text-muted-foreground md:flex md:flex-wrap">
      <span>
        {withNodes((slots) => t("vehicle.facts.custodian", slots), {
          name: (
            <span className="font-medium text-foreground">
              {asset.custodian?.displayName ?? t("vehicle.facts.nobody")}
            </span>
          ),
        })}
      </span>
      {gates.trips && (
        <>
          <Sep />
          <span>
            {reading === null
              ? t("vehicle.facts.noReading")
              : withNodes(
                  (slots) =>
                    t("vehicle.facts.reading", {
                      ...slots,
                      readingType: reading.readingType,
                      ago: formatRelativeTime(reading.observedAt, locale),
                    }),
                  {
                    value: (
                      <LinkButton onClick={() => panel.openRecord({ kind: "readings" })}>
                        {t("vehicle.facts.readingValue", {
                          readingType: reading.readingType,
                          value: reading.value,
                        })}
                      </LinkButton>
                    ),
                  },
                )}
          </span>
        </>
      )}
      <Sep />
      <span>{t("vehicle.facts.locationNoReport")}</span>
      <Sep />
      <span>
        {withNodes(
          (slots) =>
            asset.commissionedAt === null
              ? slots["status"] ?? ""
              : t("vehicle.facts.lifecycleSince", {
                  ...slots,
                  since: new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(
                    new Date(asset.commissionedAt),
                  ),
                }),
          {
            status: (
              <span className="font-medium text-foreground">
                {t(`assets.status.${asset.lifecycleStatus}`)}
              </span>
            ),
          },
        )}
      </span>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {open ? t("vehicle.header.hideDetails") : t("vehicle.header.details")}
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
    </div>
  );
}
