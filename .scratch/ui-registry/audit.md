# ROUTIQ web UI consistency audit (2026-07-26)

Produced by an Explore agent over `/Users/linusbayere/Developer/routiq/apps/web`. Input to the ui-registry spec and tickets. Line numbers are as of commit 5a5e114.

## 1. Inventory of `src/components/ui/`

Fifteen components. All are Base UI-backed or plain DOM — no `@radix-ui` anywhere, so the Base UI rule holds.

| File | Backing | Origin |
|---|---|---|
| `alert-dialog.tsx` | `@base-ui/react/alert-dialog` | vendored (base-nova) |
| `badge.tsx` | `useRender`/`mergeProps` | vendored |
| `button.tsx` | `@base-ui/react/button` | vendored |
| `card.tsx` | plain div | vendored |
| `dialog.tsx` | `@base-ui/react/dialog` | vendored |
| `input.tsx` | `@base-ui/react/input` | vendored |
| `label.tsx` | plain label | vendored |
| `select.tsx` | `@base-ui/react/select` | vendored |
| `separator.tsx` | `@base-ui/react/separator` | vendored |
| `skeleton.tsx` | plain div | vendored |
| `sonner.tsx` | sonner | vendored, then edited |
| `table.tsx` | plain table | vendored |
| `textarea.tsx` | plain textarea | vendored |
| `form.tsx` | react-hook-form | **hand-written, not base-nova** |
| `file-upload.tsx` | none | **hand-written** (commit 05ba827) |

Two components are dead code: **`card.tsx` and `separator.tsx` have zero consumers.** Every card surface in the app is hand-rolled `rounded-xl border border-border bg-card p-4` markup instead.

### `form.tsx` divergence

`src/components/ui/form.tsx` is the legacy shadcn v0-era form (forwardRef, `space-y-2`), not the base-nova version, and modified in contract-breaking ways:

- `FormField` wraps children in `<Controller render={() => <div>{children}</div>}>` — the controller's `field` props (`value`, `onChange`, `ref`) are discarded. Every consumer wires inputs manually with `form.register()` or `form.watch()`+`form.setValue()`; `FinanceRecordScreen` mixes both styles.
- `FormControl` destructures `formItemId`, `formDescriptionId`, `formMessageId` and **uses none of them** — renders a bare `<div data-testid="form-control">`. Inputs get no `aria-invalid` / `aria-describedby`. Accessibility regression vs stock shadcn.
- `form.test.ts` asserts essentially nothing; `dialog.test.ts` similarly thin.

## 2. DataTable

`src/components/data-table.tsx` (203 lines, tested in `data-table.test.tsx`). TanStack Table v8 (`@tanstack/react-table` 8.21.3 pinned), only `getCoreRowModel`.

Present:
- Responsive dual render: real `<Table>` ≥640px, stacked cards below, via `useDesktopMediaQuery` (line 180) and module-augmented `ColumnMeta.mobile: "primary" | "secondary" | "hidden"` (line 25).
- Row click w/ keyboard (Enter/Space, line 169).
- Cursor "Load more" via `loadMore` prop (line 154).
- `emptyState` prop replacing the whole table when empty (line 57).

Absent: sorting, filtering, column visibility, row selection, offset pagination, per-column alignment, sticky first column, density.

Consumers: exactly two — `FinanceEntriesScreen.tsx:171`, `FinanceApprovalsScreen.tsx:247`. Both build `ColumnDef[]` inline in `useMemo` keyed on `[i18n.resolvedLanguage, t]`.

`data-table.tsx:162` renders hardcoded English: `{loadMore.isFetching ? "Loading…" : "Load more"}` — bug in fr-CM-default app.

## 3. Screen-by-screen patterns

