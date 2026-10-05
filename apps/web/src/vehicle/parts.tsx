import { Fragment, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  ChevronRight,
  Ellipsis,
  Info,
  Lock,
  OctagonAlert,
  ShieldAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { AttentionSeverity } from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { STEP_ICONS } from "./steps.js";
import type { Lock as LockReason, OfferedStep, Step } from "./model.js";

export type Tone = "neutral" | "success" | "warning" | "info" | "danger";

/**
 * Some messages carry a record that should be a link inside the sentence. The
 * translator places `{name}` where it goes; the sentence is rendered with a
 * sentinel in that slot and split around it, so the wording stays one message
 * in every language (no concatenated fragments).
 */
export function withNodes(
  render: (slots: Record<string, string>) => string,
  nodes: Record<string, ReactNode>,
): ReactNode {
  const slots = Object.fromEntries(Object.keys(nodes).map((name) => [name, `⁣${name}⁣`]));
  const text = render(slots);
  const parts = text.split(/⁣([a-zA-Z]+)⁣/);
  return parts.map((part, index) =>
    index % 2 === 1 ? <Fragment key={index}>{nodes[part] ?? part}</Fragment> : part,
  );
}

export function Sep() {
  return (
    <span aria-hidden className="text-muted-foreground/50">
      ·
    </span>
  );
}

export function Count({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span
      className="inline-flex h-5 items-center rounded-md bg-muted px-1.5 text-xs font-medium text-muted-foreground tabular-nums"
      {...(label === undefined ? {} : { "aria-label": label })}
    >
      {children}
    </span>
  );
}

export function LinkButton({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "rounded-sm font-medium text-foreground tabular-nums underline decoration-foreground/25 underline-offset-[3px] transition-colors hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </button>
  );
}

const ICON_TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-muted text-foreground/80",
  danger: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground",
  success: "bg-success/15 text-success-foreground",
};

