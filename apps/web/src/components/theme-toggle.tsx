import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import { isThemeMode, type ThemeMode } from "@/lib/theme";
import { cn } from "@/lib/utils";

const themeOptions: ReadonlyArray<{
  mode: ThemeMode;
  icon: LucideIcon;
  labelKey: string;
}> = [
  { mode: "light", icon: Sun, labelKey: "mySettings.appearance.light" },
  { mode: "dark", icon: Moon, labelKey: "mySettings.appearance.dark" },
  { mode: "system", icon: Monitor, labelKey: "mySettings.appearance.system" },
];

/** The full three-option control, for a settings screen. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();

  return (
    <div
      role="group"
      aria-label={t("mySettings.appearance.label")}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {themeOptions.map((option) => {
        const selected = option.mode === mode;
        const Icon = option.icon;
        return (
          <Button
            key={option.mode}
            type="button"
            variant={selected ? "default" : "outline"}
            aria-pressed={selected}
            onClick={() => setMode(option.mode)}
          >
            <Icon aria-hidden />
            {t(option.labelKey)}
          </Button>
        );
      })}
    </div>
  );
}

/** The compact header form: current theme as an icon, the three modes behind it. */
export function ThemeToggleMenu({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { mode, resolvedTheme, setMode } = useTheme();
  const TriggerIcon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("mySettings.appearance.label")}
            className={cn("md:size-8", className)}
          />
        }
      >
        <TriggerIcon aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            if (isThemeMode(value)) setMode(value);
          }}
        >
          {themeOptions.map((option) => {
            const Icon = option.icon;
            return (
              <DropdownMenuRadioItem
                key={option.mode}
                value={option.mode}
                closeOnClick
              >
                <Icon aria-hidden />
                {t(option.labelKey)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
