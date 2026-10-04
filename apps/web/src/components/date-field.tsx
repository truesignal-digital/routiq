import { useId, useState, type ChangeEvent, type Ref } from "react"
import { useTranslation } from "react-i18next"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type Kind = "date" | "datetime"

export interface DateFieldProps {
  /**
   * DateField: an ISO date, `YYYY-MM-DD`. DateTimeField: a wall clock with no
   * zone, `YYYY-MM-DDTHH:mm`, the value a `datetime-local` input used to give,
   * so forms keep stamping the offset exactly as before. "" for none.
   */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** Earliest value allowed, in the same format as `value`. */
  min?: string
  /** Latest value allowed, in the same format as `value`. */
  max?: string
  id?: string
  name?: string
  ref?: Ref<HTMLInputElement>
  disabled?: boolean
  placeholder?: string
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean
}

const plainSpaces = (text: string) => text.replace(/[  ]/g, " ")
const pad = (value: number) => String(value).padStart(2, "0")

function isoDate(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function dateFromIso(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (match === null) return undefined
  return realDate(Number(match[1]), Number(match[2]), Number(match[3]))
}

function realDate(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : undefined
}

function timeOf(value: string) {
  return /T(\d{2}:\d{2})/.exec(value)?.[1]
}

function nowTime() {
  const now = new Date()
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function formatDay(iso: string, locale: string) {
  const date = dateFromIso(iso)
  if (date === undefined) return ""
  return plainSpaces(
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date),
  )
}

function formatTime(time: string, locale: string) {
  const [hours = 0, minutes = 0] = time.split(":").map(Number)
  return plainSpaces(
    new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
      new Date(2000, 0, 1, hours, minutes),
    ),
  )
}

function formatValue(kind: Kind, value: string, locale: string) {
  const day = formatDay(value, locale)
  if (kind === "date" || day === "") return day
  const time = timeOf(value)
  return time === undefined ? "" : `${day} ${formatTime(time, locale)}`
}

/** Where day, month and year sit in the locale's numeric date: d/m/y in French, m/d/y in English. */
function fieldOrder(locale: string) {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" })
    .formatToParts(new Date(2000, 0, 2))
    .flatMap((part) =>
      part.type === "day" || part.type === "month" || part.type === "year" ? [part.type] : [],
    )
}

function parseDay(text: string, locale: string) {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text)
  if (iso !== null) {
    const date = realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return date === undefined ? undefined : isoDate(date)
  }
  const numeric = /^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/.exec(text)
  if (numeric === null) return undefined
  const parts: Record<string, number> = {}
  fieldOrder(locale).forEach((type, index) => {
    parts[type] = Number(numeric[index + 1])
  })
  const { day, month, year } = parts
  if (day === undefined || month === undefined || year === undefined || year < 1000) return undefined
  const date = realDate(year, month, day)
  return date === undefined ? undefined : isoDate(date)
}

/** "14:30", "14h30", "14h", "1430", "2:30 PM". */
function parseTime(text: string) {
  const match = /^(\d{1,2})(?:[:hH.]?(\d{2}))?[hH]?\s*(?:([aApP])\.?\s*[mM]\.?)?$/.exec(text)
  if (match === null) return undefined
  let hours = Number(match[1])
  const minutes = Number(match[2] ?? "0")
  const meridiem = match[3]?.toLowerCase()
  if (minutes > 59) return undefined
  if (meridiem !== undefined) {
    if (hours < 1 || hours > 12) return undefined
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0)
  }
  if (hours > 23) return undefined
  return `${pad(hours)}:${pad(minutes)}`
}

