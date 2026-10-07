import { Link, useRouterState } from "@tanstack/react-router";
import { Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
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
import { NameMenu } from "./NameMenu.js";
import { isSectionActive, visibleSections } from "./sections.js";

/** Sheet nav items are thumb targets on mobile; the desktop rail stays compact. */
const MENU_BUTTON = "min-h-11 md:min-h-8";

export function AppSidebar() {
  const { t } = useTranslation();
  const me = useMeContext();
  const { isMobile, setOpenMobile } = useSidebar();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const sections = visibleSections(me?.enabledModules, me?.role);

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
              className="group-data-[collapsible=icon]:p-1.5!"
              onClick={closeOnMobile}
              render={<Link to="/" />}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
                <Truck className="size-5" strokeWidth={1.8} aria-hidden />
              </span>
              <span className="font-heading text-base font-semibold tracking-tight">
                {t("app.name")}
              </span>
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
          <NameMenu />
        </SidebarMenu>
      </SidebarFooter>

      {/* The rail ships an English aria-label and title; both are overridable props. */}
      <SidebarRail aria-label={t("shell.toggleSidebar")} title={t("shell.toggleSidebar")} />
    </Sidebar>
  );
}
