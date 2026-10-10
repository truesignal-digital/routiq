import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormContext, useFormState, type FieldErrors } from "react-hook-form";

import { NotRecorded } from "@/components/not-recorded.js";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { StatusBadge, type StatusBadgeTone } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/** How far a section got: its required fields still empty, and whether anything in it was entered. */
export interface FormSectionState {
  missing: number;
  started: boolean;
}

export interface FormPageSection {
  /** Unique on the page; the section's anchor. */
  id: string;
  title: string;
  state: FormSectionState;
  /**
   * The form fields the section holds, by name or by the name of their parent
   * (`legs`, `customValues`): a "Still missing" link and a submit error find
   * their section through it.
   */
  fields: readonly string[];
  /** The section's fields, two columns inside the card on a wide screen. */
  children: ReactNode;
}

/** A required field still empty. `field` is the form field name; its control carries `data-field={field}`. */
export interface FormPageMissing {
  field: string;
  label: string;
}

/** One line of "So far". No `value` means nothing was entered: it reads "Not recorded", with Add when `field` is set. */
export interface FormPageSummaryRow {
  label: string;
  value?: ReactNode;
  field?: string;
  /** The line that adds up the rest (a sheet's profit): set apart and larger. */
  total?: boolean;
}

export interface FormPageProps {
  /** The action as a verb phrase, the same words as the button that opened the page. */
  title: ReactNode;
  /** One sentence under the title. */
  description: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Above the first section (a sheet's type switch); on a phone, part of the first step. */
  lead?: ReactNode;
  /** Above the sections on every step: the server's refusal. */
  banner?: ReactNode;
  sections: readonly FormPageSection[];
  summary: readonly FormPageSummaryRow[];
  missing: readonly FormPageMissing[];
  /** When the form keeps a draft: the time it was last saved, shown in the footer hint. */
  draftSavedAt?: Date | undefined;
  /** The footer's buttons, main button last. */
  actions: ReactNode;
}

function inSection(section: FormPageSection, name: string): boolean {
  return section.fields.some((field) => name === field || name.startsWith(`${field}.`));
}

function topLevelErrors(errors: FieldErrors): string[] {
  return Object.keys(errors).filter((key) => errors[key] !== undefined);
}

function sectionTone({ missing, started }: FormSectionState): StatusBadgeTone {
  if (missing > 0) return "warning";
  return started ? "success" : "neutral";
}

function SectionStateBadge({ state }: { state: FormSectionState }) {
  const { t } = useTranslation();
  const label =
    state.missing > 0
      ? t("form.page.missing", { count: state.missing })
      : state.started
        ? t("form.page.done")
        : t("form.page.notStarted");
  return (
    <StatusBadge tone={sectionTone(state)} data-slot="form-section-state">
      {label}
    </StatusBadge>
  );
}

/**
 * A Long capture on its own page (docs/design/consistency/fullpages.html#form):
 * the page frame, title and one sentence, a 760 px column of titled section
 * cards each showing its state, a context column "So far" with what was
 * entered and what is still missing, and one sticky footer with the hint on
 * the left and the buttons on the right, main button last. The breadcrumb is
 * the shell's (`shell/breadcrumbs.ts`).
 *
 * On a phone each section is a step and the last step is a review that shows
 * "So far". Every section stays mounted, so moving between steps loses nothing.
 * Must sit inside react-hook-form's provider (`<Form {...form}>`).
 */
export function FormPage({
  title,
  description,
  onSubmit,
  lead,
  banner,
  sections,
  summary,
  missing,
  draftSavedAt,
  actions,
}: FormPageProps) {
  const { t, i18n } = useTranslation();
  const stepping = useIsMobile();
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const reviewStep = sections.length;
  const onReview = stepping && step === reviewStep;

  const { control } = useFormContext();
  const { errors, submitCount } = useFormState({ control });

  const sectionIndexOf = useCallback(
    (name: string) => sections.findIndex((section) => inSection(section, name)),
    [sections],
  );

  const pendingTarget = useRef<string | null>(null);
  const [scrollTick, setScrollTick] = useState(0);

  /** Brings a field into view and focuses it, opening its step on a phone first. */
  const goTo = useCallback(
    (field: string) => {
      const index = sectionIndexOf(field);
      if (stepping && index >= 0) setStep(index);
      pendingTarget.current = field;
      setScrollTick((tick) => tick + 1);
    },
    [sectionIndexOf, stepping],
  );

  // After the step it lives on is shown, so the field can be scrolled to.
  useEffect(() => {
    const field = pendingTarget.current;
    const root = formRef.current;
    if (field === null || root === null) return;
    pendingTarget.current = null;
    const index = sectionIndexOf(field);
    const target =
      root.querySelector<HTMLElement>(`[data-field="${field.replace(/["\\]/g, "\\$&")}"]`) ??
      (index >= 0 ? root.querySelector<HTMLElement>(`#${sectionAnchor(sections[index]?.id ?? "")}`) : null);
    if (target === null) return;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target
      .querySelector<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])",
      )
      ?.focus({ preventScroll: true });
  }, [scrollTick, sectionIndexOf, sections]);

  // A refused submit on a phone opens the first step holding an error; on a
  // wide screen every section is on screen and the form focuses the field.
  const handledSubmit = useRef(submitCount);
  useEffect(() => {
    if (submitCount === handledSubmit.current) return;
    handledSubmit.current = submitCount;
    if (!stepping) return;
    const failed = topLevelErrors(errors);
    const index = sections.findIndex((section) =>
      failed.some((name) => section.fields.some((field) => field.split(".")[0] === name)),
    );
    if (index >= 0) setStep(index);
  }, [submitCount, errors, sections, stepping]);

  function submit(event: FormEvent<HTMLFormElement>) {
    // Enter on a step moves on; only the review step records.
    if (stepping && step < reviewStep) {
      event.preventDefault();
      setStep(step + 1);
      return;
    }
    onSubmit(event);
  }

  const time =
    draftSavedAt === undefined
      ? undefined
      : new Intl.DateTimeFormat(i18n.resolvedLanguage, { hour: "2-digit", minute: "2-digit", hour12: false }).format(draftSavedAt);
  const missingText =
    missing.length > 0 ? t("form.page.missing", { count: missing.length }) : t("form.page.nothingMissing");
  const hint = time === undefined ? missingText : t("form.page.hintWithDraft", { missing: missingText, time });

  const context = (
    <>
      <Card size="sm" data-slot="form-page-so-far">
        <CardContent className="flex flex-col">
          <h2 className="mb-2 font-heading text-sm font-semibold">{t("form.page.soFar")}</h2>
          <dl className="flex flex-col">
            {summary.map((row) => (
              <div
                key={row.label}
                className={cn(
                  "flex items-baseline justify-between gap-3 border-b border-border py-2 text-sm last:border-b-0",
                  row.total === true && "border-t border-b-0 border-border pt-3",
                )}
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd
                  className={cn(
                    "min-w-0 text-end font-medium tabular-nums break-words",
                    row.total === true && "text-lg font-semibold",
                  )}
                >
                  {row.value ?? (
                    <NotRecorded onAdd={row.field === undefined ? undefined : () => goTo(row.field ?? "")} />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card size="sm" data-slot="form-page-missing">
        <CardContent className="flex flex-col">
          <h2 className="mb-1 font-heading text-sm font-semibold">{t("form.page.stillMissing")}</h2>
          {missing.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">{t("form.page.nothingMissing")}</p>
          ) : (
            <ul className="flex flex-col">
              {missing.map((item) => {
                const section = sections[sectionIndexOf(item.field)];
                return (
                  <li key={item.field} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      onClick={() => goTo(item.field)}
                      aria-label={t("form.page.goTo", { field: item.label })}
                      className="flex min-h-11 w-full items-center gap-3 py-2 text-start text-sm hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">{item.label}</span>
                        {section !== undefined && (
                          <span className="text-xs text-muted-foreground">{section.title}</span>
                        )}
                      </span>
                      <span aria-hidden className="shrink-0 text-xs font-semibold text-primary">
                        {t("form.page.go")}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

    </>
  );

  return (
    <PageContainer>
      <PageHeader title={title} description={description} />

      <form ref={formRef} data-slot="form-page" className="@container mt-6" onSubmit={submit}>
        <div className="grid items-start gap-5 @min-[1080px]:grid-cols-[minmax(0,760px)_300px]">
          <div data-slot="form-page-column" className="flex min-w-0 flex-col gap-4">
            {stepping && (
              <div data-slot="form-page-step" className="flex min-h-11 items-center gap-2">
                {step > 0 && (
                  <Button type="button" variant="ghost" size="icon" onClick={() => setStep(step - 1)}>
                    <ChevronLeft aria-hidden />
                    <span className="sr-only">{t("form.page.back")}</span>
                  </Button>
                )}
                <p className="text-sm">
                  <span className="text-muted-foreground">
                    {t("form.page.step", { current: step + 1, total: sections.length + 1 })}
                  </span>{" "}
                  <span className="font-semibold">
                    {onReview ? t("form.page.review") : sections[step]?.title}
                  </span>
                </p>
              </div>
            )}

            {banner}
            {(!stepping || step === 0) && lead}

            {sections.map((section, index) => (
              <Card
                key={section.id}
                id={sectionAnchor(section.id)}
                data-section={section.id}
                hidden={stepping && index !== step}
                className="scroll-mt-20"
              >
                <CardHeader className="flex items-center justify-between gap-3 border-b">
                  <h2 className="font-heading text-base leading-snug font-medium">{section.title}</h2>
                  <SectionStateBadge state={section.state} />
                </CardHeader>
                <CardContent>{section.children}</CardContent>
              </Card>
            ))}

            {onReview && (
              <div data-slot="form-page-review" className="flex flex-col gap-3">
                {context}
                <ul className="flex flex-col rounded-xl ring-1 ring-foreground/10">
                  {sections.map((section, index) => (
                    <li
                      key={section.id}
                      className="flex min-h-11 items-center gap-3 border-b border-border px-3 py-1 last:border-b-0"
                    >
                      <span className="min-w-0 flex-1 text-sm font-medium">{section.title}</span>
                      <SectionStateBadge state={section.state} />
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => setStep(index)}
                        aria-label={t("form.page.changeSection", { section: section.title })}
                      >
                        {t("form.page.change")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {!stepping && (
            <aside
              data-slot="form-page-context"
              aria-label={t("form.page.soFar")}
              className="flex flex-col gap-3 @min-[1080px]:sticky @min-[1080px]:top-20"
            >
              {context}
            </aside>
          )}
        </div>

        <div
          data-slot="form-page-footer"
          className={cn(
            "sticky bottom-(--bottom-bar,0px) z-20 -mx-4 mt-6 flex gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-background/85 sm:-mx-6 sm:px-6",
            stepping ? "flex-col items-stretch" : "items-center",
          )}
        >
          <p className={cn("text-sm text-muted-foreground tabular-nums", !stepping && "me-auto")}>{hint}</p>
          <div className={cn("flex gap-2", stepping && "*:flex-1")}>
            {stepping && !onReview ? (
              <Button type="button" onClick={() => setStep(step + 1)}>
                {t("form.page.next")}
              </Button>
            ) : (
              actions
            )}
          </div>
        </div>
      </form>
    </PageContainer>
  );
}

function sectionAnchor(id: string): string {
  return `form-section-${id}`;
}
