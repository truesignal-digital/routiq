import { useNavigate } from "@tanstack/react-router";
import { Building2, ChevronsUpDown, LogOut, Settings, ShieldUser, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { canViewActivities } from "@/activities/permissions.js";
import { useMeContext } from "@/auth/me.js";
import { useSignOut } from "@/auth/sign-out.js";
import { canAdministerBranches } from "@/branches/permissions.js";
import { canAdministerMembers } from "@/members/permissions.js";
import { useWho, type Who } from "./who.js";

const ITEM = "min-h-11 gap-2 px-2";

export function MemberBadge({ who, className = "size-8" }: { who: Who; className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-primary font-semibold text-primary-foreground ${className}`}
    >
      {who.initial}
    </span>
  );
}

/**
 * The sidebar footer: who is signed in, and the one place to reach personal
 * settings and to sign out. On the collapsed rail the badge alone opens it.
 */
export function NameMenu() {
  const { t } = useTranslation();
  const who = useWho();
  const me = useMeContext();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  if (who === undefined) return null;

  // Leaving from inside the phone sheet would otherwise keep it covering the page.
  function go(to: string) {
    if (isMobile) setOpenMobile(false);
    void navigate({ to });
  }

  function onSignOut() {
    if (isMobile) setOpenMobile(false);
    signOut();
  }

  // role-config: until the Company group in the sidebar (#312) lands, the
  // administration pages the More page used to list are reached from here.
  const company = [
    canViewActivities(me?.enabledModules) && { to: "/more/persons", icon: Users, label: t("persons.title") },
    canAdministerMembers(me?.role) && { to: "/more/users", icon: ShieldUser, label: t("users.title") },
    canAdministerBranches(me?.role) && { to: "/more/branches", icon: Building2, label: t("branches.title") },
  ].filter((entry) => entry !== false);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              size="lg"
              className="data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground"
            />
          }
        >
          <MemberBadge who={who} />
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate font-medium">{who.name}</span>
            <span className="truncate text-xs text-muted-foreground" title={who.roleLine}>
              {who.roleLine}
            </span>
          </span>
          <ChevronsUpDown className="ml-auto" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side={isMobile ? "top" : "right"}
          align="end"
          sideOffset={8}
          className="min-w-60"
        >
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2 px-2 py-2 text-sm font-normal text-foreground">
              <MemberBadge who={who} />
              <span className="grid min-w-0 leading-tight">
                <span className="truncate font-medium">{who.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {who.workspaceName}
                </span>
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={ITEM} onClick={() => go("/my-settings")}>
            <Settings aria-hidden />
            {t("nameMenu.mySettings")}
          </DropdownMenuItem>
          {company.map(({ to, icon: Icon, label }) => (
            <DropdownMenuItem key={to} className={ITEM} onClick={() => go(to)}>
              <Icon aria-hidden />
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" className={ITEM} onClick={onSignOut}>
            <LogOut aria-hidden />
            {t("nameMenu.signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
