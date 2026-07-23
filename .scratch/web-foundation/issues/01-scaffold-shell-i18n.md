# 01 — Scaffold: design system, shell, i18n, manifest

**What to build:** The app boots as an installable, French-first, mobile-first PWA shell. A user opens it on a phone: standalone window from the home screen, bottom tab bar with the Assets and More sections (stub content), everything labelled in French; on a desktop width the same shell renders a persistent left sidebar instead. Switching the device to English (temporary toggle is fine until the More section lands) re-renders all chrome. No business screens yet — this is the visual and structural foundation every later ticket lands on.

**Blocked by:** None — can start immediately.

**Implementation note:** run in a git worktree — a parallel session is implementing the spine in `apps/api`; this ticket touches only `apps/web`.

- [ ] Design system seeded via `pnpm dlx shadcn@latest apply --preset b0` (user-specified; verify against current shadcn CLI — preset wins on theme/fonts). Light mode only; system font stack, zero webfonts; touch targets ≥ 44px
- [ ] TanStack Router bootstrapped with typed routes; shell layout route wraps section routes
- [ ] Shell: bottom tab bar at mobile widths ↔ persistent left sidebar at desktop widths, same section data feeding both (sections hardcoded as stubs in this ticket only — ticket 04 makes them module-driven)
- [ ] i18next + ICU wired: fr-CM default, en catalog present; no sentence concatenation; chrome fully translated in both
- [ ] Web app manifest + icons: installable on Chrome/Android, standalone display; NO service worker
- [ ] Components sized against French label lengths; fr and en both render without overflow at 360px width
- [ ] `pnpm --filter @asset/web typecheck` and existing tests green

**Status:** ready-for-agent
