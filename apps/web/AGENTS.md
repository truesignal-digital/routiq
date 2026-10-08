# apps/web — conventions

Read this with the root [`AGENTS.md`](../../AGENTS.md). Each row names the one way to do a common job in the web app. When you find a second way already in the code, follow this table, not the neighbour.

## Paved paths

| Job | The one way | Never |
|---|---|---|
| Read server data | A TanStack Query hook per resource in its feature folder (e.g. `assets/useAssets.ts`) over a fetch function typed from `@routiq/contracts`. Check responses with structural guards (`is*` functions typed from the contract's types). | Parsing responses with the contract's Zod schemas: test fixtures use ids like `"a1"`, and the server's uuid columns already guarantee the format. |
| Write data | A command through `commandClient` and `createCommandIntent` (`src/commands/`). Render server truth plus the pending state from the command status store (ADR-0001). | `useMutation`, raw `fetch` POSTs, or optimistic cache patches (`setQueryData`, `onMutate`). |
| Forms | `useCommandForm(payloadSchema, command, version, { defaults })` from `components/use-command-form.ts`: react-hook-form validated by the contract's payload schema, one command intent per opening, spread onto `CommandForm`; fields through `components/ui/form.tsx`. Its test runs `describeCommandForm` from `src/test/form-harness.ts` (the six tests; guard `H17`). `vehicle/forms/AddNoteForm.tsx` is the example. | Re-typing a rule the API enforces. Hand-written copies drifted in #19 and #22. |
| Form surface | Recording or editing a fact opens the side panel: `CommandForm surface="sheet"` (or `"panel"` inside a record panel), or `FormPanel` for a form that draws its own fields; 440 px, 560 for Line items, bottom sheet on phone. Closing with typed data asks to discard. A centred dialog only for a decision on an existing record. Guard `H18` (`DECISION_SURFACES` in `tools/guards/rules.ts`). | A centred dialog for a create form; a page for a short form. |
| Feedback after a command | `notifyCommandSuccess` / `notifyCommandError` from `lib/notify.ts`. `shell/AppShell.tsx` mounts the only `<Toaster />`. | Importing `components/ui/toast` elsewhere; large inline success panels. |
| Tables | `DataTable` (`components/data-table.tsx`). `primaryColumn` is the descriptive column and the only click target; row actions go in `rowActions` (the ⋯ menu), with role gating in the screen's `// role-config` seam. Filters are server-side. Use `loadMore` (keyset) for server lists and `pagination` only for fully loaded data; the type allows one or the other. Sort on the server through declared sort fields. | Fake page counts under keyset paging (ADR-0003); raw `<table>` in screens. |
| Dates and times | `DateField` (ISO date out) and `DateTimeField` (`YYYY-MM-DDTHH:mm` wall clock out; stamp the offset with `activities/local-time.ts`) from `components/date-field.tsx`: typed in the reader's format or picked from a calendar with Today and Yesterday. `DateRangePicker` for from/to filters. | `<input type="date">` or `type="datetime-local"` (guard `H9`, no exceptions left). |
| UI primitives | `components/ui/` (shadcn `base-nova` on Base UI), vendored with the shadcn CLI. Register every new file under `src/components/` in `registry.json` in the same change. | Anything from `@radix-ui`. |
| Colour | Semantic tokens (`success`, `warning`, `info`, `signal`, and the theme tokens in `styles.css`). `palette.test.ts` enforces this. | Raw palette shades like `bg-red-500`. |
| Tabs | Height on `TabsList` (44 px touch target). | `min-h-*` on `TabsTrigger` (the broken-pill bug, `08b5502`). |
| Touch targets | Primitives are 44 px by default (Button, Input, SelectTrigger, TabsList, Calendar, `FilterChips`); users are on low-end Android (#23). A compact look is desktop-only: `size="desktop-sm"` / `"desktop-icon-sm"`, or a `desktop:` class (wide screen with a mouse). Guard `H13`. | `h-8`, `h-9`, `min-h-9` or `size="sm"` on a control; `min-h-11` workarounds the default already covers. |
| Text | Every user-visible string through `t()`, ICU syntax (`{name}`), with identical keys in `fr.json` and `en.json` (`i18n/locales.test.ts`). fr-CM is the default. | `{{name}}` interpolation; building sentences by concatenation; raw enum values or UUIDs on screen. |
| Active navigation item | `isRouteActive` from `lib/route-match.ts`, the single matcher for the sidebar and finance navigation. | A second matcher. |
| Record numbers | `RecordNumber` for a number on its own, `RecordText` for a translated sentence that names one (`components/record-number.tsx`): the number never breaks across lines on a phone (#430). | Rendering `t("…{number}…")` output bare where a trip, entry or work-order number can wrap at its hyphens. |
| Command words | One block per command, `commands.<command-name>.{label,short,submit,submitting,dismiss}` in `fr.json` and `en.json`, read through `useCommandLabel` (`src/commands/labels.ts`) on every menu, header, quick bar and form. `CommandForm` takes `command` and puts submit last on every surface; refusals and cancellations add `tone="destructive"` and a `ReasonField`. `locales.test.ts` and guard `H15` enforce it. | A second label key for the same command; `*.submit` keys outside `commands.*`; "Annuler"/"Close" as both the dismiss button and a domain verb. |
| Dashboard numbers | Server aggregates from `/v1/dashboard`. | Counting rows client-side. |
| Access in the UI | Role gating in each screen's `// role-config` seam, as a render hint only; the server enforces every write. A server-computed capabilities read with a typed `useCan(commandName)` is the chosen replacement. | CASL, or new role-string comparisons outside the `// role-config` seams. |
| Tests that open a select | `openSelect` from `src/test-select.ts` (`test-select.test.ts` guards the idiom). | `user.click` followed by arrow keys on the next line. |
| A link that looks like a button | `<Link className={buttonVariants(...)}>`. A Base UI part that must render a non-`<button>` (a `TabsTrigger` as a `Link`, a `PopoverTrigger` as a `div`) gets `nativeButton={false}`. `src/test-setup.ts` fails any test during which Base UI logs an error (#136). | `<Button render={<Link />}>`: it logs a Base UI error and announces the link as a button. |

## Walkthrough videos

Every feature PR links a walkthrough video (see the definition of done in the root `AGENTS.md`); the default is a reel from the feature's flow (guard V1 makes every `shot()` carry a caption).

When you record one:

- Switch the app to English first (name menu → My settings → Language) and write captions in English. The choice is stored per device (`localStorage["routiq-language"]`, #127), so it survives reloads; a fresh browser context starts in French.
- Match buttons by exact name. "Reverse", for example, also matches the "Reverses entry #…" link.
- Do a dry run with a screenshot per step, reset the database between runs, and check the frames before uploading.
- While you click through, note anything else that looks wrong and file it as its own issue.