export function RowIcon({ icon: Icon, tone = "neutral" }: { icon: LucideIcon; tone?: Tone }) {
  return (
    <span className={cn("grid size-8 shrink-0 place-items-center rounded-md", ICON_TONE_CLASS[tone])}>
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

export function SeverityIcon({
  severity,
  className,
}: {
  severity: AttentionSeverity;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = severity === "CRITICAL" ? OctagonAlert : severity === "WARNING" ? TriangleAlert : Info;
  return (
    <Icon
      className={cn(
        "size-4 shrink-0",
        severity === "CRITICAL" && "text-destructive",
        severity === "WARNING" && "text-warning-foreground",
        severity === "INFO" && "text-info-foreground",
        className,
      )}
      role="img"
      aria-label={t(`vehicle.severity.${severity}`)}
    />
  );
}

export function SafetyMark() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 font-medium text-destructive">
      <ShieldAlert className="size-3.5" aria-hidden />
      {t("vehicle.maintenance.safetyCritical")}
    </span>
  );
}

export function CardHead({
  title,
  aside,
  description,
}: {
  title: ReactNode;
  aside?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-sm font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A tab's title, one line of explanation, and its single primary button. */
export function TabHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function SubHead({
  title,
  count,
  description,
}: {
  title: string;
  count?: number | undefined;
  description?: string | undefined;
}) {
  return (
    <div className="mb-2.5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {count !== undefined && <Count>{count}</Count>}
      </h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

/** One row anatomy for every list: what it is · status · amount or date · "…". */
export function RecordRow({
  icon,
  title,
  detail,
  status,
  aside,
  menu,
  onOpen,
  muted = false,
}: {
  icon: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  aside?: ReactNode;
  menu?: ReactNode;
  onOpen?: (() => void) | undefined;
  muted?: boolean;
}) {
  return (
    <li
      onClick={onOpen}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[auto_minmax(0,1fr)_11.5rem_10rem_1.75rem] md:items-center md:gap-x-4",
        onOpen && "cursor-pointer transition-colors hover:bg-muted/40",
      )}
    >
      <div className="col-start-1 row-start-1">{icon}</div>
      <div className="col-start-2 row-start-1 min-w-0 self-center">
        {onOpen ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            className={cn(
              "rounded-sm text-left font-medium leading-snug focus-visible:outline-2 focus-visible:outline-ring",
              muted && "text-muted-foreground",
            )}
          >
            {title}
          </button>
        ) : (
          <p className="font-medium leading-snug">{title}</p>
        )}
        {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
      </div>
      {(status || aside) && (
        <div className="col-start-2 row-start-2 flex flex-wrap items-start justify-between gap-x-3 gap-y-1 md:contents">
          <div className="min-w-0 md:col-start-3 md:row-start-1">{status}</div>
          <div className="ml-auto shrink-0 text-right text-sm tabular-nums md:col-start-4 md:row-start-1">
            {aside}
          </div>
        </div>
      )}
      <div className="col-start-3 row-start-1 flex justify-end self-start md:col-start-5 md:self-center">
        {menu ??
          (onOpen ? (
            <ChevronRight className="mt-1.5 size-4 text-muted-foreground md:mt-0" aria-hidden />
          ) : null)}
      </div>
    </li>
  );
}

/** A locked step's reason, in words. */
export function useLockText() {
  const { t } = useTranslation();
  return (lock: LockReason) => t(`vehicle.locked.${lock.key}`, lock.params ?? {});
}

export function useStepLabel() {
  const { t } = useTranslation();
  return (step: Pick<Step, "key">) => t(`vehicle.steps.${step.key}`);
}

/** The row's "…": its open steps first, then the locked ones with what they wait for. */
export function RowMenu({
  label,
  steps,
  onStep,
}: {
  label: string;
  steps: readonly OfferedStep[];
  onStep: (step: Step) => void;
}) {
  const { t } = useTranslation();
  const lockText = useLockText();
  const stepLabel = useStepLabel();
  if (steps.length === 0) {
    return <ChevronRight className="mt-1.5 size-4 text-muted-foreground md:mt-0" aria-hidden />;
  }
  const open = steps.filter((s) => s.lock === undefined);
  const locked = steps.filter((s) => s.lock !== undefined);
  return (
    <div onClick={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="desktop-icon-sm"
              className="text-muted-foreground"
              aria-label={t("vehicle.rows.actionsFor", { record: label })}
            />
          }
        >
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {open.map(({ step }) => {
            const Icon = STEP_ICONS[step.key];
            return (
              <DropdownMenuItem key={step.key} className="py-1.5" onClick={() => onStep(step)}>
                <Icon className="text-muted-foreground" aria-hidden />
                {stepLabel(step)}
              </DropdownMenuItem>
            );
          })}
          {open.length > 0 && locked.length > 0 && <DropdownMenuSeparator />}
          {locked.map(({ step, lock }) => (
            <DropdownMenuItem key={step.key} disabled className="items-start py-1.5">
              <Lock className="mt-0.5 text-muted-foreground" aria-hidden />
              <span className="grid">
                <span>{stepLabel(step)}</span>
                {lock && <span className="text-xs text-muted-foreground">{lockText(lock)}</span>}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Record panel pieces

export function DetailHeader({
  eyebrow,
  title,
  meta,
  description,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  description?: ReactNode;
}) {
  return (
    <div className="border-b px-4 pt-4 pb-4 pr-12">
      <p className="text-xs font-medium text-muted-foreground tabular-nums">{eyebrow}</p>
      <SheetTitle className="mt-1 text-lg leading-snug font-semibold">{title}</SheetTitle>
      {description && <SheetDescription className="mt-1">{description}</SheetDescription>}
      {meta && <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs">{meta}</div>}
    </div>
  );
}

export function DetailSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <span className="text-xs text-muted-foreground">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

export function FactList({ rows }: { rows: ReadonlyArray<readonly [string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 font-medium">{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

export function Note({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  return (
    <p
      className={cn(
        "flex gap-2 rounded-lg px-3 py-2.5 text-sm",
        tone === "danger"
          ? "bg-destructive/5 text-destructive dark:bg-destructive/10"
          : "bg-muted/60 text-muted-foreground",
      )}
    >
      {tone === "danger" ? (
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      ) : (
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}
