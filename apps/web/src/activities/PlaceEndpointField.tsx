import { useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LegEndpoint } from "@routiq/contracts";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { usePlaces } from "./usePlaces.js";

export interface PlaceEndpointFieldProps {
  value?: LegEndpoint;
  onChange: (endpoint: LegEndpoint) => void;
  /** Accessible name for the text field — legs repeat this control twice. */
  label?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

function endpointText(value: LegEndpoint | undefined): string {
  if (value === undefined) return "";
  return value.kind === "place" ? value.name : value.text;
}

/**
 * One leg end: a reusable place, or the ad-hoc stop §3.1 keeps as free text.
 * The discriminator records what the clerk meant instead of guessing from which
 * field got filled — "Carrière PK14" is not a typo of a town, and route
 * profitability must not silently merge the two.
 */
export function PlaceEndpointField({
  value,
  onChange,
  label,
  disabled = false,
  className,
  id,
}: PlaceEndpointFieldProps) {
  const { t } = useTranslation();
  const placesQuery = usePlaces();
  const places = placesQuery.data?.items ?? [];
  const [showSuggestions, setShowSuggestions] = useState(false);
  const captionId = useId();
  // One field contributes one endpoint, so one id covers whatever new name it
  // ends up carrying — and stays put across re-renders, so a retry re-posts the
  // identical payload.
  const newPlaceId = useRef(crypto.randomUUID());

  const adHoc = value?.kind === "text";
  const text = endpointText(value);

  const suggestions = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (adHoc || needle === "") return [];
    return places
      .filter((place) => place.name.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [places, text, adHoc]);

  function emitPlace(name: string) {
    const known = places.find(
      (place) => place.name.toLowerCase() === name.trim().toLowerCase(),
    );
    onChange({
      kind: "place",
      placeId: known?.id ?? newPlaceId.current,
      name,
    });
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="relative">
        <Input
          type="text"
          value={text}
          disabled={disabled}
          placeholder={
            adHoc
              ? t("activities.pickers.place.textPlaceholder")
              : t("activities.pickers.place.placeholder")
          }
          onChange={(event) => {
            const next = event.target.value;
            setShowSuggestions(true);
            if (adHoc) onChange({ kind: "text", text: next });
            else emitPlace(next);
          }}
          {...(id === undefined ? {} : { id })}
          {...(label === undefined ? {} : { "aria-label": label })}
        />

        {showSuggestions && suggestions.length > 0 && (
          <ul
            role="listbox"
            aria-label={t("activities.pickers.place.suggestions")}
            className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg bg-popover p-1 text-sm shadow-md ring-1 ring-foreground/10"
          >
            {suggestions.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={
                    value?.kind === "place" && value.placeId === place.id
                  }
                  className="w-full rounded-md px-2 py-2 text-left hover:bg-muted"
                  onClick={() => {
                    onChange({
                      kind: "place",
                      placeId: place.id,
                      name: place.name,
                    });
                    setShowSuggestions(false);
                  }}
                >
                  {place.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          checked={adHoc}
          disabled={disabled}
          // Base UI points aria-labelledby at a Field label this control has
          // none of; naming the caption explicitly keeps the reference live.
          aria-labelledby={captionId}
          onCheckedChange={(checked) => {
            setShowSuggestions(false);
            if (checked) onChange({ kind: "text", text });
            else emitPlace(text);
          }}
        />
        <Label id={captionId} className="text-xs font-normal text-muted-foreground">
          {t("activities.pickers.place.adHoc")}
        </Label>
      </div>
    </div>
  );
}
