import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { MoneyInput } from "@/components/money-input.js"
import { FileUpload } from "@/components/ui/file-upload"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { moneyAmountParts, parseWholeAmount } from "@/lib/format.js"
import { cn } from "@/lib/utils"
import { FieldFrame, useKitField, type KitFieldProps } from "./field.js"
import { kitField, useFormLayout } from "./form-layout.js"
import { SearchControl, type SearchOption } from "./search-field.js"

/** Empty text is no value: an optional field left blank is left out of the payload. */
const textValue = (text: string) => (text === "" ? undefined : text)

/**
 * A whole number as typed, in the reader's grouping: the number, nothing when
 * empty, or NaN for text that is not one, which the schema refuses.
 */
function wholeValue(text: string): number | undefined {
  const parsed = parseWholeAmount(text)
  if (parsed.kind === "empty") return undefined
  return parsed.kind === "amount" ? parsed.minor : Number.NaN
}

/**
 * Keeps a field's text while the form holds a parsed value: what was typed
 * stays as typed, and a value set from outside (a reset) is shown afresh.
 */
function useTypedText(value: unknown, show: (value: unknown) => string) {
  const [text, setText] = useState(() => show(value))
  const [held, setHeld] = useState<unknown>(value)
  if (!Object.is(held, value)) {
    setHeld(value)
    setText(show(value))
  }
  return {
    text,
    type(next: string, parsed: unknown) {
      setText(next)
      setHeld(parsed)
    },
  }
}

export interface TextFieldProps extends KitFieldProps {
  maxLength?: number | undefined
  autoComplete?: string | undefined
}

/** One line of text: a description, a station, a code. */
export const TextField = kitField(function TextField({
  name,
  label,
  help,
  placeholder,
  disabled,
  maxLength,
  autoComplete,
}: TextFieldProps) {
  const { field, frame, describedBy, required, error } = useKitField(name, help)
  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <Input
        id={frame.id}
        ref={field.ref}
        name={field.name}
        value={typeof field.value === "string" ? field.value : ""}
        onChange={(event) => field.onChange(textValue(event.target.value))}
        onBlur={field.onBlur}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        autoComplete={autoComplete}
        aria-required={required || undefined}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
      />
    </FieldFrame>
  )
}, "text")

/** Several lines: a note, what was done, a reason. */
export const NoteField = kitField(function NoteField({
  name,
  label,
  help,
  placeholder,
  disabled,
  maxLength,
}: TextFieldProps) {
  const { field, frame, describedBy, required, error } = useKitField(name, help)
  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <Textarea
        id={frame.id}
        ref={field.ref}
        name={field.name}
        rows={4}
        value={typeof field.value === "string" ? field.value : ""}
        onChange={(event) => field.onChange(textValue(event.target.value))}
        onBlur={field.onBlur}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-required={required || undefined}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
      />
    </FieldFrame>
  )
}, "note")

export interface MoneyFieldProps extends KitFieldProps {
  /** The form's main amount: 48 px tall on a phone. */
  main?: boolean | undefined
}

/**
 * An XAF amount in whole francs (exponent 0): the form holds minor units, the
 * field shows them grouped the reader's way with the currency as a suffix, and
 * a phone opens its number pad.
 */
export const MoneyField = kitField(function MoneyField({
  name,
  label,
  help,
  placeholder,
  disabled,
  main = false,
}: MoneyFieldProps) {
  const { field, frame, describedBy, required, error } = useKitField(name, help)
  const { text, type } = useTypedText(field.value, (value) =>
    typeof value === "number" && Number.isFinite(value) ? moneyAmountParts(value).amount : "",
  )
  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <MoneyInput
        id={frame.id}
        ref={field.ref}
        name={field.name}
        value={text}
        onValueChange={(next) => {
          const parsed = wholeValue(next)
          type(next, parsed)
          field.onChange(parsed)
        }}
        onBlur={field.onBlur}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        className={cn(main && "h-12 text-lg desktop:h-11 desktop:text-sm")}
      />
    </FieldFrame>
  )
}, "money")

export interface QuantityFieldProps extends KitFieldProps {
  /** The unit, already in the reader's words: "L", "km". */
  unit: string
}

function QuantityInput({ name, label, help, placeholder, disabled, unit }: QuantityFieldProps) {
  const { field, frame, describedBy, required, error } = useKitField(name, help)
  const { text, type } = useTypedText(field.value, (value) =>
    typeof value === "number" && Number.isFinite(value) ? String(value) : "",
  )
  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <div className="relative">
        <Input
          id={frame.id}
          ref={field.ref}
          name={field.name}
          inputMode="numeric"
          autoComplete="off"
          value={text}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d\s.,]/g, "")
            const parsed = wholeValue(next)
            type(next, parsed)
            field.onChange(parsed)
          }}
          onBlur={field.onBlur}
          placeholder={placeholder}
          disabled={disabled}
          aria-required={required || undefined}
          aria-invalid={error !== undefined}
          aria-describedby={describedBy}
          className="pr-12 tabular-nums"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-muted-foreground"
        >
          {unit}
        </span>
      </div>
    </FieldFrame>
  )
}