| Screen | List/table | Layout | Forms | Dialogs / toasts |
|---|---|---|---|---|
| `AssetsStub.tsx` | hand-rolled card grid, `AssetCard` line 283 | bespoke full-bleed hero, `max-w-6xl`, `PageHeader` nested inside (line 62) | raw `<input type=search>` line 109 | inline panels via `AssetActions`, no toasts |
| `AssetRegisterScreen.tsx` | — | `max-w-xl`, `PageHeader` line 121 | RHF + vendored `Form`, but 4 raw `<select>` (143, 164, 186, 322) | none; navigates on success |
| `AssetDocumentsScreen.tsx` | grouped hand-rolled card list (line 134) | `max-w-3xl`, `PageHeader` line 82 | `useState`-only form, `Label`+`Input`, raw `<select>` line 299 | inline form panel, no dialog/toast |
| `FinanceEntriesScreen.tsx` | **DataTable** | `max-w-4xl`, `PageHeader` + `FinanceNav` | filter bar of raw `<select>`+`<input>` (116–155) | none |
| `FinanceApprovalsScreen.tsx` | **DataTable** | `max-w-4xl` (denied branch `max-w-3xl`, line 216) | `useState` + raw `<textarea>` in dialog (341, 352) | `Dialog` + `notifyCommandSuccess`/`Warnings` |
| `FinancePeriodsScreen.tsx` | raw `Table` primitives (line 160) | `max-w-3xl` | `useState` + raw `<textarea>` (343) | `AlertDialog` lock, `Dialog` reopen, toasts |
| `FinanceEntryDetailScreen.tsx` | `<dl>` grid (line 127) | `max-w-3xl` | `useState` + raw `<textarea>` (352) | `Dialog` + toasts |
| `FinanceRecordScreen.tsx` | — | `max-w-3xl` | RHF + `Form` + Base UI `Select` + `Textarea` — only screen using them | inline `OutcomeView` success panel (552), no toast |
| `LoginScreen.tsx` | — | outside `AppShell`, `max-w-sm` `<main>`, no `PageHeader` | `useState` + `Label`/`Input`, no `Form` | none |
| `MoreStub.tsx` | — | `max-w-3xl`, `PageHeader` | — | none |

Shared scaffolding: `src/components/page.tsx` (`PageHeader`, `EmptyState`, `ErrorState`, `LoadingState`). Adoption 8/10 screens, but **no page-container component** — container class repeated by hand.

## 4. Inconsistencies

### 4.1 Money — four implementations, divergent output
- `FinanceEntriesScreen.tsx:198` local `formatAmount(minor, signDisplay)` → `+150 000`.
- `FinanceApprovalsScreen.tsx:276` local `formatAmount`, no sign → `150 000` for same entry.
- `FinanceEntryDetailScreen.tsx:55` inline closure, `signDisplay: "always"`.
- `finance/model.ts:15` `formatMoneyXaf` — no sign, normalises U+202F; used only for amount-input blur (`FinanceRecordScreen.tsx:385`).
- `packages/domain/src/money.ts:14` `formatXAF` — canonical, imported by one screen (`AssetRegisterScreen.tsx:33`).

All hardcode `"fr-CM"` (ignore language switch). Currency appended by hand (`{formatAmount(...)} {row.original.currency}`).

### 4.2 Dates — three renderings, none locale-aware
- Raw ISO from API: `FinanceEntriesScreen.tsx:56-58`, `FinanceEntryDetailScreen.tsx:162`, `AssetDocumentsScreen.tsx:202-204`.
- `new Date(x).toLocaleDateString()` no locale arg (follows browser, not i18next): `FinanceApprovalsScreen.tsx:76`, `FinancePeriodsScreen.tsx:224`, `FinanceEntryDetailScreen.tsx:170`.
- Raw ISO in ICU message: `AssetDocumentsScreen.tsx:162-165`.

No date helper in `src/lib/`.

### 4.3 Status badges — three implementations
- `finance/FinanceStatusBadge.tsx` — on vendored `Badge`, status→variant. Only proper one.
- `AssetsStub.tsx:31-38` `statusStyles` hardcoded palette classes, hand-rolled pill line 315.
- `AssetDocumentsScreen.tsx:27-32` `expiryBadgeStyles`, different pill markup line 154.
- Ad-hoc text badges: late-posting flag `FinanceEntriesScreen.tsx:47`, maker-guard note `FinanceApprovalsScreen.tsx:109` — both `text-amber-900`, different sizes.

### 4.4 Error banners — six variants
- `div role="alert"` + icon + `rounded-md bg-destructive/10 p-3 text-sm`: `FinanceApprovalsScreen.tsx:329`, `FinancePeriodsScreen.tsx:294`,`:331`, `FinanceEntryDetailScreen.tsx:340`, `FinanceRecordScreen.tsx:287`.
- `p role="alert"` + `rounded-lg ... px-4 py-3`, no icon: `AssetRegisterScreen.tsx:377`, `AssetDocumentsScreen.tsx:361`.
- Bare `p role="alert" text-sm text-destructive`: `LoginScreen.tsx:83`.
- `rounded-lg ... px-3 py-2 text-xs`: `AssetActions.tsx:113`.

