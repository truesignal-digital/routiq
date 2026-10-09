import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react"
import { ChevronDown } from "lucide-react"
import { useTranslation } from "react-i18next"
import { get, useFormState, useWatch, type FieldValues, type Path } from "react-hook-form"
import type { z } from "zod"

import {
  CommandForm,
  type CommandFormBack,
  type CommandFormCopy,
  type FormLayoutKind,
} from "@/components/command-form.js"
import type { CommandLabelRef } from "@/commands/labels.js"
import { Form } from "@/components/ui/form"
import type { CommandFormState } from "@/components/use-command-form.js"
import { cn } from "@/lib/utils"
import { isRequired } from "./schema-fields.js"

export type { FormLayoutKind } from "@/components/command-form.js"

/** What a field-kit field asks for, as `FormPair` and the limits read it. */
export type FieldKind =
  | "text"
  | "note"
  | "money"
  | "date"
  | "datetime"
  | "choice"
  | "person"
  | "vehicle"
  | "file"
  | "reading"
  | "quantity"

/** A field-kit component: it carries its kind so a layout can count and pair it before rendering. */
export type KitFieldComponent<P> = ComponentType<P> & { fieldKind: FieldKind }

export function kitField<P>(component: ComponentType<P>, kind: FieldKind): KitFieldComponent<P> {
  return Object.assign(component, { fieldKind: kind })
}

interface FieldEntry {
  name: string
  kind: FieldKind
  label: string
}

const kindOf = (type: unknown): FieldKind | undefined =>
  typeof type === "function" || typeof type === "object"
    ? (type as { fieldKind?: FieldKind } | null)?.fieldKind
    : undefined

/** The kit fields a form writes, in order, read from its JSX before it renders. */
export function fieldsIn(children: ReactNode): FieldEntry[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return []
    const props = child.props as { name?: unknown; label?: unknown; children?: ReactNode }
    const kind = kindOf(child.type)
    if (kind !== undefined) {
      return [{ name: String(props.name), kind, label: typeof props.label === "string" ? props.label : "" }]
    }
    return fieldsIn(props.children)
  })
}

function groupsIn(children: ReactNode): number {
  return Children.toArray(children).reduce<number>((count, child) => {
    if (!isValidElement(child)) return count
    if (child.type === FormGroup) return count + 1
    return count + groupsIn((child.props as { children?: ReactNode }).children)
  }, 0)
}

/** The size rules each layout holds a form to (form-layouts.html, "Pick a layout"). */
export const LAYOUT_LIMITS: Readonly<Record<FormLayoutKind, { fields?: number; groups?: number }>> = {
  "quick-entry": { fields: 6 },
  record: { fields: 14, groups: 4 },
  "line-items": {},
  decision: { fields: 1 },
  "long-capture": {},
  "edit-in-place": {},
}

function checkLimits(kind: FormLayoutKind, fields: number, groups: number) {
  const limit = LAYOUT_LIMITS[kind]
  if (limit.fields !== undefined && fields > limit.fields) {
    throw new Error(
      `FormLayout "${kind}" holds at most ${limit.fields} fields; this form has ${fields}. Pick another layout (docs/design/consistency/form-layouts.html).`,
    )
  }
  if (limit.groups !== undefined && groups > limit.groups) {
    throw new Error(
      `FormLayout "${kind}" holds at most ${limit.groups} groups; this form has ${groups}. More is a Long capture (docs/design/consistency/form-layouts.html).`,
    )
  }
}

interface LayoutContextValue {
  kind: FormLayoutKind
  schema: z.ZodType
  fieldCount: number
  setBusy: (name: string, busy: boolean) => void
}

const LayoutContext = createContext<LayoutContextValue | undefined>(undefined)

export function useFormLayout(): LayoutContextValue | undefined {
  return useContext(LayoutContext)
}

/** Whether a kit field must be filled, read from the form's schema. */
export function useFieldRequired(name: string): boolean {
  const layout = useContext(LayoutContext)
  return layout === undefined ? false : isRequired(layout.schema, name)
}

const isEmpty = (value: unknown) =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0)

type PanelSurface = "sheet" | "panel"

