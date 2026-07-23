# 01 — Scaffold: design system, shell, i18n, manifest

**What to build:** The app boots as an installable, French-first, mobile-first PWA shell. A user opens it on a phone: standalone window from the home screen, bottom tab bar with the Assets and More sections (stub content), everything labelled in French; on a desktop width the same shell renders a persistent left sidebar instead. Switching the device to English (temporary toggle is fine until the More section lands) re-renders all chrome. No business screens yet — this is the visual and structural foundation every later ticket lands on.

**Blocked by:** None — can start immediately.

**Implementation note:** run in a git worktree — a parallel session is implementing the spine in `apps/api`; this ticket touches only `apps/web`.

- [x] Design system seeded via `pnpm dlx shadcn@latest apply --preset b0` (user-specified; verify against current shadcn CLI — preset wins on theme/fonts). Light mode only; system font stack, zero webfonts; touch targets ≥ 44px
- [x] TanStack Router bootstrapped with typed routes; shell layout route wraps section routes
- [x] Shell: bottom tab bar at mobile widths ↔ persistent left sidebar at desktop widths, same section data feeding both (sections hardcoded as stubs in this ticket only — ticket 04 makes them module-driven)
- [x] i18next + ICU wired: fr-CM default, en catalog present; no sentence concatenation; chrome fully translated in both
- [x] Web app manifest + icons: installable on Chrome/Android, standalone display; NO service worker
- [x] Components sized against French label lengths; fr and en both render without overflow at 360px width
- [x] `pnpm --filter @asset/web typecheck` and existing tests green

**Status:** ready-for-human

## Comments

- Implemented (2026-07-22, worktree `web-01-scaffold`): shadcn init `-b radix -p b0` + explicit `apply --preset b0 -y` (CLI confirmed "Preset applied successfully"; style `radix-nova`, preset ships self-hosted Inter via fontsource — kept per "preset wins on fonts", no CDN fetch). TanStack Router code-based routes (`/` → redirect `/assets`, `/assets`, `/more`); shell = bottom tabs (mobile) ↔ sidebar (desktop) off one `shellSections` stub list; i18next+ICU fr-CM default with `languageChanged` → `<html lang>` sync; manifest with PNG 192/512 (qlmanage-rendered from SVG) + SVG fallback, no service worker.
- Verified: typecheck + tests green (locale key-parity test added); vite build resolves; headless-browser render check at 1280px (sidebar) and 360px (bottom tabs, `scrollWidth` overflow false), fr default, language switch re-renders chrome + updates `document.documentElement.lang`.
- Code-review findings fixed pre-commit: `.js` ESM extensions on relative imports; narrative comment removed; `resolvedLanguage` compared against explicit `base` per language; `theme_color` → `#ffffff` (light-only app); PNG icons added for Chrome install heuristics. Accepted as preset output: `.dark` CSS block (never toggled), `shadcn` in dependencies (needed by `@import "shadcn/tailwind.css"`).
- Temporary by design (ticket 04 replaces): hardcoded `shellSections`, language toggle in More stub without persistence.
