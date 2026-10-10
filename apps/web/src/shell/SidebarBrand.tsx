import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { RoutiqLogo } from "@/components/brand/routiq-logo";
import { SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

/**
 * The logo row. Its own module so ShellPending can draw the same row while the
 * member loads (#495) without pulling the whole sidebar into the first load.
 */
export function SidebarBrand({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  const { isMobile, state } = useSidebar();
  const railOnly = state === "collapsed" && !isMobile;
  return (
    <SidebarHeader>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="lg"
            className="group-data-[collapsible=icon]:p-1!"
            onClick={onClick}
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
  );
}
