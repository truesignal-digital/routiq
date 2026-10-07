import { useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/*
 * The ROUTIQ mark: an R whose counter is a map pin and whose stem runs out as a
 * road. Every hole is a mask cut-out, never a painted white shape, so the mark
 * sits on any surface (light or dark theme) without a halo. The letter takes
 * `currentColor`; the pin takes the `brand` token, which nothing else uses.
 */
const COUNTER =
  "M58 17.5a13 13 0 0 1 13 13c0 7.6-6.2 12.8-13 21.5c-6.8-8.7-13-13.9-13-21.5a13 13 0 0 1 13-13z";
const ROAD = "M53 50C37 53 16 70 4 93H43C45 74 51 60 62 50Z";
const PIN =
  "M58 22.5a7.5 7.5 0 0 1 7.5 7.5c0 4.4-3.6 7.4-7.5 12.5c-3.9-5.1-7.5-8.1-7.5-12.5a7.5 7.5 0 0 1 7.5-7.5z";

export function RoutiqMark({
  className,
  title,
}: {
  className?: string | undefined;
  /** Omit when a visible wordmark already names the product. */
  title?: string;
}) {
  // Two marks on one page (sidebar + login preview) must not share mask ids.
  const id = useId().replace(/:/g, "");
  const body = `${id}-body`;
  const road = `${id}-road`;
  const pin = `${id}-pin`;

  return (
    <svg
      viewBox="0 0 100 100"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-slot="routiq-mark"
    >
      <defs>
        <mask id={body} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <path d={COUNTER} fill="#000" />
          <path d={ROAD} fill="#000" stroke="#000" strokeWidth="7" strokeLinejoin="round" />
          <path d="M53 50C37 53 16 70 4 93L0 100V40Z" fill="#000" />
        </mask>
        <mask id={road} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <path
            d="M57.5 51C44 56 31 70 24 93"
            fill="none"
            stroke="#000"
            strokeWidth="2.6"
            strokeDasharray="5 5"
            strokeDashoffset="2"
          />
        </mask>
        <mask id={pin} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <circle cx="58" cy="30" r="2.8" fill="#000" />
        </mask>
      </defs>
      <g fill="currentColor">
        <g mask={`url(#${body})`}>
          <path d="M29 7H59C75 7 85.5 17.5 85.5 31.5C85.5 46 74.5 56.5 59 56.5H29Z" />
          <rect x="29" y="7" width="17" height="60" />
          <path d="M55 49H72L91 93H71Z" />
        </g>
        <path mask={`url(#${road})`} d={ROAD} />
      </g>
      <path mask={`url(#${pin})`} className="fill-brand" d={PIN} />
    </svg>
  );
}

/** The name as the logo sets it: wide caps, the Q in brand blue. */
export function RoutiqWordmark({ className }: { className?: string | undefined }) {
  return (
    <span
      className={cn("font-heading font-semibold tracking-[0.16em] uppercase", className)}
      data-slot="routiq-wordmark"
    >
      Routi<span className="text-brand">q</span>
    </span>
  );
}

/** Mark + wordmark lockup, for the sidebar header and the sign-in page. */
export function RoutiqLogo({
  className,
  markClassName,
  markTitle,
  wordmarkClassName,
}: {
  className?: string | undefined;
  markClassName?: string | undefined;
  /** Only where the wordmark is hidden, such as the collapsed sidebar rail. */
  markTitle?: string | undefined;
  wordmarkClassName?: string | undefined;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} data-slot="routiq-logo">
      <RoutiqMark
        className={cn("size-8", markClassName)}
        {...(markTitle === undefined ? {} : { title: markTitle })}
      />
      <RoutiqWordmark className={wordmarkClassName} />
    </span>
  );
}

/**
 * The company logo set in Company settings, once #350 serves it. While it is
 * absent the header shows the ROUTIQ logo itself, so nothing credits ROUTIQ twice.
 */
export function useCompanyLogo(): string | undefined {
  return undefined;
}

/** "powered by ROUTIQ", shown only while a company logo fills the header. */
export function PoweredByRoutiq({
  companyLogo,
  className,
}: {
  companyLogo: string | undefined;
  className?: string | undefined;
}) {
  const { t } = useTranslation();
  if (companyLogo === undefined) return null;
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}
      data-slot="powered-by-routiq"
    >
      <RoutiqMark className="size-4" />
      <span>{t("brand.poweredBy")}</span>
    </span>
  );
}
