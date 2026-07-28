# 23 — Breadcrumbs in SiteHeader, drop Retour + Saisie tab, unify finance widths

Status: ready-for-human
Phase: 4
Blocked by: —

**What to build:** (Linus, 2026-07-27) Replace the per-screen « Retour » back arrow with a breadcrumb in the SiteHeader; remove the Saisie tab (the « Saisir une écriture » action button owns that entry point); unify finance screen widths.

## Tasks

- [ ] Vendor `breadcrumb` via pnpm dlx shadcn@latest add breadcrumb (base-nova, Base UI/plain DOM — zero @radix-ui; localize any hardcoded English per dialog/sidebar precedent). Register in registry.json.
- [ ] SiteHeader renders a breadcrumb instead of the plain section title: `Accueil / <section> / <page>` — derived from the router state + sections (reuse lib/route-match.ts logic; e.g. /finance/entries → Accueil / Finances / Écritures; /finance/entries/$id → ... / Écritures / <entryNumber or generic "Détail">; /assets/new → Accueil / Actifs / Nouvel actif; / → just Accueil). Each ancestor is a router Link; current page is BreadcrumbPage. Localized labels reuse nav.* / finance.navigation.* keys.
- [ ] Delete every per-screen « Retour » back link/button (grep for the back/retour pattern in screens + PageHeader's back affordance if it has one). Screens keep their PageHeader h1.
- [ ] FinanceNav: remove the Saisie tab — three tabs remain (Écritures, Approbations, Périodes). FinanceRecordScreen no longer renders FinanceNav (it is an action page reached from « Saisir une écriture »; breadcrumb shows Accueil / Finances / Saisie). Update activeFinanceSection accordingly (no tab active on /finance/record — and no crash).
- [ ] Widths: FinancePeriodsScreen → PageContainer wide (matches entries/approvals). FinanceRecordScreen → PageContainer wide with the form constrained to an inner readable column (~max-w-xl, form ergonomics — the container aligns with every other finance page, the fields don't stretch). FinanceEntryDetailScreen stays default for now unless trivial to align.
- [ ] i18n fr+en ICU for any new keys (breadcrumb detail labels). Strict TS.
- [ ] Tests: SiteHeader breadcrumb per route (entries, detail, record, assets, home — links + current page); no Retour remains (grep-style or render assertions); FinanceNav has exactly 3 tabs and /finance/record activates none; periods/record containers are wide; existing nav/tab tests updated.

## Acceptance

- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing tests green; zero @radix-ui
- [ ] No « Retour » anywhere; breadcrumb wayfinding on every screen inside the shell

## Out of scope

Mobile breadcrumb truncation beyond stock behavior, More screen, entry-detail width redesign.

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 23). breadcrumbTrail returns translation keys (i18n-free unit tests); home-dedup caught by tests; PageHeader back props deleted at the type level; Saisie removed from FinanceSectionKey union so it can't silently return. 628 tests. Verified in browser. Watch item: 4-crumb trail truncation on narrow viewports (flex-nowrap + truncate — stock behavior kept).
