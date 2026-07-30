import { memo, useCallback } from "react";
import { useFieldArray, type Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { MapPin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SheetTemplate } from "../sheet-model.js";
import { PlaceEndpointField } from "../PlaceEndpointField.js";
import { LOAD_STATES, newLegRow, type SheetFormValues } from "./form.js";

export interface LegRowsProps {
  control: Control<SheetFormValues>;
  template: SheetTemplate;
}

interface LegRowProps {
  control: Control<SheetFormValues>;
  index: number;
  template: SheetTemplate;
  onRemove: (index: number) => void;
}

/**
 * One line of the itinerary. `template` is the only non-scalar thing it reads,
 * so flipping the tab re-renders the legs and nothing else does.
 */
const LegRow = memo(function LegRow({
  control,
  index,
  template,
  onRemove,
}: LegRowProps) {
  const { t } = useTranslation();
  const position = index + 1;

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("activities.record.legs.rowLabel", { position })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-9 text-muted-foreground"
          aria-label={t("activities.record.legs.remove", { position })}
          onClick={() => onRemove(index)}
        >
          <Trash2 className="size-4" aria-hidden />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`legs.${index}.origin`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.legs.originLabel")}
              </FormLabel>
              <FormControl>
                <PlaceEndpointField
                  {...(field.value === undefined ? {} : { value: field.value })}
                  onChange={field.onChange}
                  label={t("activities.record.legs.rowOrigin", { position })}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name={`legs.${index}.destination`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.legs.destinationLabel")}
              </FormLabel>
              <FormControl>
                <PlaceEndpointField
                  {...(field.value === undefined ? {} : { value: field.value })}
                  onChange={field.onChange}
                  label={t("activities.record.legs.rowDestination", { position })}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`legs.${index}.departedAt`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.legs.departedAtLabel")}
              </FormLabel>
              <FormControl>
                <Input
                  type="datetime-local"
                  className="min-h-11"
                  aria-label={t("activities.record.legs.rowDepartedAt", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={control}
          name={`legs.${index}.arrivedAt`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.legs.arrivedAtLabel")}
              </FormLabel>
              <FormControl>
                <Input
                  type="datetime-local"
                  className="min-h-11"
                  aria-label={t("activities.record.legs.rowArrivedAt", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          control={control}
          name={`legs.${index}.distanceKm`}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">
                {t("activities.record.legs.distanceLabel")}
              </FormLabel>
              <FormControl>
                <Input
                  type="text"
                  inputMode="numeric"
                  className="min-h-11"
                  placeholder={t("activities.record.legs.distancePlaceholder")}
                  aria-label={t("activities.record.legs.rowDistance", { position })}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {template === "journey" ? (
          <FormField
            control={control}
            name={`legs.${index}.passengerCount`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  {t("activities.record.legs.passengersLabel")}
                </FormLabel>
                <FormControl>
                  <Input
                    type="text"
                    inputMode="numeric"
                    className="min-h-11"
                    placeholder={t("activities.record.legs.passengersPlaceholder")}
                    aria-label={t("activities.record.legs.rowPassengers", { position })}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <FormField
            control={control}
            name={`legs.${index}.loadState`}
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-xs text-muted-foreground">
                  {t("activities.record.legs.loadStateLabel")}
                </FormLabel>
                <Select
                  value={field.value || null}
                  onValueChange={(value) => field.onChange(value ?? "")}
                >
                  <FormControl>
                    <SelectTrigger
                      className="min-h-11 w-full"
                      aria-label={t("activities.record.legs.rowLoadState", { position })}
                    >
                      <SelectValue
                        placeholder={t("activities.record.legs.chooseLoadState")}
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {LOAD_STATES.map((state) => (
                      <SelectItem key={state} value={state}>
                        {t(`activities.record.legs.loadStates.${state}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        )}
      </div>
    </div>
  );
});

export function LegRows({ control, template }: LegRowsProps) {
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({ control, name: "legs" });
  const onRemove = useCallback((index: number) => remove(index), [remove]);

  return (
    <div className="flex flex-col gap-3">
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("activities.record.legs.empty")}
        </p>
      )}

      {fields.map((field, index) => (
        <LegRow
          key={field.id}
          control={control}
          index={index}
          template={template}
          onRemove={onRemove}
        />
      ))}

      <Button
        type="button"
        variant="outline"
        className="min-h-11 self-start"
        onClick={() => append(newLegRow())}
      >
        <MapPin className="size-4" aria-hidden />
        {t("activities.record.legs.add")}
      </Button>
    </div>
  );
}
