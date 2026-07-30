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
  { mode: "light", icon: Sun, labelKey: "more.theme.light" },
  { mode: "dark", icon: Moon, labelKey: "more.theme.dark" },
  { mode: "system", icon: Monitor, labelKey: "more.theme.system" },
];

/** The full three-option control, for a settings screen. */
export function ThemeToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const { mode, setMode } = useTheme();

  return (
    <div
      role="group"
      aria-label={t("more.theme.label")}
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
            className="min-h-11"
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
            aria-label={t("more.theme.label")}
            className={cn("size-11 md:size-8", className)}
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
