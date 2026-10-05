# ROUTIQ web: audit of action display and feedback

Read-only audit. No files were changed. Paths are relative to `apps/web/src/`.

## 1. Where each screen's primary action lives

| Screen | Primary action | Where | Style | Problem |
|---|---|---|---|---|
| Assets list | "Nouvel actif" | PageHeader, plus a mobile FAB | A `<Link>` styled by hand (`rounded-md px-4`) and hidden on mobile (`AssetsStub.tsx:178-184`); a round `bg-signal` icon-only FAB (`:360-367`) | The only screen with a FAB. Not a `Button`. |
| Activities list | "Saisir une fiche" | PageHeader | `Button min-h-11` (`ActivitiesScreen.tsx:173`) | Correct. This is the reference pattern. |
| Activity detail | Close / leg / reading / expense / substitute / reopen | PageHeader, up to 6 buttons | `min-h-9` (`ActivityActions.tsx:172-219`) | Under 44 px. Header gets crowded. |
| Activity sheet | Save / Save and close | Sticky bottom bar | `min-h-11` (`ActivitySheetScreen.tsx:899-919`) | Fine. |
| Finance entries | "Saisir une écriture" | FinanceToolbar, to the right of the tabs | `size="sm"` (28 px) (`FinanceEntriesScreen.tsx:196`) | Wrong place and too small. |
| Finance entry detail | Edit / Reverse | Full-width buttons at the bottom of the body (`FinanceEntryDetailScreen.tsx:136-168`); PageHeader holds only History | Reverse uses the primary (`default`) variant | Actions are not in the header. A destructive action is styled as primary. |
| Finance approvals / periods | none | ⋯ row menu only | n/a | No action at page level, which is fine. |
| Maintenance | New issue (outline) + New work order (solid) | PageHeader (`MaintenanceScreen.tsx:171-193`) | `min-h-11` | Work-order actions are in the drawer; issue actions are in the ⋯ menu (see §2). |
| Vehicle workspace | role-top actions + "Plus d'actions" | **5 surfaces**: desktop header outline `h-9` (`IdentityStrip.tsx:81-94`), StatusBlock solid step (`StatusBlock.tsx:201`), mobile floating QuickActionBar (`QuickActionBar.tsx:17`), tab-header `TabAction` (`MaintenanceTab.tsx:28`), record-panel sticky footer (`panel/shared.tsx:121-133`) | Heights h-9 / h-10 / h-14 | The same verb appears in up to 3 places with 3 styles. |
| Persons | Branch Select + "Ajouter une personne" | PageHeader (`PersonsScreen.tsx:138-171`) | Select is `h-9` | A second branch control. ActivitiesScreen's own comment says the header switcher is the only branch control. |
| Users / Branches | Add | PageHeader `min-h-11` (`UsersScreen.tsx:171`, `BranchesScreen.tsx:123`) | | Fine. |

**Rule:** The page's main create action goes in `PageHeader actions` as a `<Button className="min-h-11">` with an icon and a label. Record actions go in the PageHeader on full pages and in the sticky footer on panels or drawers. Don't use toolbar `sm` buttons, styled links, or a FAB on only one screen.

## 2. Row actions

