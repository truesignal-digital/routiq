import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { ArrowLeft } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ErrorBanner } from "@/components/error-banner.js"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetTitle,
} from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { errorMessage } from "@/lib/error-message.js"
import { useCommandLabel, type CommandLabelRef } from "@/commands/labels.js"
import { cn } from "@/lib/utils"

/**
 * Where a command form is hosted. `dialog` and `sheet` own their overlay;
 * `panel` renders inside an overlay the host already holds (a record panel's
 * page stack), so the host decides what closing means; `page` sits in the flow
 * of a screen.
 */
export type CommandSurface = "dialog" | "sheet" | "panel" | "page"

/** The record a panel form was opened from: the back arrow returns to it. */
export interface CommandFormBack {
  label: string
  onBack: () => void
}

export interface CommandFormCopy {
  title: string
  body: string
}

type CommandFormChrome =
  | { surface: "page"; title?: ReactNode }
  | { surface: "dialog" | "sheet" | "panel"; title: ReactNode }

export type CommandFormProps = CommandFormChrome & {
  description?: string | undefined
  /** Sheet only: repeating rows (cost lines) take the 560 px Line items width. */
  width?: FormPanelWidth | undefined
  /** Panel only: the record this form belongs to. */
  back?: CommandFormBack | undefined
  /**
   * The last submit's error code. VERSION_CONFLICT and APPROVAL_REQUIRED
   * replace the form, because both are answers the operator has to read before
   * anything else; every other code is a banner above the untouched fields.
   */
  error?: string | undefined
  /** Codes that are information rather than failure, shown as a note. */
  informativeCodes?: readonly string[] | undefined
  /** Wording for the two replacing states, when the generic one is too vague. */
  conflict?: CommandFormCopy | undefined
  approval?: CommandFormCopy | undefined
  /** What "Refresh" does after a conflict. Defaults to dismissing the form. */
  onReload?: (() => void | Promise<void>) | undefined
  /**
   * The command this form sends. Its submit, pending and dismiss words come
   * from `commands.<name>` in the catalog, the same words every menu uses.
   */
  command: CommandLabelRef
  /** Refusals and cancellations: the submit takes the destructive variant. */
  tone?: "default" | "destructive" | undefined
  /** When dismissing means something other than going back, e.g. "Close" once part of the work is saved. */
  cancelLabel?: string | undefined
  /** A page form with nowhere to go back to has no cancel button. */
  hideCancel?: boolean | undefined
  ready: boolean
  submitting: boolean
  onSubmit: () => void
  onDismiss: () => void
  className?: string | undefined
  children: ReactNode
}

type Outcome = "form" | "conflict" | "approval"

function outcomeOf(error: string | undefined): Outcome {
  if (error === "VERSION_CONFLICT") return "conflict"
  if (error === "APPROVAL_REQUIRED") return "approval"
  return "form"
}

/**
 * One command form, rendered the same way on every surface: header, body,
 * footer, the error banner, and the two outcomes that replace the form. Each
 * form supplies only its fields and its submit.
 */
export function CommandForm(props: CommandFormProps) {
  const { surface, onDismiss } = props

  if (surface === "dialog") {
    return (
      <Dialog open onOpenChange={(open) => !open && onDismiss()}>
        <DialogContent className={props.className}>
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            {props.description !== undefined && (
              <DialogDescription>{props.description}</DialogDescription>
            )}
          </DialogHeader>
          <CommandFormBody {...props} />
        </DialogContent>
      </Dialog>
    )
  }

  if (surface === "sheet") {
    return <CommandFormSheet {...props} />
  }

  if (surface === "panel") {
    return <CommandFormPanel {...props} />
  }

  return <CommandFormBody {...props} />
}

function CommandFormSheet(props: CommandFormProps) {
  return (
    <FormPanel onClose={props.onDismiss} width={props.width} className={props.className}>
      <CommandFormPanel {...props} />
    </FormPanel>
  )
}

export type FormPanelWidth = "record" | "line-items"

