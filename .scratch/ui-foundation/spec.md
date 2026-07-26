# Spec: UI Foundation — primitives, tables, toasts, dialogs, attachments (Base UI)

Status: ready-for-agent
Source: Linus 2026-07-26 — "the UI is not really scalable… data-tables where necessary, toasts where necessary, dialog boxes should have action buttons or something to cancel out, shadcn attachments, fix the fundamentals so it can be scalable and maintainable."

## Problem

Screens shipped faster than the foundation under them. Current inventory: three ui primitives (button/input/label), no radix, no toast layer, no table component. Consequences visible everywhere: three screens hand-roll modal markup with no focus trap, no ESC/overlay close, and inconsistent buttons; row-action feedback is a mix of success dialogs and inline banners; the entries/approvals lists are bespoke card stacks that cannot grow columns; forms are split between react-hook-form (assets) and raw useState (finance); attachments have one custom field. Every new screen re-invents these, and every re-invention is a new bug surface (the intent-misrouting bug lived in exactly this kind of per-screen plumbing).

## Constraints that shape the design

- **Mobile-first on low-end Android** (ARCHITECTURE §6): data-tables are a desktop density win but must degrade on phones. Every table has a card rendering below `sm` via column `meta` — never horizontal scrolling as the primary mobile experience.
- **Keyset pagination is the house read pattern**: the table exposes a "load more" footer wired to useInfiniteQuery. NO client-side sorting or filtering on paginated data (lying to the user about the dataset) — server order only, until a read view supports sort params.
- **fr-CM first**: all new component strings via locale keys; primitives take labels as props, never bake text.
- **Pinned deps** (CLAUDE.md §8): new packages pinned exact. **Headless layer is Base UI (`@base-ui/react` 1.6.0), NOT Radix** — components.json is configured with the shadcn `base-nova` style; add components via the shadcn CLI so it vendors the Base UI-backed versions, and never introduce @radix-ui packages.
- **Command outcomes carry meaning**: POSTED vs SUBMITTED on the record screen is a business state the user must read — it stays a full outcome view. Toasts are for row actions whose context is the list they happened in.

## Design

### 1. Primitives (`components/ui/`, shadcn base-nova / Base UI, ticket 01)

Add: `dialog`, `alert-dialog`, `select`, `textarea`, `badge`, `card`, `table`, `skeleton`, `sonner` (toaster), `form` (RHF wrapper), `separator`. Mount `<Toaster richColors position="top-center" />` once in the app shell. Nothing speculative beyond this consumed set.

### 2. DataTable (ticket 02)

`components/data-table.tsx` on @tanstack/react-table (pin exact) + shadcn table:
- Props: `columns` (ColumnDef with `meta.mobile: "primary" | "secondary" | "hidden"`), `data`, `onRowClick`, `loadMore: { hasNextPage, isFetching, onLoadMore }`, `emptyState`.
- ≥sm: real `<table>`, sticky header. <sm: rows render as cards — primary meta fields prominent, secondary as caption line, hidden dropped.
- Row click = navigation; no row checkboxes/bulk actions yet (nothing consumes them).
- Migrations in this ticket: entries list, approvals list. Periods stays a simple shadcn table (no pagination).

### 3. Toasts (ticket 03, with dialogs)

`lib/notify.ts`: `notifyCommandSuccess(messageKey)`, `notifyCommandWarnings(warnings)` (one warning toast per stable code, localized), `notifyCommandError(code)` for errors that don't belong to a form field. Row actions (approve, reject, reverse, lock, reopen) replace their success dialogs/banners with toasts. Version-conflict refetch keeps its inline explanation. Record screen outcome view unchanged.

### 4. Dialogs (ticket 03)

Every hand-rolled modal migrates:
- Pure confirmation (lock period) → `AlertDialog` — title, description, `Cancel` + destructive-variant action.
- Input dialogs (reject reason, reverse reason, reopen reason, approve note) → `Dialog` with `DialogFooter`: `Annuler` (always) + submit button, disabled while invalid/submitting. ESC and overlay close = cancel. Focus trapped, returns to trigger (Base UI default).
- The shared validators (validateReversalReason etc.) stay the single source of enable/disable truth.

### 5. Forms (ticket 04)

One pattern: react-hook-form + zodResolver + shadcn `Form` components. Migrate FinanceRecordScreen off raw useState; native selects swap to shadcn `Select`; textareas to `Textarea`; status chips to `Badge` variants. AssetRegisterScreen aligns visually but keeps its working RHF core (touch only what shadcn Form wrapping requires).

### 6. Attachments (ticket 05)

`components/ui/file-upload.tsx`, shadcn-styled dropzone: click/drag, capture-friendly on mobile (`accept="image/*"` pass-through for camera), list with name/size/thumbnail for images, per-file progress, remove, error per file — wrapping the EXISTING upload logic (`artifacts/upload.ts` — presigned flow stays untouched). `AttachmentField` becomes a thin wrapper or is replaced where used (documents screen); record screen gains the optional attachment slot feeding `sourceArtifactIds` (evidence policy §5.4 — attaching a receipt clears the EVIDENCE_MISSING warning path).

### 7. Screen scaffolds (ticket 06)

`components/page.tsx`: `PageHeader` (title, back, right-slot actions), `EmptyState` (icon, message, optional CTA), `ErrorState` (message + retry), `LoadingState` (skeletons). Sweep all screens onto them; delete the copy-pasted variants. Regression: full web suite + the jsdom command-routing tests must stay green — this refactor must not touch any command/intent logic.

## Non-goals

Theming/dark mode; bulk table actions; client-side sort/filter; virtualized lists; Storybook; redesign of layouts or flows — this is the same UI on real foundations. No API changes of any kind.

## Tickets

| # | Ticket | Blocked by |
|---|---|---|
| 01 | Primitives + toaster mount | — |
| 02 | DataTable + entries/approvals migration | 01 |
| 03 | Dialog migration + action toasts | 01 |
| 04 | Form standardization (record screen) | 01 |
| 05 | File-upload component + wiring | 01 |
| 06 | Page scaffolds + sweep + regression | 02–05 |