| List | Clicking the row | ⋯ menu items | Inconsistency |
|---|---|---|---|
| Assets | Navigates | Ouvrir la fiche, Documents, Mettre en service, **Affecter** (`AssetsStub.tsx:241-283`) | The same `assign-asset` command is called "Changer d'agence" in the vehicle workspace (`fr.json:282` vs `vehicle.actions.transfer-branch`). |
| Activities | Navigates | **Ouvrir l'activité** (`ActivitiesScreen.tsx:219-230`) | |
| Finance entries | Opens a **drawer** | **Ouvrir en plein écran**, Contre-passer (destructive) (`FinanceEntriesScreen.tsx:233-264`) | Three different wordings for "open". The menu item repeats what the primary cell already does. |
| Finance approvals | **Nothing**: no `onRowClick` and no `rowViewer` (`FinanceApprovalsScreen.tsx:287-305`) | Approuver, Rejeter (destructive) | **The approver cannot open the entry (evidence, postings) before deciding.** The entry detail page has no approve/reject either. |
| Periods | Nothing (no detail page) | Verrouiller (not marked destructive) / Rouvrir | Its dialog submit *is* destructive (`FinancePeriodsScreen.tsx:319`). |
| Maintenance work orders | Opens a drawer with inline buttons (`WorkOrderSheet.tsx:176-245`) | **none** | The sibling tab uses the ⋯ menu instead. |
| Maintenance issues | Nothing | Create work order, Resolve, Classer sans suite (not destructive) (`MaintenanceScreen.tsx:125-153`) | Dismiss is not marked destructive; finance Reject is. Issues cannot be opened. |
| Branches / Users | Nothing | Rename/role/PIN, then Deactivate (destructive) | Fine. |
| Vehicle tabs | Opens the record panel | A separate `RowMenu`: `Ellipsis` icon, aria "Actions pour {record}", locked items shown with their reason, nothing marked destructive (`vehicle/parts.tsx:336-388`) | DataTable's `RowActionsMenu` uses `MoreHorizontal` and aria "Actions" for every row (`data-table.tsx:984`), hides unavailable items, and marks destructive ones. These are two row-menu components with different rules. |

Ordering is mostly consistent: open first, then commands, destructive last.

**Rule:** Use one row-menu component. Every row with a record opens it. If a list has a detail page, the row navigates; if it's a decision queue, the row opens a drawer that holds the decision buttons. Use one label for open ("Ouvrir"). Mark `destructive` on every refusal or cancel item.

## 3. Button variants, sizes and touch targets

