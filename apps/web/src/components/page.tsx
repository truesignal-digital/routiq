import { ArrowLeft, CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
  titleClassName?: string;
} & (
  | {
      onBack: () => void;
      backLabel: ReactNode;
    }
  | {
      onBack?: undefined;
      backLabel?: never;
    }
);

export function PageHeader({
  title,
  actions,
  className,
  titleClassName,
  onBack,
  backLabel,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col", className)}>
      {onBack && (
        <button
          type="button"
          className="flex min-h-9 items-center gap-1.5 self-start text-sm text-muted-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" aria-hidden />
          {backLabel}
        </button>
      )}
      <div className={cn("flex items-center justify-between gap-4", onBack && "mt-2")}>
        <h1 className={cn("text-2xl font-semibold", titleClassName)}>{title}</h1>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface EmptyStateProps {
  icon: ReactNode;
  message: ReactNode;
  action?: {
    label: ReactNode;
    onClick: () => void;
  } | undefined;
  className?: string;
}

export function EmptyState({ icon, message, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-foreground/20 px-5 py-12 text-center",
        className,
      )}
    >
      <div className="text-muted-foreground">{icon}</div>
      <div className="mt-4 max-w-md text-sm text-muted-foreground">{message}</div>
      {action && (
        <Button type="button" variant="outline" className="mt-5 min-h-11" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export interface ErrorStateProps {
  message: ReactNode;
  retryLabel: ReactNode;
  onRetry: () => void;
  className?: string;
}

export function ErrorState({ message, retryLabel, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center rounded-2xl border border-destructive/20 bg-destructive/5 px-5 py-10 text-center",
        className,
      )}
    >
      <CircleAlert className="size-7 text-destructive" aria-hidden />
      <div className="mt-4 max-w-md text-sm text-destructive">{message}</div>
      <Button type="button" variant="outline" className="mt-5 min-h-11" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

export interface LoadingStateProps {
  label: ReactNode;
  rows?: number;
  className?: string;
  rowClassName?: string;
}

export function LoadingState({
  label,
  rows = 3,
  className,
  rowClassName,
}: LoadingStateProps) {
  return (
    <div role="status" className={cn("flex flex-col gap-3", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-16 w-full rounded-xl", rowClassName)}
          aria-hidden
        />
      ))}
    </div>
  );
}