export interface FormLayoutProps<Values extends FieldValues, Payload> {
  kind: FormLayoutKind
  form: CommandFormState<Values, Payload>
  /** The action as a verb phrase: the same words as the button that opened the form. */
  title: ReactNode
  description?: ReactNode | undefined
  /** What happens after submit, left of the buttons. */
  hint?: ReactNode | undefined
  /** What the page already knows (the vehicle, the record decided on): shown, never asked. */
  pinned?: ReactNode | undefined
  /** Panel layouts: `panel` inside a record panel that already holds the sheet. */
  surface?: PanelSurface | undefined
  back?: CommandFormBack | undefined
  /** Overrides the hook's command, e.g. a named job (`{ command, intent }`). */
  command?: CommandLabelRef | undefined
  /** Narrows the hook's readiness; uploads in a FileField already hold the submit. */
  ready?: boolean | undefined
  cancelLabel?: string | undefined
  tone?: "default" | "destructive" | undefined
  informativeCodes?: readonly string[] | undefined
  conflict?: CommandFormCopy | undefined
  approval?: CommandFormCopy | undefined
  onReload?: (() => void | Promise<void>) | undefined
  children: ReactNode
}

const SURFACE_OF_KIND = {
  "quick-entry": "sheet",
  record: "sheet",
  "line-items": "sheet",
  decision: "dialog",
  "long-capture": "page",
  "edit-in-place": "page",
} as const

/**
 * A form is a layout name plus its fields. The layout owns the surface, width,
 * header, pinned block, error summary, footer and every gap; a form file holds
 * `FormGroup` / `FormPair` / `FormOptional` and field-kit fields, nothing else.
 * On open, focus goes to the first empty required field.
 */
export function FormLayout<Values extends FieldValues, Payload>({
  kind,
  form,
  title,
  description,
  hint,
  pinned,
  surface,
  back,
  command,
  ready,
  cancelLabel,
  tone,
  informativeCodes,
  conflict,
  approval,
  onReload,
  children,
}: FormLayoutProps<Values, Payload>) {
  const fields = fieldsIn(children)
  const groups = groupsIn(children)
  if (import.meta.env.DEV) checkLimits(kind, fields.length, groups)

  const [busy, setBusyNames] = useState<ReadonlySet<string>>(new Set())
  const setBusy = useCallback((name: string, isBusy: boolean) => {
    setBusyNames((current) => {
      if (current.has(name) === isBusy) return current
      const next = new Set(current)
      if (isBusy) next.add(name)
      else next.delete(name)
      return next
    })
  }, [])

  const { schema } = form
  const context = useMemo<LayoutContextValue>(
    () => ({ kind, schema: schema as z.ZodType, fieldCount: fields.length, setBusy }),
    [kind, schema, fields.length, setBusy],
  )

  // Focus waits a tick: the sheet or dialog moves focus into itself first.
  const firstEmptyRequired = fields.find(
    (field) => isRequired(schema as z.ZodType, field.name) && isEmpty(form.form.getValues(field.name as Path<Values>)),
  )?.name
  const focusTarget = useRef(firstEmptyRequired)
  useEffect(() => {
    const name = focusTarget.current
    if (name === undefined) return
    const timer = setTimeout(() => form.form.setFocus(name as Path<Values>), 50)
    return () => clearTimeout(timer)
  }, [form.form])

  const chosenSurface = SURFACE_OF_KIND[kind] === "sheet" ? (surface ?? "sheet") : SURFACE_OF_KIND[kind]
  const { formProps } = form
  const shared = {
    ...formProps,
    kind,
    hint,
    description,
    back,
    cancelLabel,
    tone,
    informativeCodes,
    conflict,
    approval,
    onReload,
    command: command ?? formProps.command,
    ready: formProps.ready && (ready ?? true) && busy.size === 0,
  }

  const body = (
    <LayoutContext.Provider value={context}>
      <div
        data-slot="form-layout"
        data-kind={kind}
        className={cn(
          "flex flex-col",
          groups > 0 ? "gap-6" : "gap-4",
          kind === "edit-in-place" && groups === 0 && "grid gap-4 sm:grid-cols-2",
        )}
      >
        {pinned !== undefined && pinned !== null && <div data-slot="form-pinned">{pinned}</div>}
        {children}
      </div>
    </LayoutContext.Provider>
  )

  return (
    <Form {...form.form}>
      {chosenSurface === "page" ? (
        <CommandForm
          {...shared}
          surface="page"
          title={title}
          className={
            kind === "long-capture" ? "mx-auto w-full max-w-[760px] border-0 bg-transparent p-0" : undefined
          }
        >
          {body}
        </CommandForm>
      ) : (
        <CommandForm
          {...shared}
          surface={chosenSurface}
          title={title}
          width={kind === "line-items" ? "line-items" : undefined}
        >
          {body}
        </CommandForm>
      )}
    </Form>
  )
}