/**
 * The side panel's frame: a right sheet on desktop (440 px, 560 for Line
 * items), a bottom sheet on phone. Shared by every surface that hosts a form
 * in a sheet, so they all have one width and one close rule.
 */
export function formPanelClassName(
  isMobile: boolean,
  width: FormPanelWidth = "record",
): string {
  return cn(
    "gap-0 overflow-y-auto",
    isMobile
      ? "h-[92dvh] max-h-[92dvh] rounded-t-xl"
      : width === "line-items"
        ? "data-[side=right]:w-full data-[side=right]:sm:max-w-[560px]"
        : "data-[side=right]:w-full data-[side=right]:sm:max-w-[440px]",
  )
}

interface DiscardGuard {
  markTyped: () => void
  clear: () => void
  /** Runs `leave` now, or once the operator agrees to lose what they typed. */
  confirm: (leave: () => void) => void
}

const DiscardGuardContext = createContext<DiscardGuard | undefined>(undefined)

/**
 * Closing a form with typed data asks first. The host owning the sheet holds
 * the guard; the form marks it on any input and asks it before Cancel.
 */
export function useDiscardGuard() {
  const typed = useRef(false)
  const [leaving, setLeaving] = useState<(() => void) | undefined>()
  const guard = useMemo<DiscardGuard>(
    () => ({
      markTyped: () => {
        typed.current = true
      },
      clear: () => {
        typed.current = false
      },
      confirm: (leave) => {
        if (typed.current) setLeaving(() => leave)
        else leave()
      },
    }),
    [],
  )
  const dialog =
    leaving === undefined ? null : (
      <DiscardDialog
        onKeep={() => setLeaving(undefined)}
        onDiscard={() => {
          typed.current = false
          setLeaving(undefined)
          leaving()
        }}
      />
    )
  return { guard, dialog }
}

/** Wraps a sheet's content so the forms inside it report typing to the guard. */
export function DiscardGuardScope({
  guard,
  children,
}: {
  guard: DiscardGuard
  children: ReactNode
}) {
  return (
    <DiscardGuardContext.Provider value={guard}>
      <div className="contents" onInput={guard.markTyped}>
        {children}
      </div>
    </DiscardGuardContext.Provider>
  )
}

/** Cancel inside a guarded sheet asks before it drops typed data. */
export function useGuardedDismiss(onDismiss: () => void): () => void {
  const guard = useContext(DiscardGuardContext)
  return () => (guard === undefined ? onDismiss() : guard.confirm(onDismiss))
}

/**
 * The Decision dialog every guarded close asks: the dismiss button keeps the
 * form, the destructive one repeats its verb.
 */
