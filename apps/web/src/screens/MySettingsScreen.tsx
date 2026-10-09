import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { chooseLanguage } from "@/i18n/language.js";
import { MemberBadge } from "@/shell/NameMenu.js";
import { useWho } from "@/shell/who.js";

const languages = [
  { code: "fr-CM", base: "fr", label: "Français" },
  { code: "en", base: "en", label: "English" },
] as const;

/** Per-person settings, opened from the name menu. Language is still per device (#358). */
export function MySettingsScreen() {
  const { t, i18n } = useTranslation();
  const who = useWho();

  return (
    <PageContainer width="narrow">
      <PageHeader title={t("mySettings.title")} />

      {who && (
        <div className="mt-4 flex items-center gap-3">
          <MemberBadge who={who} className="size-11 text-lg" />
          <div className="min-w-0">
            <p className="truncate font-medium">{who.name}</p>
            <p className="truncate text-sm text-muted-foreground">
              {t("mySettings.identityLine", { roleLine: who.roleLine, workspace: who.workspaceName })}
            </p>
          </div>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium">{t("mySettings.language")}</h2>
        <div className="mt-2 flex gap-2" role="group" aria-label={t("mySettings.language")}>
          {languages.map(({ code, base, label }) => {
            const selected = i18n.resolvedLanguage === base;
            return (
              <Button
                key={code}
                type="button"
                variant={selected ? "default" : "outline"}
                aria-pressed={selected}
                // The language names stay in their own language, whatever the UI is in.
                lang={base}
                onClick={() => void chooseLanguage(i18n, code)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium">{t("mySettings.appearance.label")}</h2>
        <ThemeToggle className="mt-2" />
      </div>
    </PageContainer>
  );
}