Error-code resolution differs: most use `errorMessage(i18n, code)` (`lib/error-message.ts`, safe fallback), but `FinanceApprovalsScreen.tsx:334`, `FinancePeriodsScreen.tsx:300`,`:337` use `` t(`errors.${error}`, { defaultValue: error }) `` — unmapped codes render **raw error code to user**. Violates "stable codes, never English strings".

### 4.5 Success feedback — toast vs inline
Toasts (`lib/notify.ts` → sonner) only in approve/reject/lock/reopen/reverse. Other mutating flows inline: `FinanceRecordScreen` `OutcomeView` (552), `AssetActions` panels (92–111), `AssetRegisterScreen` (silent navigate), `AssetDocumentsScreen` (silent close). Warnings: toast in half, green-box list in `FinanceRecordScreen.tsx:585-605`.

### 4.6 Form controls barely adopted
- **Select**: Base UI `Select` in 1 screen (FinanceRecord, 3 fields). Six sites raw `<select>` w/ copy-pasted `min-h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm`: `AssetRegisterScreen.tsx:143,164,186,322`, `AssetDocumentsScreen.tsx:299`, `FinanceEntriesScreen.tsx:116`; `AssetActions.tsx:125` another size (`min-h-9 text-xs`).
- **Textarea**: vendored used once (`FinanceRecordScreen.tsx:478`). Four dialogs raw `<textarea>` `min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm`.
- **Field wrapper**: RHF `FormItem`/`FormLabel`/`FormMessage` in 2 screens; plain `div.flex.flex-col.gap-2` + `Label` in five others (Login, AssetDocuments, all dialogs).

### 4.7 Two file-upload components
`components/ui/file-upload.tsx` (dropzone, previews, progress) and `artifacts/AttachmentField.tsx` (button+list, sha256, retry). Both live: `AttachmentField` in `AssetRegisterScreen.tsx:374`; `FileUpload` in `FinanceRecordScreen.tsx:527`, `AssetDocumentsScreen.tsx:354`. Near-identical props (`onChange`, `onUploadingChange`, `uploadImpl`), different i18n namespaces (`attachments.*` vs `fileUpload.*`). `AttachmentField` is the un-migrated predecessor.

### 4.8 Permission-denied — four shapes, two flash
- `EmptyState` + `errorMessage(i18n, "MODULE_DISABLED")`: `FinanceRecordScreen.tsx:66`, `FinanceEntriesScreen.tsx:92`, `AssetDocumentsScreen.tsx:71`.
- `EmptyState` + screen-specific `accessDenied` key: `FinanceApprovalsScreen.tsx:218`, `FinancePeriodsScreen.tsx:125`.
- Guard bug: `FinanceRecordScreen.tsx:62` / `FinanceEntriesScreen.tsx:88` correctly wait `me !== undefined && !canX`; `FinancePeriodsScreen.tsx:121` / `FinanceApprovalsScreen.tsx:214` use bare `!canX` → **flash "access denied" on every load** before `/v1/me` resolves.

### 4.9 Containers and surfaces
Widths: `max-w-xl` (asset form), `max-w-3xl` (five screens), `max-w-4xl` (two finance lists), `max-w-6xl` (assets hero); `FinanceApprovalsScreen` differs between denied branch (3xl, line 216) and main (4xl, line 228).
Cards: `rounded-xl border border-border bg-card p-4` (finance, e.g. `FinanceEntryDetailScreen.tsx:126`) vs `rounded-2xl border border-foreground/10 bg-card shadow-[0_12px_34px_-30px_var(--foreground)]` (`AssetsStub.tsx:292`). Border `border-border` mostly, `border-foreground/10` in AssetsStub/AssetActions.

### 4.10 Import style
`components/ui/*` use `@/` alias; screens mix alias and relative ESM (`../lib/utils.js`). `AppShell.tsx:3` vs `AssetsStub.tsx:27` import `cn` differently.

## 5. Data fetching

