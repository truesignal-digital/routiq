import { useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { login } from "../auth/api.js";
import { sessionStore } from "../auth/store.js";
import { ErrorBanner } from "@/components/error-banner.js";

interface LoginFormValues {
  workspaceSlug: string;
  username: string;
  pin: string;
}

export function LoginScreen() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { redirect: redirectTo } = useSearch({ from: "/login" });
  const last = sessionStore.getLastIdentity();

  const [errorCode, setErrorCode] = useState<string>();

  const formSchema = useMemo(
    () =>
      z.object({
        workspaceSlug: z.string().min(1, t("form.errors.required")),
        username: z.string().min(1, t("form.errors.required")),
        pin: z.string().min(1, t("form.errors.required")),
      }),
    [t],
  );

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      workspaceSlug: last?.workspaceSlug ?? "",
      username: last?.username ?? "",
      pin: "",
    },
  });

  async function onSubmit(values: LoginFormValues) {
    setErrorCode(undefined);
    const result = await login(values);
    if (!result.ok) {
      setErrorCode(result.code);
      form.setValue("pin", "");
      return;
    }
    sessionStore.save(result.session);
    void navigate({ to: safeInternalPath(redirectTo) ?? "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-10">
      <h1 className="text-2xl font-semibold">{t("app.name")}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>

      <Form {...form}>
        <form
          className="mt-8 flex flex-col gap-5"
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        >
          <FormField
            control={form.control}
            name="workspaceSlug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("login.workspace")}</FormLabel>
                <FormControl>
                  <Input
                    className="min-h-11"
                    autoCapitalize="none"
                    autoCorrect="off"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("login.username")}</FormLabel>
                <FormControl>
                  <Input
                    className="min-h-11"
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="username"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="pin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("login.pin")}</FormLabel>
                <FormControl>
                  <Input
                    className="min-h-11"
                    type="password"
                    inputMode="numeric"
                    autoComplete="current-password"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {errorCode !== undefined && <ErrorBanner code={errorCode} />}

          <Button
            type="submit"
            className="min-h-11"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting
              ? t("login.submitting")
              : t("login.submit")}
          </Button>
        </form>
      </Form>
    </main>
  );
}

/** Only app-internal paths may be used as post-login redirect targets. */
function safeInternalPath(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.startsWith("/") && !path.startsWith("//") ? path : undefined;
}