/**
 * Fields that belong together, under a plain heading ("How much", "When").
 * Order: what, how much, when, proof, more details. A form of three fields or
 * fewer shows no headings.
 */
export function FormGroup({ title, children }: { title: string; children: ReactNode }) {
  const layout = useContext(LayoutContext)
  const headingId = useId()
  const kind = layout?.kind
  const showHeading = (layout?.fieldCount ?? 0) > 3
  const fields = (
    <div
      className={cn(
        "flex flex-col gap-4",
        kind === "long-capture" && "grid md:grid-cols-2",
        kind === "edit-in-place" && "grid sm:grid-cols-2",
      )}
    >
      {children}
    </div>
  )
  return (
    <section
      data-slot="form-group"
      aria-labelledby={showHeading ? headingId : undefined}
      className={cn(kind === "long-capture" && "rounded-xl border border-border bg-card p-4")}
    >
      {showHeading && (
        <h3 id={headingId} className="mb-3 text-[13px] font-semibold">
          {title}
        </h3>
      )}
      {fields}
    </section>
  )
}

/**
 * The only pairs of fields that share a row, by the kinds of their two fields
 * (form-layouts.html, "Which fields share a row"). Date + time is one
 * `DateTimeField`, so it needs no pair.
 */
export const FORM_PAIRS = {
  "amount-date": [["money"], ["date", "datetime"]],
  "from-to": [["text", "person", "vehicle"], ["text", "person", "vehicle"]],
  "quantity-unit-price": [["quantity"], ["money"]],
  "amount-litres": [["money"], ["quantity"]],
  "assignee-cost": [["person"], ["money"]],
  "code-name": [["text"], ["text"]],
  "issued-expires": [["date"], ["date"]],
  "pin-confirm": [["text"], ["text"]],
} as const satisfies Record<string, readonly [readonly FieldKind[], readonly FieldKind[]]>

export type FormPairName = keyof typeof FORM_PAIRS

/** These stay side by side on a phone narrower than 400 px; every other pair stacks. */
const PAIRS_THAT_NEVER_STACK: ReadonlySet<FormPairName> = new Set(["code-name"])

function checkPair(pair: FormPairName, children: ReactNode) {
  const kinds = fieldsIn(children).map((field) => field.kind)
  const allowed = (FORM_PAIRS as Record<string, readonly (readonly FieldKind[])[]>)[pair]
  const fits =
    allowed !== undefined &&
    kinds.length === 2 &&
    kinds.every((kind, index) => (allowed[index] ?? []).includes(kind))
  if (!fits) {
    throw new Error(
      `FormPair "${String(pair)}" does not fit [${kinds.join(", ")}]. Only the pairs in FORM_PAIRS share a row (docs/design/consistency/form-layouts.html).`,
    )
  }
}

/** Two fields on one row, only for a pair on the allowed list. */
export function FormPair({ pair, children }: { pair: FormPairName; children: ReactNode }) {
  if (import.meta.env.DEV) checkPair(pair, children)
  return (
    <div
      data-slot="form-pair"
      data-pair={pair}
      className={cn(
        "grid items-start gap-3 md:col-span-2",
        PAIRS_THAT_NEVER_STACK.has(pair) ? "grid-cols-2" : "grid-cols-1 min-[400px]:grid-cols-2",
      )}
    >
      {children}
    </div>
  )
}

/**
 * Every optional field of the form, folded last, with how many are filled. It
 * opens by itself when one of them is filled or invalid.
 */
export function FormOptional({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const fields = fieldsIn(children)
  const names = fields.map((field) => field.name)
  const values = useWatch({ name: names }) as unknown[]
  const { errors } = useFormState({ name: names })
  const filled = values.filter((value) => !isEmpty(value)).length
  const invalid = names.some((name) => get(errors, name) !== undefined)
  const [open, setOpen] = useState(() => filled > 0)
  useEffect(() => {
    if (invalid) setOpen(true)
  }, [invalid])

  const labels = new Intl.ListFormat(i18n.resolvedLanguage, { style: "short", type: "unit" }).format(
    fields.map((field) => field.label).filter((label) => label !== ""),
  )

  return (
    <section data-slot="form-optional" className="flex flex-col gap-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border px-3 py-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[13px] font-semibold">{t("form.optional.title")}</span>
          <span className="truncate text-xs text-muted-foreground">{labels}</span>
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {t("form.optional.filled", { filled, total: fields.length })}
        </span>
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      <div id={id} hidden={!open} className="flex flex-col gap-4">
        {children}
      </div>
    </section>
  )
}