function DiscardDialog({
  onKeep,
  onDiscard,
}: {
  onKeep: () => void
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open onOpenChange={(open) => !open && onKeep()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("commandForm.discardTitle")}</DialogTitle>
          <DialogDescription>{t("commandForm.discardBody")}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row justify-end">
          <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={onKeep}>
            {t("commandForm.keepEditing")}
          </Button>
          <Button type="button" variant="destructive" className="flex-1 sm:flex-none" onClick={onDiscard}>
            {t("commandForm.discard")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * A form in the side panel, for forms that render their own fields and
 * footer. `onClose` runs when the operator closes the sheet (×, Escape, the
 * backdrop), after the discard question when something was typed.
 */
export function FormPanel({
  open = true,
  onClose,
  width,
  className,
  children,
}: {
  open?: boolean | undefined
  onClose: () => void
  width?: FormPanelWidth | undefined
  className?: string | undefined
  children: ReactNode
}) {
  const isMobile = useIsMobile()
  const { guard, dialog } = useDiscardGuard()

  // Each opening starts clean: what was typed last time is gone.
  useEffect(() => {
    if (open) guard.clear()
  }, [open, guard])

  return (
    <Sheet open={open} onOpenChange={(next) => !next && guard.confirm(onClose)}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(formPanelClassName(isMobile, width), className)}
      >
        <DiscardGuardScope guard={guard}>{children}</DiscardGuardScope>
        {dialog}
      </SheetContent>
    </Sheet>
  )
}

/** The header every panel form opens with: verb title, one-line description. */
export function FormPanelHeader({
  title,
  description,
}: {
  title: ReactNode
  description?: ReactNode | undefined
}) {
  return (
    <div className="border-b px-4 pt-3 pb-4 pr-12">
      <SheetTitle className="text-lg leading-snug font-semibold">{title}</SheetTitle>
      {description !== undefined && (
        <SheetDescription className="mt-1">{description}</SheetDescription>
      )}
    </div>
  )
}

/** Cancel in a panel form's footer: asks before it drops typed data. */
export function FormPanelCancel({
  onDismiss,
  children,
}: {
  onDismiss: () => void
  children: ReactNode
}) {
  const dismiss = useGuardedDismiss(onDismiss)
  return (
    <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={dismiss}>
      {children}
    </Button>
  )
}

/** The panel's sticky footer: cancel, then submit last. */
export function FormPanelFooter({ children }: { children: ReactNode }) {
  return (
    <SheetFooter className="sticky bottom-0 z-20 flex-row justify-end gap-2 border-t bg-popover">
      {children}
    </SheetFooter>
  )
}

/** The panel page: a header with the way back, then the body and a sticky footer. */
function CommandFormPanel(props: CommandFormProps) {
  const { t } = useTranslation()

  return (
    <>
      <div className="border-b px-4 pt-3 pb-4 pr-12">
        {props.back !== undefined && (
          <button
            type="button"
            onClick={props.back.onBack}
            aria-label={t("commandForm.backTo", { record: props.back.label })}
            className="mb-3 flex max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4 shrink-0" aria-hidden />
            <span className="truncate font-medium">{props.back.label}</span>
          </button>
        )}
        <SheetTitle className="text-lg leading-snug font-semibold">
          {props.title}
        </SheetTitle>
        {props.description !== undefined && (
          <SheetDescription className="mt-1">{props.description}</SheetDescription>
        )}
      </div>
      <CommandFormBody {...props} />
    </>
  )
}

/** The part every surface shares: the form, or the outcome that replaced it. */
function CommandFormBody(props: CommandFormProps) {
  const { t, i18n } = useTranslation()
  const label = useCommandLabel()
  const formId = useId()
  const { surface, error, ready, submitting, onSubmit, onDismiss } = props
  const outcome = outcomeOf(error)
  const guard = useContext(DiscardGuardContext)
  const dismiss = useGuardedDismiss(onDismiss)
  // A record panel keeps its guard after this form goes back to the record.
  useEffect(() => () => guard?.clear(), [guard])
  // A dialog or a sheet takes the class on its overlay; a page or a panel
  // page has only the form to put it on.
  const bodyClassName =
    surface === "page" || surface === "panel" ? props.className : undefined

  if (outcome !== "form") {
    const copy =
      outcome === "conflict"
        ? (props.conflict ?? {
            title: t("commandForm.conflictTitle"),
            body: t("commandForm.conflictBody"),
          })
        : (props.approval ?? {
            title: t("commandForm.approvalTitle"),
            body: t("commandForm.approvalBody"),
          })
    const reload = async () => {
      if (props.onReload === undefined) onDismiss()
      else await props.onReload()
    }

    return (
      <div className={cn(surfaceBodyClass(surface), bodyClassName)}>
        <div className={cn(surface === "panel" || surface === "sheet" ? "p-4" : undefined)}>
          <div
            role={outcome === "conflict" ? "alert" : "status"}
            className={cn(
              "rounded-lg px-3 py-2 text-sm",
              outcome === "conflict"
                ? "bg-warning/10 text-warning-foreground"
                : "bg-info/10 text-info-foreground",
            )}
          >
            <p className="font-semibold">{copy.title}</p>
            <p className="mt-1">{copy.body}</p>
          </div>
        </div>
        <Footer surface={surface}>
          {outcome === "conflict" ? (
            <Button
              type="button"
              className="flex-1 sm:flex-none"
              onClick={() => void reload()}
            >
              {t("commandForm.reload")}
            </Button>
          ) : (
            <Button
              type="button"
              className="flex-1 sm:flex-none"
              onClick={onDismiss}
            >
              {t("commandForm.close")}
            </Button>
          )}
        </Footer>
      </div>
    )
  }

  const informative =
    error !== undefined && (props.informativeCodes ?? []).includes(error)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!ready || submitting) return
    onSubmit()
  }

  // On a page the submit spans the column; in an overlay it sits in the footer.
  const submit = (
    <Button
      key="submit"
      type="submit"
      variant={props.tone === "destructive" ? "destructive" : "default"}
      form={formId}
      className={surface === "page" ? "flex-1" : "flex-1 sm:flex-none"}
      disabled={!ready || submitting}
    >
      {label(props.command, submitting ? "submitting" : "submit")}
    </Button>
  )
  const cancel = props.hideCancel ? null : (
    <Button
      key="cancel"
      type="button"
      variant="outline"
      className={surface === "page" ? undefined : "flex-1 sm:flex-none"}
      onClick={dismiss}
    >
      {props.cancelLabel ?? label(props.command, "dismiss")}
    </Button>
  )

  return (
    <form
      id={formId}
      noValidate
      className={cn(surfaceBodyClass(surface), bodyClassName)}
      onSubmit={handleSubmit}
    >
      <div
        className={cn(
          "flex flex-col gap-4",
          (surface === "panel" || surface === "sheet") && "p-4",
        )}
      >
        {surface === "page" && props.title !== undefined && (
          <p className="text-sm font-semibold">{props.title}</p>
        )}
        {surface === "page" && props.description !== undefined && (
          <p className="text-sm text-muted-foreground">{props.description}</p>
        )}
        {error !== undefined &&
          (informative ? (
            <p
              role="status"
              className="rounded-lg bg-info/10 px-4 py-3 text-sm text-info-foreground"
            >
              {errorMessage(i18n, error)}
            </p>
          ) : (
            <ErrorBanner code={error} />
          ))}
        {props.children}
      </div>
      {/* Submit is last on every surface, desktop and phone. */}
      <Footer surface={surface}>{[cancel, submit]}</Footer>
    </form>
  )
}

