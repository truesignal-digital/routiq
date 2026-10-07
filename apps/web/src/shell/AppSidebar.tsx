import { Link, useRouterState } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PoweredByRoutiq, RoutiqLogo, useCompanyLogo } from "@/components/brand/routiq-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useMeContext } from "../auth/me.js";
import { useSignOut } from "../auth/sign-out.js";
import { useActiveSession } from "../auth/store.js";
import { isSectionActive, visibleSections } from "./sections.js";

/** Sheet nav items are thumb targets on mobile; the desktop rail stays compact. */
const MENU_BUTTON = "min-h-11 md:min-h-8";

export function AppSidebar() {
  const { t } = useTranslation();
  const me = useMeContext();
  const session = useActiveSession();
  const signOut = useSignOut();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const companyLogo = useCompanyLogo();
  const railOnly = state === "collapsed" && !isMobile;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sections = visibleSections(me?.enabledModules, me?.role);

  // The sheet has no route awareness of its own: navigating from inside it
  // would otherwise leave the overlay covering the screen it just opened.
  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  function onLogout() {
    closeOnMobile();
    signOut();
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="group-data-[collapsible=icon]:p-1!"
              onClick={closeOnMobile}
              render={<Link to="/" />}
            >
              <RoutiqLogo
                markClassName="size-8! group-data-[collapsible=icon]:size-6!"
                markTitle={railOnly ? t("brand.mark") : undefined}
                wordmarkClassName="text-base group-data-[collapsible=icon]:hidden"
              />
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <nav aria-label={t("shell.navLabel")}>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {sections.map((section) => {
                  const { key, to, icon: Icon } = section;
                  const label = t(`nav.${key}`);
                  return (
                    <SidebarMenuItem key={key}>
                      <SidebarMenuButton
                        isActive={isSectionActive(section, pathname)}
                        tooltip={label}
                        className={MENU_BUTTON}
                        onClick={closeOnMobile}
                        render={<Link to={to} />}
                      >
                        <Icon aria-hidden />
                        <span>{label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {session && (
            <SidebarMenuItem>
              <div className="flex min-w-0 flex-col px-2 py-1 group-data-[collapsible=icon]:hidden">
                <span className="truncate text-sm font-medium">{session.username}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {session.workspaceSlug}
                </span>
              </div>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem className="px-2 group-data-[collapsible=icon]:hidden">
            <PoweredByRoutiq companyLogo={companyLogo} />
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip={t("more.logout")}
              className={MENU_BUTTON}
              onClick={onLogout}
            >
              <LogOut aria-hidden />
              <span>{t("more.logout")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      {/* The rail ships an English aria-label and title; both are overridable props. */}
      <SidebarRail aria-label={t("shell.toggleSidebar")} title={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
