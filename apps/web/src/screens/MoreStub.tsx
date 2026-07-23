import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { sessionStore, useActiveSession } from "../auth/store.js";

const languages = [
  { code: "fr-CM", base: "fr", label: "Français" },
  { code: "en", base: "en", label: "English" },
] as const;

export function MoreStub() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const session = useActiveSession();

  function onLogout() {
    if (session) sessionStore.logout(session);
    void navigate({ to: "/login" });
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6">
      <h1 className="text-2xl font-semibold">{t("more.title")}</h1>
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
              className="min-h-11"
              onClick={() => void i18n.changeLanguage(code)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <Button variant="outline" className="min-h-11" onClick={onLogout}>
          {t("more.logout")}
        </Button>
      </div>
    </section>
  );
}