/** A whole quantity with its unit as a suffix: litres, kilometres. */
export const QuantityField = kitField(function QuantityField(props: QuantityFieldProps) {
  return <QuantityInput {...props} />
}, "quantity")

export interface ReadingFieldProps extends KitFieldProps {
  readingType: "ODOMETER" | "HOURS"
  /** The vehicle's last reading, shown as the help so a typo stands out. */
  last?: number | undefined
}

/** A meter reading: the unit as a suffix and the last reading under it. */
export const ReadingField = kitField(function ReadingField({ readingType, last, help, ...props }: ReadingFieldProps) {
  const { t } = useTranslation()
  const lastHint = last === undefined ? undefined : t("form.reading.last", { readingType, value: last })
  return (
    <QuantityInput
      {...props}
      unit={t(readingType === "HOURS" ? "form.units.hours" : "form.units.km")}
      help={help ?? lastHint}
    />
  )
}, "reading")

export interface ChoiceOption {
  value: string
  label: string
}

export interface ChoiceFieldProps extends KitFieldProps {
  options: readonly ChoiceOption[]
}

/**
 * One answer from a fixed list. Two to four options are a segmented row, five
 * to twelve a select, more a search.
 */
export const ChoiceField = kitField(function ChoiceField({
  name,
  label,
  help,
  placeholder,
  disabled,
  options,
}: ChoiceFieldProps) {
  const { field, frame, describedBy, required, error } = useKitField(name, help)
  const value = typeof field.value === "string" ? field.value : undefined

  if (options.length <= 4) {
    return (
      <FieldFrame label={label} help={help} frame={frame} group>
        <div
          data-slot="choice-segmented"
          className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-lg border border-input"
        >
          {options.map((option, index) => (
            <label
              key={option.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center px-3 text-center text-sm transition-colors not-first:border-l not-first:border-input",
                "has-checked:bg-primary has-checked:font-medium has-checked:text-primary-foreground",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-focus-visible:ring-inset",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              <input
                type="radio"
                className="sr-only"
                id={index === 0 ? frame.id : undefined}
                ref={index === 0 ? field.ref : undefined}
                name={field.name}
                value={option.value}
                checked={value === option.value}
                disabled={disabled}
                onChange={() => field.onChange(option.value)}
                onBlur={field.onBlur}
                aria-required={required || undefined}
                aria-invalid={error !== undefined}
                aria-describedby={describedBy}
              />
              {option.label}
            </label>
          ))}
        </div>
      </FieldFrame>
    )
  }

  if (options.length <= 12) {
    return (
      <FieldFrame label={label} help={help} frame={frame}>
        <Select
          value={value ?? null}
          disabled={disabled}
          onValueChange={(next) => field.onChange((next as string | null) ?? undefined)}
          items={options}
        >
          <SelectTrigger
            id={frame.id}
            ref={field.ref}
            className="w-full"
            onBlur={field.onBlur}
            aria-required={required || undefined}
            aria-invalid={error !== undefined}
            aria-describedby={describedBy}
          >
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldFrame>
    )
  }

  return (
    <FieldFrame label={label} help={help} frame={frame}>
      <SearchControl
        id={frame.id}
        triggerRef={field.ref}
        options={options as readonly SearchOption[]}
        value={value}
        onChange={field.onChange}
        onBlur={field.onBlur}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        invalid={error !== undefined}
        describedBy={describedBy}
      />
    </FieldFrame>
  )
}, "choice")

export interface FileFieldProps extends KitFieldProps {
  /** A photo of a receipt or a meter: the camera opens first on a phone. */
  camera?: boolean | undefined
  accept?: string | undefined
}

/**
 * Proof: photos or documents, uploaded as they are chosen. The form holds the
 * stored files' ids and cannot be sent while one is still uploading.
 */
export const FileField = kitField(function FileField({
  name,
  label,
  help,
  camera = false,
  accept,
}: FileFieldProps) {
  const { field, frame } = useKitField(name, help)
  const layout = useFormLayout()
  const setBusy = layout?.setBusy
  useEffect(() => () => setBusy?.(name, false), [setBusy, name])
  return (
    <FieldFrame label={label} help={help} frame={frame} group>
      <FileUpload
        camera={camera}
        accept={accept ?? (camera ? "image/*" : undefined)}
        onChange={(ids) => field.onChange(ids)}
        onUploadingChange={(uploading) => setBusy?.(name, uploading)}
      />
    </FieldFrame>
  )
}, "file")
