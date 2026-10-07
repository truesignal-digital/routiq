import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/auth/sign-out.js";
import { useActiveSession } from "@/auth/store.js";
import { chooseLanguage } from "@/i18n/language.js";

const languages = [
  { code: "fr-CM", base: "fr", label: "Français" },
  { code: "en", base: "en", label: "English" },
] as const;

export function MoreStub() {
  const { t, i18n } = useTranslation();
  const session = useActiveSession();
  const onLogout = useSignOut();

  return (
    <PageContainer>
      <PageHeader title={t("more.title")} />
      {session && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("more.signedInAs", { username: session.username })}
        </p>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium">{t("more.language")}</h2>
        <div className="mt-2 flex gap-2">
          {languages.map(({ code, base, label }) => (
            <Button
              key={code}
              variant={i18n.resolvedLanguage === base ? "default" : "outline"}
              onClick={() => void chooseLanguage(i18n, code)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium">{t("more.theme.label")}</h2>
        <ThemeToggle className="mt-2" />
      </div>

      <div className="mt-8">
        <Button variant="outline" onClick={onLogout}>
          {t("more.logout")}
        </Button>
      </div>
    </PageContainer>
  );
}
