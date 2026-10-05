import type * as React from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/index.js";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { moneyAmountParts, parseWholeAmount } from "@/lib/format.js";

export interface MoneyInputProps {
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  name?: string;
  ref?: React.Ref<HTMLInputElement>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  id?: string;
  /** Defaults to the active language, which `parseMoneyXaf` also reads by default. */
  locale?: string;
}

/**
 * A XAF amount as an operator types it, laid out as `formatMoney` shows it in
 * the reader's language: grouping and the FCFA symbol. XAF has exponent 0, so
 * a decimal part is kept as typed for the form to refuse, never rounded.
 */
export function MoneyInput({
  value,
  onValueChange,
  onBlur,
  className,
  locale: localeProp,
  ...rest
}: MoneyInputProps) {
  // Subscribes to language changes; the locale itself comes from the same
  // instance the form's parser reads, so the two can never disagree.
  useTranslation();
  const locale = localeProp ?? i18n.resolvedLanguage;
  const { symbol, symbolFirst } = moneyAmountParts(0, { locale });
  return (
    <div className="relative">
      {symbolFirst && (
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {symbol}
        </span>
      )}
      <Input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => onValueChange(event.target.value.replace(/[^\d\s.,]/g, ""))}
        onBlur={(event) => {
          const parsed = parseWholeAmount(event.target.value, locale);
          if (parsed.kind === "amount") {
            onValueChange(moneyAmountParts(parsed.minor, { locale }).amount);
          }
          onBlur?.();
        }}
        className={cn("tabular-nums", symbolFirst ? "pl-14" : "pr-14", className)}
        {...rest}
      />
      {!symbolFirst && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          {symbol}
        </span>
      )}
    </div>
  );
}
