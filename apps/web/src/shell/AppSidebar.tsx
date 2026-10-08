import { Link, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { PoweredByRoutiq, RoutiqLogo, useCompanyLogo } from "@/components/brand/routiq-logo";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { useMeContext } from "../auth/me.js";
import { NameMenu } from "./NameMenu.js";
import { activeSection, visibleSectionGroups } from "./sections.js";

/** Sheet nav items are thumb targets on mobile; the desktop rail stays compact. */
const MENU_BUTTON = "min-h-11 md:min-h-8";

export function AppSidebar() {
  const { t } = useTranslation();
  const me = useMeContext();
  const { isMobile, setOpenMobile, state } = useSidebar();
  const companyLogo = useCompanyLogo();
  const railOnly = state === "collapsed" && !isMobile;
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const groups = visibleSectionGroups(me?.role, me?.enabledModules);
  const active = activeSection(
    groups.flatMap((group) => group.sections),
    pathname,
  );

  // The sheet has no route awareness of its own: navigating from inside it
  // would otherwise leave the overlay covering the screen it just opened.
  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
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
          {groups.map((group) => (
            <SidebarGroup key={group.key}>
              <SidebarGroupLabel>{t(group.labelKey)}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.sections.map(({ key, to, labelKey, icon: Icon }) => {
                    const label = t(labelKey);
                    return (
                      <SidebarMenuItem key={key}>
                        <SidebarMenuButton
                          isActive={active?.key === key}
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
          ))}
        </nav>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem className="px-2 group-data-[collapsible=icon]:hidden">
            <PoweredByRoutiq companyLogo={companyLogo} />
          </SidebarMenuItem>
          <NameMenu />
        </SidebarMenu>
      </SidebarFooter>

      {/* The rail ships an English aria-label and title; both are overridable props. */}
      <SidebarRail aria-label={t("shell.toggleSidebar")} title={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