| Problem | Evidence | Rule |
|---|---|---|
| ⋯ trigger is 28 px on **every** table | `data-table.tsx:983` (`icon-sm`), `vehicle/parts.tsx:355` | Fix it in the shared component: `size-11`. |
| "Affichage" column toggle is 28 px on every list | `data-table.tsx:1028` | Same. |
| Pager buttons are 32 px | `data-table.tsx:915-948` | Same. |
| History trigger is 36 px | `record-history-sheet.tsx:213` (`min-h-9`) | Same. |
| `min-h-9` / `h-9` / `h-10` on action buttons | `ActivityActions.tsx:172-215`, `WorkOrderSheet.tsx:188`, `StatusBlock.tsx:201,215,229`, `panel/shared.tsx:110,126`, `MaintenanceTab.tsx:28`, `IdentityStrip.tsx:85,91`, `ActivitySheetScreen.tsx:678,714,1132` | `min-h-11` everywhere. |
| Filter chips: three styles | Maintenance `rounded-full min-h-9` pills (`MaintenanceScreen.tsx:75`; pill buttons are on the owner's avoid list); vehicle `rounded-md h-8` (`parts.tsx:234`); DataTable selects `h-9` | One chip component, `min-h-11`, not a pill. |
| SelectTriggers without `min-h-11` | `MaintenanceDialogs.tsx:202,311,473`, `AssetActions.tsx:218`, `PersonsScreen.tsx:149`, `AllActionsSheet.tsx:84` (`h-9` search) | Every form control `min-h-11`. |
| Small icon-only buttons | `MoneyTab.tsx:145,153` (period arrows), `panel/shared.tsx:246` (open file) | `size-11`. |
| Same intent, different variant | Reverse is destructive in the menu but default/primary on the detail page (`FinanceEntryDetailScreen.tsx:162`). Reject/cancel are `outline` in the WO sheet (`WorkOrderSheet.tsx:204,214,232`) and the vehicle footer. Every `CommandForm` submit is `default` (`command-form.tsx:248`), including Reject / Cancel WO / Dismiss / Reverse. Branch and user Deactivate submits are destructive (`BranchActionDialog.tsx:222`). | Add `CommandForm` `tone="destructive"` for refusals and cancels. |
| Button order flips | Dialog: [cancel, submit]; panel/page: [submit, cancel] (`command-form.tsx:307`) | This is intentional, but asset register and DetailsTab do their own thing. Document it or unify it. |
| Dead code | `AssetActions` button row (`AssetActions.tsx:265`) has no consumer | Remove it. |

## 4. Destructive and irreversible actions

| Action | Surface | Confirmation | Reason | Submit variant |
|---|---|---|---|---|
| Lock period | **AlertDialog**, the only use in the app (`FinancePeriodsScreen.tsx:301`) | yes | no | destructive |
| Reopen period | Dialog written by hand, not `CommandForm` (`:335`) | form | required | default |
| Reject entry | CommandForm (`EntryDecisionForms.tsx:129`) | form | required, no `maxLength` | default |
| Reverse entry | CommandForm (`:188`) | form | required | default; then a 1.5 s `setTimeout` redirect (`FinanceEntryDetailScreen.tsx:175`) |
| Reject WO / reject completion | CommandForm DecisionForm (`MaintenanceDialogs.tsx:1066,1082`) | form | required, `maxLength` 500 | default |
| Cancel WO | CommandForm (`:914`) | form | required | default; the footer shows **"Annuler" next to "Annuler l'ordre de travail"** |
| Dismiss issue | CommandForm (`:1101`) | form | required | default |
| Release to service | CommandForm (`:1150`) | form | note optional; override reason only without a WO | default |
| Close activity | CommandForm | form | note optional | default |
| Reopen activity | CommandForm (`ActivityActions.tsx:367`) | form | required | default |
| Deactivate branch / user | Dialog written by hand (`BranchActionDialog.tsx:145`, `MemberActionDialog.tsx:186`) | yes | **none** | destructive |

Required reasons are never marked as required. A missing reason only shows up as a disabled submit button.

**Rule:** Every decision or destructive command goes through `CommandForm` (drop the hand-written dialogs). Refusals and cancels require a reason with a visible "required" marker, `maxLength` 500, and a destructive submit. Use AlertDialog only for confirmations that take no fields.

## 5. Disabled actions

| Where | Behaviour | Reason shown? |
|---|---|---|
| AllActionsSheet (`AllActionsSheet.tsx:106-131`) | Disabled, with a lock icon | Yes, lock text |
| Vehicle RowMenu (`parts.tsx:375-383`) | Disabled items | Yes |
| Record footer (`panel/shared.tsx:108-115`) | First lock only | Yes |
| StatusBlock release (`StatusBlock.tsx:215-222`) | Disabled, `aria-describedby` | Yes |
| **Vehicle desktop header** (`IdentityStrip.tsx:79`) | **Hidden** when locked | No |
| **QuickActionBar** (`actions.ts:340-347`) | **Hidden**; the remaining slots shift between vehicles | No |
| **TabAction** (`MaintenanceTab.tsx:25`) | **Hidden** | No |
| CommandForm submit (`command-form.tsx:253`) | Disabled while `!ready` | No: it doesn't say which field is missing |
| Persons "Ajouter" (`PersonsScreen.tsx:166`) | Disabled until a branch is chosen | No |
| Approvals, own submission (`FinanceApprovalsScreen.tsx:184-199`) | Menu removed | Yes, badge |
| Viewer role on vehicle | Desktop shows "Consultation seule" (`IdentityStrip.tsx:70-75`, `md:` only); **mobile shows nothing** (`QuickActionBar.tsx:13`) | Desktop only |

Role gating hides actions everywhere, which is consistent and correct.

**Rule:** If the role forbids an action, hide it. If the state blocks it, show it disabled with the lock reason on every surface, and keep quick-bar slots fixed. A disabled submit names the missing field.

## 6. Feedback

| Flow | Success | Error | Conflict | Pending |
|---|---|---|---|---|
| CommandForm users (activities, finance, maintenance, documents, asset actions, vehicle forms) | `notifyCommandSuccess` toast | Inline ErrorBanner at the top of the form | Form replaced by a warning box and "Actualiser" | Button label |
| Periods | Toast | Inline ErrorBanner | **No conflict state** | "En cours…" |
| **Branches / Users** | **Nothing**: the dialog just closes (`BranchActionDialog.tsx:135-136`; same in Create/Add/Member dialogs). `NotifyNamespace` has no branches or users entry (`notify.ts:9-15`). | Inline ErrorBanner | Separate copy with "**Recharger**" (`BranchActionDialog.tsx:154-167`) | "Envoi en cours…" |
| PIN reset | **Large inline success panel** (`MemberActionDialog.tsx:210-224`), which AGENTS.md forbids | | | |
| Asset register | Toast, then navigate | ErrorBanner at the **bottom**, above submit (`AssetRegisterScreen.tsx:470`) | | The **only** consumer of `commandStatusStore` (`:70-75`) |
| Branch switch | `toast.add` called directly (`shell/branch-context.tsx:12,151`), bypassing `notify.ts` | | | |

Other findings:
- `notifyCommandError` is defined but never used.
- The generic error string shows the raw code: "L'action a échoué… ({code})" (`fr.json:98`).
- Pending labels use 5 different wordings: "Envoi…", "Envoi en cours…", "En cours…", "Enregistrement…", and the domain-specific ones.
- No list or row shows a pending marker after a command (ADR-0001 says pending state should be rendered).

**Rule:** Every committed command shows a toast through `notify.ts` (add `branches` and `users` namespaces). Errors appear inline at the top of the form. Conflicts use the one CommandForm state. Pending uses one `commandForm.submitting` label read from the command status store.

## 7. Label wording (fr / en)

| Concept | Variants | Evidence |
|---|---|---|
| **"Annuler" as both dismiss and cancel-record** | The CancelWO footer shows "Annuler" next to "Annuler l'ordre de travail". The quick-bar short label for cancel-WO is just "Annuler". | `fr.json:1126,1142,2300` |
| **en "Close" as both close-trip and close-dialog** | `activities.actions.close` and `commandForm.close` are both "Close" | `en.json:755,1616` |
| Report issue | "Nouveau signalement" / "Signaler un problème"; submit fr "Enregistrer…" but en "Report issue" | `fr.json:1071,1800` |
| Start trip | "Saisir une fiche" / "Démarrer un trajet" | `fr.json:872,1807` |
| Finance entry | "Saisir une écriture" (button) / "Enregistrer une transaction" (page title) | `fr.json:461,419` |
| Approve WO | "Approuver" / "Autoriser" | `fr.json:1130 area`, `1802` |
| Reject WO | "Rejeter" / "Refuser" (en "Reject" / "Refuse") | `fr.json:1131,1816` |
| Reject completion | "Refuser la fin…" / "Renvoyer" | `fr.json:1817` |
| Approve completion | "Valider la fin des travaux" / "Valider" (en "Approve completion" / "Sign off") | `fr.json:1136,1804` |
| Complete WO | "Déclarer terminé" / "Terminer les travaux" | `fr.json:1134,1803` |
| Release | "Remise en service" (noun on a button) / "Remettre en service" | `fr.json:1145,1806` |
| Create | Branch "Nouvelle agence" → "Créer"; user "Ajouter un utilisateur" → "Ajouter"; person "Ajouter une personne" vs picker "Nouvelle personne" → "Enregistrer" (en "Register") | `fr.json:1222,822` |
| Pending status | "En attente" / "En attente d'examen" (en "Pending" / "Awaiting review") | `fr.json:463,1198` |
| Closed | "Clôturée" / "Clôturé" (gender drift) | `fr.json:646,650` |
| Optional note | "Remarque" / "Note"; "(optionnel)" glued on by string concatenation | `fr.json:541`, `EntryDecisionForms.tsx:116` |
| Reload | "Actualiser" / "Recharger" | `fr.json:1617,1315` |

**Rule:** Each command has one label key, keyed by command name, that every surface reuses. The dismiss button in a destructive dialog reads "Retour", never "Annuler". A domain verb never equals a chrome verb (Close/Cancel).

## 8. Status display

| Status | Variants | Evidence |
|---|---|---|
| Entry SUBMITTED | info + spinner "En attente" (FinanceStatusBadge) / warning + Clock (ActivityMoney) / warning with no icon (WorkOrderSheet) / warning + Clock "En attente d'examen" (vehicle) | `FinanceStatusBadge.tsx:11`, `ActivityMoney.tsx:15`, `WorkOrderSheet.tsx:105`, `panel/shared.tsx:162` |
| Entry POSTED | success, except **neutral** in the vehicle workspace | `panel/shared.tsx:162` |
| Activity CLOSED | neutral in the list, success in the detail | `activityColumns.tsx:50`, `TripState.tsx:29` |
| WO status icons | Default tone icons in the list, custom `WO_ICON` in the vehicle | `maintenance/columns.tsx:152`, `panel/shared.tsx:144` |
| Shape and case | `uppercase` only in finance (`FinanceStatusBadge.tsx:40`); `rounded-md` only in vehicle/activity badges (`TripState.tsx:16`, `IssueRecord.tsx:38`) | |
| "info" tone | Blue in StatusBadge, grey in vehicle `RowIcon` | `parts.tsx:93` |
| Period status | Plain text, no badge | `FinancePeriodsScreen.tsx:101-106` |

**Rule:** Each domain status has one exported badge component (tone + icon + label key), used everywhere. Info means "in progress", warning means "waits for someone", success means "done". No per-file tone maps.

## 9. Notes and history

| Item | Variants | Evidence |
|---|---|---|
| How history is reached | "Historique" sheet button on activity detail and entry detail only; vehicle has a History tab; WO and issue have an inline Chronologie. **No history from** the finance drawer, vehicle EntryRecord, or maintenance issue rows. | `ActivityDetailScreen.tsx:79`, `FinanceEntryDetailScreen.tsx:77`, `WorkOrderSheet.tsx:415`, `IssueRecord.tsx:169` |
| Decision notes | History sheet shows them in italic after an em dash (`record-history-sheet.tsx:345-349`). Vehicle HistoryTab shows plain muted text (`HistoryTab.tsx:158`). **Chronologie drops notes entirely** (`WorkOrderSheet.tsx:69-97`), so WO approval and release notes are invisible in both the WO sheet and the vehicle panel. | |
| Reasons | `<dl>` in EntrySummary (`:145`); DetailSection in vehicle records (`EntryRecord.tsx:178`, `WorkOrderRecord.tsx:137`); `Note` box for completion sent back (`WorkOrderRecord.tsx:89`); LabelledText in the WO sheet (`:380`) | |
| Finance approval note / activity close note | No detail component renders them (searched EntrySummary and activities/detail). Only the history sheet might show them. Not confirmed in the running app. | |
| Provenance | `ProvenanceStamp` appears only on activity detail and shows an 8-character command id (`provenance-stamp.tsx:47`) | |
| Raw codes | Chronologie and the history sheet fall back to the raw event code (`defaultValue: event.kind`) | |

**Rule:** Every record surface (page, drawer, panel) has the same "Historique" entry point. Every timeline renders actor, act, note and time with one component.

## Top 10 rules, ranked by user impact

1. **Approvers must see what they approve.** The approvals queue rows open the entry in a drawer that holds Approve and Reject. Today a row opens nothing.
2. **One label per command, reused on every surface.** Never let "Annuler" or "Close" mean both dismiss and a domain action; the dismiss button in destructive dialogs reads "Retour".
3. **44 px minimum, fixed in the shared components first:** DataTable ⋯ trigger, view options, pager, history trigger, activity header buttons, vehicle StatusBlock, record footer, and chips.
4. **Destructive commands look destructive.** Add `CommandForm` `tone="destructive"` and `destructive` on row items for reject, reverse, cancel, dismiss and lock. Reason marked required, max 500.
5. **One status, one badge.** A shared badge per domain status; fix entry SUBMITTED/POSTED and activity CLOSED first.
6. **Every success is a toast through `notify.ts`.** Add branches and users; remove the PIN inline panel and the direct `toast` import; no raw `({code})` in messages.
7. **State-locked actions are shown disabled with the lock reason everywhere** (header, tab action, quick bar with fixed slots). Role-forbidden actions stay hidden. Viewers see "Consultation seule" on mobile too.
8. **One row-menu component and one "open" verb.** Merge DataTable's `RowActionsMenu` and the vehicle `RowMenu` (aria "Actions pour {record}", locked items with reasons).
9. **Primary page action goes in `PageHeader` as `Button min-h-11`**, record actions in the header or sticky footer. No toolbar `sm` buttons, styled links, or one-off FABs.
10. **Same history entry point and same timeline (with notes) on every record surface.** Chronologie must show notes. One pending label, read from the command status store.