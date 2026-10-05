import type * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseMoneyXaf } from "@/finance/model.js";
import { moneyAmountParts, parseWholeAmount } from "@/lib/format.js";

/** Intl groups with a narrow no-break space; a plain space is what the field
 * accepts back, so the value survives a re-parse. */
function normalizeMoneySpacing(value: string): string {
  return value.replace(/ /g, " ");
}

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
  /**
   * Lay the amount out as `formatMoney` shows it in this language — grouping
   * and currency symbol — so the figure being edited reads like the figure on
   * the card. A decimal part is kept as typed for the form to refuse. Without
   * it the field keeps its fr-CM grouping and XAF marker.
   */
  locale?: string;
}

/**
 * A XAF amount as an operator types it. Digits and spacing only — XAF has
 * exponent 0, so a decimal separator is never a valid part of an amount — and
 * blur reformats to fr-CM grouping so the figure on screen matches the figure
 * on the receipt.
 */
export function MoneyInput({
  value,
  onValueChange,
  onBlur,
  className,
  locale,
  ...rest
}: MoneyInputProps) {
  if (locale !== undefined) {
    return (
      <LocalizedMoneyInput
        value={value}
        onValueChange={onValueChange}
        locale={locale}
        {...(onBlur === undefined ? {} : { onBlur })}
        {...(className === undefined ? {} : { className })}
        {...rest}
      />
    );
  }
  const amountMinor = parseMoneyXaf(value);

  return (
    <div className="relative">
      <Input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          onValueChange(event.target.value.replace(/[^\d\s]/g, ""));
        }}
        onBlur={(event) => {
          const parsed = parseMoneyXaf(event.target.value);
          if (parsed !== null) {
            const formatted = new Intl.NumberFormat("fr-CM", {
              style: "decimal",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(parsed);
            onValueChange(normalizeMoneySpacing(formatted));
          }
          onBlur?.();
        }}
        className={className}
        {...rest}
      />
      {value && amountMinor !== null && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          XAF
        </span>
      )}
    </div>
  );
}

function LocalizedMoneyInput({
  value,
  onValueChange,
  onBlur,
  className,
  locale,
  ...rest
}: MoneyInputProps & { locale: string }) {
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
