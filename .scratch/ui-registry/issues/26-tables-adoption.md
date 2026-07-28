# 26 — Adopt table foundations on every list screen

Status: ready-for-human
Phase: 5
Blocked by: 24, 25

**What to build:** Wire DataTable v3 (ticket 25) + sortable reads (ticket 24) into every table screen, with role-gated row actions.

## Per screen

- **Entries**: primary column N° écriture (`entryNumber`, add it — currently missing as a column); sortable headers economicDate/postedAt/amount/entryNumber → server sort param, cursor resets on change; keyset pager; primary cell opens the existing drawer (full-screen action kept); rowActions: « Voir en plein écran » always; « Extourner » only when POSTED and me can approve (mirror detail screen's reverse gate — navigate to detail with the reverse dialog, don't re-implement the dialog inline).
- **Approvals**: primary column N° écriture; server sort submittedAt/amount/entryNumber; keyset pager; rowActions replace the inline Approuver/Rejeter buttons (⋯ menu: approve, reject — approver-gated as today; keep maker-guard: the menu omits approve for the maker and the badge stays).
- **Periods**: primary column Période (non-hidable; no drawer — it has no detail: primary cell is plain non-interactive emphasis text, allowed by 25's config when neither rowViewer nor onRowClick is set); client sort + full pager stay; rowActions: Verrouiller/Rouvrir replacing the inline buttons, gated as today.
- **Dashboard recent entries**: primary column N° écriture opening the entries drawer OR navigating to detail (match entries screen behavior); no sort controls (server default order), no pager (first page + « Voir toutes les écritures » link stays).
- Update `useEntries`/`useApprovals` to pass sort + reset pages when sort changes; approvals hook gains params.

## Tasks

- [ ] All of the above; delete the interim compatibility shims from 25 if any.
- [ ] i18n fr+en ICU for new labels (N° écriture, action labels). Role gates use existing me predicates; leave a `// role-config` comment at each gate for the future roles section.
- [ ] Tests per screen: sort toggle sends the param + resets to page 1; pager prev/next; primary column visible in every view-menu state; row-body click inert; actions menus per role (approver vs submitter vs maker); maker-guard preserved; existing command-routing tests stay green.

## Acceptance

- [ ] `pnpm --filter @routiq/web test && pnpm typecheck` green; jsdom command-routing green.
- [ ] Browser walk: sort by Montant on entries reorders server-side; approvals actions in ⋯ menu; periods lock via menu.

## Out of scope

Assets card grid → table conversion, documents screen, role administration UI.

## Comments

- 2026-07-27 Opus worker: committed (ui-registry 26). Two bugs exposed+fixed during adoption: display columns can never sort in TanStack (amount columns gained accessorKey), and the screen-placed view menu could hide the primary column (DataTableViewOptions now filters it). Reversal reaches the existing detail dialog via ?reverse=1 search param. Maker gets NO menu (no self-reject — stricter current behavior preserved, confirmed). Amount sort opens desc (money-useful default). Browser-verified: server sort, both menus, pager. 655 tests.
