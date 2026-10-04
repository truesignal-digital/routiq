import { Link } from "@tanstack/react-router";
import { Building2, ChevronRight, ShieldUser, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useMeContext } from "@/auth/me.js";
import { useSignOut } from "@/auth/sign-out.js";
import { useActiveSession } from "@/auth/store.js";
import { canViewActivities } from "@/activities/permissions.js";
import { canAdministerBranches } from "@/branches/permissions.js";
import { canAdministerMembers } from "@/members/permissions.js";
import { chooseLanguage } from "@/i18n/language.js";

const languages = [
  { code: "fr-CM", base: "fr", label: "Français" },
  { code: "en", base: "en", label: "English" },
] as const;

export function MoreStub() {
  const { t, i18n } = useTranslation();
  const session = useActiveSession();
  const me = useMeContext();
  const onLogout = useSignOut();

  return (
    <PageContainer>
      <PageHeader title={t("more.title")} />
      {session && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("more.signedInAs", { username: session.username })}
        </p>
      )}

      {/* A module the workspace never bought leaves no dead link behind
          (§3.3a): the whole section goes, rather than greying out. Users is
          gated on the role instead — CORE is never off, but who the workspace
          trusts is the admin's question alone. */}
      {(canViewActivities(me?.enabledModules) ||
        canAdministerMembers(me?.role) ||
        canAdministerBranches(me?.role)) && (
        <div className="mt-6">
          <h2 className="text-sm font-medium">{t("more.manage")}</h2>
          <nav className="mt-2 overflow-hidden rounded-xl border">
            {canViewActivities(me?.enabledModules) && (
              <Link
                to="/more/persons"
                className="flex min-h-11 items-center gap-3 px-4 py-3 text-sm hover:bg-muted"
              >
                <Users className="size-4 text-muted-foreground" aria-hidden />
                {t("more.persons")}
                <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
              </Link>
            )}
            {canAdministerMembers(me?.role) && (
              <Link
                to="/more/users"
                className="flex min-h-11 items-center gap-3 border-t px-4 py-3 text-sm first:border-t-0 hover:bg-muted"
              >
                <ShieldUser className="size-4 text-muted-foreground" aria-hidden />
                {t("more.users")}
                <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
              </Link>
            )}
            {canAdministerBranches(me?.role) && (
              <Link
                to="/more/branches"
                className="flex min-h-11 items-center gap-3 border-t px-4 py-3 text-sm first:border-t-0 hover:bg-muted"
              >
                <Building2 className="size-4 text-muted-foreground" aria-hidden />
                {t("more.branches")}
                <ChevronRight className="ml-auto size-4 text-muted-foreground" aria-hidden />
              </Link>
            )}
          </nav>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-medium">{t("more.language")}</h2>
        <div className="mt-2 flex gap-2">
          {languages.map(({ code, base, label }) => (
            <Button
              key={code}
              variant={i18n.resolvedLanguage === base ? "default" : "outline"}
              className="min-h-11"
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
        <Button variant="outline" className="min-h-11" onClick={onLogout}>
          {t("more.logout")}
        </Button>
      </div>
    </PageContainer>
  );
}