function surfaceBodyClass(surface: CommandSurface): string {
  switch (surface) {
    case "dialog":
      return "flex flex-col gap-4"
    case "page":
      return "flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
    case "panel":
    case "sheet":
      return "flex flex-1 flex-col"
  }
}

function Footer({
  surface,
  children,
}: {
  surface: CommandSurface
  children: ReactNode
}) {
  if (surface === "dialog") {
    return <DialogFooter className="flex-row justify-end">{children}</DialogFooter>
  }
  if (surface === "page") return <div className="flex gap-2">{children}</div>
  return <FormPanelFooter>{children}</FormPanelFooter>
}

/**
 * A value the form is fixed to, shown where its picker would be. The record
 * panel pins the vehicle; a decision pins the record it decides.
 */
export function PinnedField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <p className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-line">
        {children}
      </p>
    </div>
  )
}

/**
 * The reason a refusal or a cancellation must give: marked required, and
 * capped where every such command's contract caps it.
 */
export function ReasonField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string | undefined
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>
        {label}
        <span aria-hidden className="text-destructive">
          *
        </span>
      </Label>
      <Textarea
        id={id}
        required
        aria-required
        maxLength={500}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

type SubmissionResult = { ok: true } | { ok: false; code: string }

/**
 * The submit bookkeeping every command form repeats: one attempt at a time,
 * the last failure's code kept for the banner, cleared on the next attempt.
 */
export function useCommandSubmission() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string>()

  async function run<R extends SubmissionResult>(
    attempt: () => Promise<R>,
  ): Promise<R> {
    setError(undefined)
    setSubmitting(true)
    const result = await attempt()
    setSubmitting(false)
    const settled: SubmissionResult = result
    if (!settled.ok) setError(settled.code)
    return result
  }

  return { submitting, error, setError, run }
}
