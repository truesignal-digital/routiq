import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "../auth/api.js";
import { sessionStore } from "../auth/store.js";
import { errorMessage } from "../lib/error-message.js";

export function LoginScreen() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { redirect: redirectTo } = useSearch({ from: "/login" });
  const last = sessionStore.getLastIdentity();

  const [workspaceSlug, setWorkspaceSlug] = useState(last?.workspaceSlug ?? "");
  const [username, setUsername] = useState(last?.username ?? "");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrorCode(undefined);
    const result = await login({ workspaceSlug, username, pin });
    setSubmitting(false);
    if (!result.ok) {
      setErrorCode(result.code);
      setPin("");
      return;
    }
    sessionStore.save(result.session);
    void navigate({ to: safeInternalPath(redirectTo) ?? "/assets" });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>

      <form className="mt-8 flex flex-col gap-5" onSubmit={onSubmit}>
        <div className="flex flex-col gap-2">
          <Label htmlFor="workspace">{t("login.workspace")}</Label>
          <Input
            id="workspace"
            className="min-h-11"
            autoCapitalize="none"
            autoCorrect="off"
            value={workspaceSlug}
            onChange={(e) => setWorkspaceSlug(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="username">{t("login.username")}</Label>
          <Input
            id="username"
            className="min-h-11"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="pin">{t("login.pin")}</Label>
          <Input
            id="pin"
            className="min-h-11"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            required
          />
        </div>

        {errorCode !== undefined && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage(i18n, errorCode)}
          </p>
        )}

        <Button type="submit" className="min-h-11" disabled={submitting}>
          {submitting ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
    </main>
  );
}

/** Only app-internal paths may be used as post-login redirect targets. */
function safeInternalPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.startsWith("/") && !path.startsWith("//") ? path : undefined;
}
