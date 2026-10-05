import { memo, useCallback } from "react";
import { useFieldArray, type Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PersonPicker } from "../PersonPicker.js";
import { CREW_ROLES, newCrewRow, type SheetFormValues } from "./form.js";

export interface CrewRowsProps {
  control: Control<SheetFormValues>;
  /** Where a person registered from inside a row is filed. */
  branchCode: string;
  /** The same branch, as the persons read filters it — undefined until known. */
  branchId: string | undefined;
}

interface CrewRowProps {
  control: Control<SheetFormValues>;
  index: number;
  branchCode: string;
  branchId: string | undefined;
  onRemove: (index: number) => void;
}

/**
 * One line of the crew box. Memoized on the props it actually reads: a sheet can
 * carry six people, and re-rendering every picker on each keystroke elsewhere is
 * what makes the form crawl on the phones the pilot runs on.
 */
const CrewRow = memo(function CrewRow({
  control,
  index,
  branchCode,
  branchId,
  onRemove,
}: CrewRowProps) {
  const { t } = useTranslation();
  const position = index + 1;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-start">
      <FormField
        control={control}
        name={`crew.${index}.personId`}
        render={({ field }) => (
          <FormItem className="flex-1">
            <FormLabel className="text-xs text-muted-foreground">
              {t("activities.record.crew.personLabel")}
            </FormLabel>
            <FormControl>
              <PersonPicker
                value={field.value}
                onChange={field.onChange}
                branchCode={branchCode}
                {...(branchId === undefined ? {} : { branchId })}
                label={t("activities.record.crew.rowPerson", { position })}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name={`crew.${index}.role`}
        render={({ field }) => (
          <FormItem className="sm:w-44">
            <FormLabel className="text-xs text-muted-foreground">
              {t("activities.record.crew.roleLabel")}
            </FormLabel>
            <Select
              value={field.value}
              onValueChange={(value) => {
                if (value) field.onChange(value);
              }}
            >
              <FormControl>
                <SelectTrigger
                  className="w-full"
                  aria-label={t("activities.record.crew.rowRole", { position })}
                >
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {CREW_ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`activities.crewRoles.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="shrink-0 self-end text-muted-foreground sm:mt-6"
        aria-label={t("activities.record.crew.remove", { position })}
        onClick={() => onRemove(index)}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
});

export function CrewRows({ control, branchCode, branchId }: CrewRowsProps) {
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({ control, name: "crew" });
  const onRemove = useCallback((index: number) => remove(index), [remove]);

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("activities.record.crew.empty")}
        </p>
      )}

      {fields.map((field, index) => (
        <CrewRow
          key={field.id}
          control={control}
          index={index}
          branchCode={branchCode}
          branchId={branchId}
          onRemove={onRemove}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        className="self-start"
        onClick={() => append(newCrewRow(fields.length === 0 ? "DRIVER" : "CONDUCTOR"))}
      >
        <UserPlus className="size-4" aria-hidden />
        {t("activities.record.crew.add")}
      </Button>
    </div>
  );
}