function parseValue(kind: Kind, raw: string, locale: string) {
  const text = plainSpaces(raw).trim()
  if (kind === "date") return parseDay(text, locale)
  const iso = /^(\d{4}-\d{1,2}-\d{1,2})[T ](\d{1,2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(text)
  const split = iso ?? /^(\S+?)(?:,?\s+(?:à\s+|at\s+)?)(\S.*)$/i.exec(text)
  if (split === null) return undefined
  const day = parseDay(split[1] ?? "", locale)
  const time = parseTime((split[2] ?? "").trim())
  return day === undefined || time === undefined ? undefined : `${day}T${time}`
}

type Problem = "format" | "early" | "late"

function DateCalendarField({
  kind,
  value,
  onChange,
  onBlur,
  min,
  max,
  id,
  name,
  ref,
  disabled = false,
  placeholder,
  className,
  ...aria
}: DateFieldProps & { kind: Kind }) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const calendarLocale = locale.startsWith("fr") ? "fr" : "en"
  const problemId = useId()
  const timeId = useId()

  const [text, setText] = useState(() => formatValue(kind, value, locale))
  const [shown, setShown] = useState({ value, locale })
  const [problem, setProblem] = useState<Problem | null>(null)
  const [open, setOpen] = useState(false)
  const [timeText, setTimeText] = useState("")

  if (shown.value !== value || shown.locale !== locale) {
    setShown({ value, locale })
    setText(formatValue(kind, value, locale))
    setProblem(null)
  }

  const minDay = min?.slice(0, 10)
  const maxDay = max?.slice(0, 10)

  function rangeProblem(next: string): Problem | null {
    if (min !== undefined && min !== "" && next < min) return "early"
    if (max !== undefined && max !== "" && next > max) return "late"
    return null
  }

  function commit(next: string) {
    setShown({ value: next, locale })
    if (next !== value) onChange(next)
  }

  function choose(next: string) {
    commit(next)
    setText(formatValue(kind, next, locale))
    setProblem(null)
  }

  function typed(event: ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value
    setText(raw)
    setProblem(null)
    const parsed = parseValue(kind, raw, locale)
    commit(parsed !== undefined && rangeProblem(parsed) === null ? parsed : "")
  }

  function left() {
    if (text.trim() !== "") {
      const parsed = parseValue(kind, text, locale)
      if (parsed === undefined) setProblem("format")
      else if (rangeProblem(parsed) !== null) setProblem(rangeProblem(parsed))
      else setText(formatValue(kind, parsed, locale))
    }
    onBlur?.()
  }

  function pickDay(day: Date, closeAfter: boolean) {
    const date = isoDate(day)
    choose(kind === "date" ? date : `${date}T${timeOf(value) ?? parseTime(plainSpaces(timeText).trim()) ?? nowTime()}`)
    if (kind === "datetime" && timeText === "") {
      setTimeText(formatTime(timeOf(value) ?? nowTime(), locale))
    }
    if (closeAfter) setOpen(false)
  }

  function typedTime(event: ChangeEvent<HTMLInputElement>) {
    setTimeText(event.target.value)
    const time = parseTime(plainSpaces(event.target.value).trim())
    if (time === undefined) return
    choose(`${value.slice(0, 10) || isoDate(new Date())}T${time}`)
  }

  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const outside = (day: Date) => {
    const iso = isoDate(day)
    return (minDay !== undefined && minDay !== "" && iso < minDay) ||
      (maxDay !== undefined && maxDay !== "" && iso > maxDay)
  }
  const selected = dateFromIso(value)
  const example =
    kind === "date"
      ? formatDay(isoDate(today), locale)
      : `${formatDay(isoDate(today), locale)} ${formatTime("14:30", locale)}`
  const problemText =
    problem === "format"
      ? t(kind === "date" ? "dateField.invalidDate" : "dateField.invalidDateTime", { example })
      : problem === "early"
        ? t("dateField.tooEarly", { min: formatValue(kind, min ?? "", locale) })
        : problem === "late"
          ? t("dateField.tooLate", { max: formatValue(kind, max ?? "", locale) })
          : null
  const describedBy = [aria["aria-describedby"], problemText === null ? undefined : problemId]
    .filter((part) => part !== undefined && part.trim() !== "")
    .join(" ")

  return (
    <div className={cn("flex w-full flex-col gap-1", className)}>
      <div className="relative w-full">
        <Input
          ref={ref}
          id={id}
          name={name}
          value={text}
          disabled={disabled}
          autoComplete="off"
          placeholder={
            placeholder ?? t(kind === "date" ? "dateField.placeholderDate" : "dateField.placeholderDateTime")
          }
          aria-label={aria["aria-label"]}
          aria-describedby={describedBy === "" ? undefined : describedBy}
          aria-invalid={aria["aria-invalid"] === true || problem !== null}
          className="min-h-11 pr-12"
          onChange={typed}
          onBlur={left}
        />
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next)
            if (next) setTimeText(timeOf(value) === undefined ? "" : formatTime(timeOf(value) ?? "", locale))
          }}
        >
          <PopoverTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                disabled={disabled}
                aria-label={t("dateField.openCalendar")}
                className="absolute inset-y-0 right-0 h-11 w-11 rounded-s-none text-muted-foreground"
              />
            }
          >
            <CalendarDays className="size-4" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto gap-0 p-0">
            <div className="flex gap-2 p-3 pb-0">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1"
                disabled={outside(today)}
                onClick={() => pickDay(today, kind === "date")}
              >
                {t("dateField.today")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11 flex-1"
                disabled={outside(yesterday)}
                onClick={() => pickDay(yesterday, kind === "date")}
              >
                {t("dateField.yesterday")}
              </Button>
            </div>
            <Calendar
              mode="single"
              locale={calendarLocale}
              disabled={outside}
              {...(selected === undefined ? {} : { selected })}
              onSelect={(day) => pickDay(day, kind === "date")}
            />
            {kind === "datetime" && (
              <div className="flex items-end gap-2 border-t p-3">
                <div className="flex flex-1 flex-col gap-1">
                  <Label htmlFor={timeId}>{t("dateField.time")}</Label>
                  <Input
                    id={timeId}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={formatTime("14:30", locale)}
                    value={timeText}
                    className="min-h-11"
                    onChange={typedTime}
                    onBlur={() => {
                      const time = parseTime(plainSpaces(timeText).trim())
                      if (time !== undefined) setTimeText(formatTime(time, locale))
                    }}
                  />
                </div>
                <Button type="button" className="min-h-11" onClick={() => setOpen(false)}>
                  {t("dateField.done")}
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {problemText !== null && (
        <p id={problemId} className="text-xs text-destructive">
          {problemText}
        </p>
      )}
    </div>
  )
}

/**
 * A calendar day: typed in the reader's own format or picked from a calendar
 * with Today and Yesterday, never the browser's native date input, which shows
 * US formats on French phones. The value is an ISO date both ways.
 */
function DateField(props: DateFieldProps) {
  return <DateCalendarField kind="date" {...props} />
}

/** A day and a time of day, as `YYYY-MM-DDTHH:mm` on the operator's own clock. */
function DateTimeField(props: DateFieldProps) {
  return <DateCalendarField kind="datetime" {...props} />
}

export { DateField, DateTimeField }
