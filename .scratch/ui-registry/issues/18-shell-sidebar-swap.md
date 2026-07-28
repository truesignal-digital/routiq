# 18 — App-wide shell swap to shadcn sidebar (dashboard-01 frame)

Status: ready-for-human
Phase: 4
Blocked by: 07

**What to build:** Replace `src/shell/AppShell.tsx`'s hand-built sidebar + bottom nav with the stock shadcn dashboard-01 frame: vendored `sidebar` component, `SidebarProvider` + inset layout, and a `SiteHeader`. Every screen renders inside the new shell. Decided with Linus 2026-07-26 (supersedes the earlier "keep AppShell" triage answer).

## Context

Reference: shadcn block `dashboard-01` — `AppSidebar` (collapsible, icon-collapse on desktop, sheet on mobile) + `SiteHeader` (sticky top bar with `SidebarTrigger`) + `SidebarInset` content area. Current shell: `src/shell/AppShell.tsx` renders a fixed sidebar ≥md plus a mobile bottom nav, driven by `visibleSections(me.data?.enabledModules)` from `src/shell/sections.ts`.

Vendor via CLI (base-nova): `pnpm --filter @routiq/web exec shadcn@latest add sidebar`. This pulls `sidebar.tsx` plus deps it declares (uses already-vendored button/input/separator/sheet/skeleton/tooltip; verify NO `@radix-ui` lands — abort and report if it does).

## Tasks

- [ ] Vendor `sidebar`; register it in registry.json (surgical edit).
- [ ] `src/shell/AppSidebar.tsx` — ROUTIQ nav over the vendored primitives: brand header, one `SidebarMenuItem` per visible section (same `visibleSections` module gating), active-route highlighting from the router (exact-or-child match — do NOT reintroduce the FinanceNav prefix bug from ticket 14's list), user/workspace footer with the logout action the current shell has.
- [ ] `src/shell/SiteHeader.tsx` — sticky header: `SidebarTrigger`, current section title (localized), right side reserved (empty for now).
- [ ] Rewrite `AppShell.tsx` as `SidebarProvider` + `AppSidebar` + `SidebarInset` (SiteHeader + outlet). Keep the auth/me loading behavior identical.
- [ ] **The mobile bottom nav is removed** — the sidebar sheet (hamburger in SiteHeader) replaces it. Keep touch targets ≥44px.
- [ ] Screens must not double-scroll or double-pad: PageContainer (ticket 07) stays the inner container; strip any per-screen top padding that now collides with SiteHeader.
- [ ] LoginScreen stays outside the shell, unchanged.
- [ ] i18n: any new strings in both fr.json/en.json (ICU, no {{}}); sidebar section labels reuse existing nav.* keys.
- [ ] Tests: shell renders sections per enabledModules (existing AppShell tests migrate); active item matches route exactly; trigger opens the sheet in mobile viewport (jsdom matchMedia mock pattern already exists in data-table tests).

## Acceptance

- [ ] `grep -rn "@radix-ui" apps/web pnpm-lock.yaml` returns nothing
- [ ] All screens render inside SidebarInset; no bottom nav remains
- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests green

## Out of scope

Dashboard home content (ticket 15), breadcrumbs, user avatar menu, dark mode.

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 18). Base UI sidebar vendored (pnpm dlx, not exec — ticket command wrong); zero radix; bottom nav removed, sheet + 44px targets on mobile; exact-segment matcher in sections.ts with match:"/finance"; sr-only strings localized in vendored file (dialog.tsx precedent); rail labels overridden via props. 459 tests. Note: MoreStub has a duplicate logout (More screen rework will absorb it).