Uniform TanStack Query v5, one hook per resource (`assets/useAssets.ts`, `assets/reference.ts`, `finance/useEntries.ts`/`useEntry.ts`/`useApprovals.ts`/`usePeriods.ts`, `documents/useDocuments.ts`/`useCategories.ts`). Workspace-scoped keys `["ws", session?.workspaceSlug, ...]`, token from `sessionStore`, injectable `fetchImpl`, errors thrown as `RESOURCE_${status}`.

Deviations:
1. `useAssets.ts:26-30` returns custom `{ status, assets, retry }` shape — `AssetsStub.tsx:142-149` string-compares; loses `isFetching`, error details.
2. Invalidation: blanket `["ws"]` in `AssetDocumentsScreen.tsx:106`, `FinanceEntryDetailScreen.tsx:97`, `AssetActions.tsx:56` vs targeted `["ws", slug, "assets"]` in `AssetRegisterScreen.tsx:107-109`.
3. Hand-rolled optimistic removal: local `Set` of removed ids in `FinanceApprovalsScreen.tsx:52`, `FinancePeriodsScreen.tsx:70`.

**Filtering split:** finance entries pass real query params (`useEntries.ts:18-22`: `status`, `periodCode`, `assetId`, `branchId`, `cursor`) honored by `apps/api/src/reads/finance.ts:79-105` with keyset pagination. `/v1/assets` (`apps/api/src/reads/assets.ts:22`) accepts **no query params**, returns full unpaginated list; `AssetsStub` filters client-side via `assetMatches` (`assets/model.ts:38`).

Entries filter bar: no debounce (network per keystroke, `FinanceEntriesScreen.tsx:140,154`); asset filter is free-text UUID box (line 152).

## 6. Styling tokens

CSS-first config in `src/styles.css`. `@theme inline` (6-47) maps shadcn token set + radius scale off `--radius: 0.75rem`. Light theme (49-84): warm paper bg, green primary, oklch.

Problems:
1. **`--signal` half-token** (82-83): not in `@theme inline`, not in `.dark`; used as arbitrary values `bg-[var(--signal)]` (`AssetsStub.tsx:59,171,233`).
2. **Dark mode dead + wrong**: `.dark` (86-118) is stock neutral shadcn — no brand carry-over; nothing sets `.dark`; `sonner.tsx:5` hardcodes `theme="light"`.
3. **`--font-heading: var(--font-sans)`** (line 7) — base-nova `font-heading` no-op.
4. **Hardcoded palette colors in 8 files**: `AssetsStub.tsx:32-37` (sky/emerald/amber/stone/red), `AssetDocumentsScreen.tsx:28-30`,`:366`, `FinanceRecordScreen.tsx:564-592` (green-* panel, amber-50 warnings), `FinanceEntryDetailScreen.tsx:257,271` (blue-600 links), `FinanceEntriesScreen.tsx:47`, `FinanceApprovalsScreen.tsx:109` (amber-900), `AssetActions.tsx:93,101`, `file-upload.tsx:225` (emerald-600). No success/warning/info semantic tokens — only `destructive`.

Arbitrary shadows/tracking inlined in `AssetsStub` (`shadow-[0_16px_44px_-36px_var(--foreground)]`, `tracking-[0.19em]`, `text-[0.68rem]`).

## 7. i18n

i18next + ICU, `lng: "fr-CM"`, `fallbackLng: "fr"`; Zod locale rebound on `languageChanged` (`src/i18n/index.ts:27-38`). Key parity exact: 323 = 323.

Leaks:
- `data-table.tsx:162` hardcoded English.
- `dialog.tsx`: `sr-only` "Close" + literal `Close` in `DialogFooter`, never localized.
- `FinanceEntryDetailScreen.tsx:186` renders raw `paymentMethod` enum (`MOMO`); record form translates via `finance.record.paymentMethods.*` (`FinanceRecordScreen.tsx:427`).
- `FinanceEntryDetailScreen.tsx:259,273` raw UUIDs as link text.
- `labelFr`/`labelEn` ternary duplicated in 8 places: `AssetsStub.tsx:285-288`, `FinanceEntriesScreen.tsx:63-66`, `FinanceApprovalsScreen.tsx:82-85`, `FinanceRecordScreen.tsx:184-185`, `AssetDocumentsScreen.tsx:64-65`,`:256-257`, `FinanceEntryDetailScreen.tsx:50-51`, `AssetRegisterScreen.tsx:113-114`.
- `MoreStub.tsx:7-10` endonyms — correct as-is.
