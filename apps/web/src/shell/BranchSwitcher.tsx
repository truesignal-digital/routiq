import { Building2, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ALL_BRANCHES, useCurrentBranch } from "./branch-context.js";

/**
 * Which agency the shell is working in — always on screen, because it is the
 * one place that says why a collection holds the rows it holds (design point
 * 5). It renders as a pill in every state: a select when there is something to
 * choose, an inert label for a single-branch member, and a retry affordance
 * when the branch list failed, so a scope can never be in force with no visible
 * control to reset it.
 */
export function BranchSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { currentBranchId, options, status, locked, setCurrentBranchId, retry } =
    useCurrentBranch();

  // 44px: the shell's touch-target standard, and this is a header control on a
  // phone held one-handed. The phone header has room for 11rem; from md up the
  // pill widens so « Toutes mes agences » fits whole (#137).
  const pill = cn(
    "h-11 w-auto max-w-44 gap-2 rounded-full md:h-9 md:max-w-56",
    className,
  );

  if (status === "error") {
    return (
      <Button
        type="button"
        variant="outline"
        className={cn(pill, "border-destructive/40 text-destructive")}
        onClick={retry}
      >
        <TriangleAlert className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t("shell.branch.loadFailed")}</span>
      </Button>
    );
  }

  if (status === "loading") {
    return (
      <span
        className={cn(
          pill,
          "inline-flex items-center px-3 text-sm text-muted-foreground",
        )}
      >
        <Building2 className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t("shell.branch.loading")}</span>
      </span>
    );
  }

  if (locked) {
    const sole = options[0];
    return (
      <span
        className={cn(
          pill,
          "inline-flex items-center border border-border px-3 text-sm font-medium",
        )}
        aria-label={t("shell.branch.label")}
        title={sole?.name}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{sole?.name}</span>
      </span>
    );
  }

  if (options.length === 0) return null;

  const items = [
    { value: ALL_BRANCHES, label: t("shell.branch.all") },
    ...options.map((branch) => ({ value: branch.id, label: branch.name })),
  ];
  const labelOf = (value: unknown) =>
    items.find((item) => item.value === value)?.label;

  return (
    <Select
      items={items}
      value={currentBranchId}
      onValueChange={(value: string | null) =>
        setCurrentBranchId(value ?? ALL_BRANCHES)
      }
    >
      <SelectTrigger
        aria-label={t("shell.branch.label")}
        title={labelOf(currentBranchId)}
        className={pill}
      >
        <Building2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <SelectValue className="min-w-0">
          {(value: unknown) => <span className="truncate">{labelOf(value)}</span>}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
