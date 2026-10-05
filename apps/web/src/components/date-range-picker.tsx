import { useTranslation } from "react-i18next"

import { Calendar, type CalendarDateRange } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface DateRangePickerProps {
  fromValue?: string | undefined
  toValue?: string | undefined
  onFromChange: (value: string) => void
  onToChange: (value: string) => void
}

function parseIsoDate(value: string | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "")
  if (match === null) return undefined
  const [, year, month, day] = match
  const date = new Date(Number(year), Number(month) - 1, Number(day))
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toIsoDate(date: Date | undefined) {
  if (date === undefined) return ""
  const year = String(date.getFullYear()).padStart(4, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function DateRangePicker({
  fromValue,
  toValue,
  onFromChange,
  onToChange,
}: DateRangePickerProps) {
  const { t, i18n } = useTranslation()
  const locale = (i18n.resolvedLanguage ?? i18n.language).startsWith("fr")
    ? "fr"
    : "en"
  const intlLocale = locale === "fr" ? "fr-FR" : "en-US"
  const formatter = new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium" })
  const from = parseIsoDate(fromValue)
  const to = parseIsoDate(toValue)
  const selected: CalendarDateRange = {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  }
  const fromLabel = t("activities.filters.from")
  const toLabel = t("activities.filters.to")

  function displayValue(value: string | undefined) {
    const date = parseIsoDate(value)
    return date === undefined ? "" : formatter.format(date)
  }

  function changeRange(range: CalendarDateRange | undefined) {
    onFromChange(toIsoDate(range?.from))
    onToChange(toIsoDate(range?.to))
  }

  return (
    <Popover>
      <PopoverTrigger
        nativeButton={false}
        render={
          <div
            role="button"
            tabIndex={0}
            aria-label={`${fromLabel} – ${toLabel}`}
            className="flex h-11 min-w-56 cursor-pointer items-center gap-1 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50 desktop:h-8"
          />
        }
      >
        <Input
          readOnly
          tabIndex={-1}
          value={displayValue(fromValue)}
          placeholder={fromLabel}
          aria-label={fromLabel}
          className="pointer-events-none min-w-0 desktop:h-8"
        />
        <Input
          readOnly
          tabIndex={-1}
          value={displayValue(toValue)}
          placeholder={toLabel}
          aria-label={toLabel}
          className="pointer-events-none min-w-0 desktop:h-8"
        />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={selected}
          onSelect={changeRange}
          locale={locale}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DateRangePicker }
