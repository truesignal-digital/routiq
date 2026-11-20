import { useTranslation } from "react-i18next";
import type { MemberBranchScope } from "@routiq/contracts";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export interface BranchOption {
  id: string;
  name: string;
}

/**
 * Branch scope as the membership stores it: every branch, or an explicit list.
 * The two are one control rather than two fields because they are one answer —
 * unticking "all branches" has to leave the admin somewhere to say which ones.
 *
 * Ids, not codes: the member commands take ids (the screen already holds the
 * branch list it rendered), unlike provisioning which names branches it is
 * about to create.
 */
export function BranchScopeField({
  branches,
  value,
  onChange,
  disabled = false,
  allowAll = true,
  hint,
}: {
  branches: readonly BranchOption[];
  value: MemberBranchScope;
  onChange: (value: MemberBranchScope) => void;
  disabled?: boolean;
  /** False for an actor who does not hold every branch: they cannot give "all branches". */
  allowAll?: boolean;
  /** Why the field is locked, when it is. */
  hint?: string | undefined;
}) {
  const { t } = useTranslation();
  const selected = value === "ALL" ? [] : value;

  function toggleBranch(branchId: string, checked: boolean) {
    // An empty pick is allowed while editing; the form holds submit until a
    // scope is chosen (`isBranchScopeChosen`). Never widen it here (#722).
    onChange(checked ? [...selected, branchId] : selected.filter((id) => id !== branchId));
  }

  return (
    <fieldset className="flex flex-col gap-3" disabled={disabled}>
      <legend className="text-sm font-medium">{t("users.form.branchScope")}</legend>

      {allowAll && (
        <Label className="flex items-center gap-2 text-sm font-normal">
          <Checkbox
            checked={value === "ALL"}
            onCheckedChange={(checked) =>
              onChange(checked ? "ALL" : [])
            }
          />
          {t("users.form.allBranches")}
        </Label>
      )}

      {hint !== undefined && <p className="text-sm text-muted-foreground">{hint}</p>}

      {value !== "ALL" && (
        <div className={allowAll ? "flex flex-col gap-2 pl-6" : "flex flex-col gap-2"}>
          {branches.map((branch) => (
            <Label
              key={branch.id}
              className="flex items-center gap-2 text-sm font-normal"
            >
              <Checkbox
                checked={selected.includes(branch.id)}
                onCheckedChange={(checked) => toggleBranch(branch.id, checked)}
              />
              {branch.name}
            </Label>
          ))}
        </div>
      )}

      {!isBranchScopeChosen(value) && (
        <p className="text-sm text-destructive">{t("users.form.branchScopeEmpty")}</p>
      )}
    </fieldset>
  );
}

/** The command needs every branch or at least one (`memberBranchScope`). */
export function isBranchScopeChosen(scope: MemberBranchScope): boolean {
  return scope === "ALL" || scope.length > 0;
}

/** What a row's scope reads as, once branch ids are given their names. */
export function branchScopeLabel(
  scope: MemberBranchScope,
  branches: readonly BranchOption[],
  allBranchesLabel: string,
): string {
  if (scope === "ALL") return allBranchesLabel;
  return scope
    .map((id) => branches.find((branch) => branch.id === id)?.name ?? id)
    .join(", ");
}
