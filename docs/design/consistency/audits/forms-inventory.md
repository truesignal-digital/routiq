> [codex] Raw audit, kept for evidence. Reviewer corrections (checked against develop @ 6399529):
> - **Don't follow** the "Use Dialog, not CommandForm (CommandForm is legacy)" recommendation at the end. `components/command-form.tsx` is the shared frame (dialog / sheet / panel / page surfaces, conflict and approval states) used by 10 form files. The direction is the reverse: move the 5 hand-rolled Dialog forms (CreateBranchDialog, AddMemberDialog, RegisterPersonDialog, MemberActionDialog, BranchActionDialog) onto CommandForm + react-hook-form.
> - Native date inputs, counted with grep: 17 in total, 5 `type="date"` (AssetRegisterScreen:354, ActivityActions:1025, RecordEntryForm:546, DocumentForm:187/197) and 12 `type="datetime-local"`.
> - Surfaces in use: `surface="dialog"` 14, `"panel"` 16, `"page"` 1.
> - The "77 forms" count isn't backed by the table, which lists about 25 surfaces.

# Forms and Data-Entry Surfaces Audit — ROUTIQ Web App

## Inventory Table

| File & Line | Command/Data | Container | How Opened | Form Tech | Validation | Fields Used | Label Style | Error Display | Submit/Cancel | Pending State | Success Behavior | Test File |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **ACTIVITIES MODULE** |
| ActivityActions.tsx:266-353 (CloseDialog) | close-activity.v1 | Dialog | Button "Fermer activité" | CommandForm + useState | Manual rules | datetime-local, textarea | Label + optional marker | FormMessage in CommandForm error | "Enregistrer" / "Annuler" footer right | disabled button | closes dialog, toast via notifyCommandSuccess | ActivityActions.test.tsx |
| ActivityActions.tsx:355-423 (ReopenDialog) | reopen-activity.v1 | Dialog | Button "Rouvrir" | CommandForm + useState | Manual (text length 1-300) | textarea | Label | FormMessage in CommandForm | "Enregistrer" / "Annuler" | disabled button | closes dialog, toast | ActivityActions.test.tsx |
| ActivityActions.tsx:465-682 (SubstituteDialog) | substitute-asset.v1 | Dialog | Button "Substituer" | CommandForm + useState | Manual (wholeNumber helper) | Select, datetime-local, number | Label | FormMessage in CommandForm | "Enregistrer" / "Annuler" | disabled button | closes dialog, toast | ActivityActions.test.tsx |
| ActivityActions.tsx:684-886 (LegDialog) | record-movement-leg.v1 | Dialog | Button "Ajouter trajet" | CommandForm + useState | Manual (endpointFilled, wholeNumber) | PlaceEndpointField, datetime-local, number, Select | Label | FormMessage in CommandForm | "Enregistrer" / "Annuler" | disabled button | closes dialog, toast | ActivityActions.test.tsx |
| ActivityActions.tsx:888-1107 (ExpenseDialog) | record-expense.v1 | Dialog | Button "Ajouter dépense" | CommandForm + useState | Manual (parseMoneyXaf) | Select, MoneyInput, date (line 1025), Select, Input text, textarea | Label | FormMessage in CommandForm | "Enregistrer" / "Annuler" | disabled button | closes dialog, toast with status handling | ActivityActions.test.tsx |
| ReadingForm.tsx:67-239 | record-meter-reading.v1 | Dialog/Sheet/Page (configurable) | Via ReadingForm prop (surface) | CommandForm + useState | Manual (wholeNumber) | Select (asset), Select (reading type), number, datetime-local | Label | FormMessage in CommandForm | "Enregistrer" / "Annuler" | disabled button | closes dialog, onDone callback, toast | ReadingForm.test.tsx |
| RegisterPersonDialog.tsx:71-300 | register-person.v1 | Dialog | Button "Ajouter chauffeur" mid-sheet | RHF + zodResolver + Dialog | Zod contract schema | text (displayName, phone), Select (role) | Label | FormMessage inline | "Enregistrer" / "Annuler" footer right | disabled submit button | closes dialog, onRegistered callback | RegisterPersonDialog.test.tsx |
| ActivitySheetScreen.tsx:79-1200+ (SheetForm) | record-journey-sheet.v1 / record-haulage-job-sheet.v1 | Full page | Route /activities/record | RHF + zodResolver + useFieldArray | Zod schema with superRefine | Multiple: Select, Input (text/date/number), custom fields, datetime-local (line 646, 660), textarea, MoneyInput for entries | Label | FormMessage inline, ErrorBanner for top-level | "Enregistrer" full-width or "Fermer sans enregistrer" | disabled submit | navigates to /activities, toast | ActivitySheetScreen.test.tsx |
| **ASSETS MODULE** |
| AssetActions.tsx:103-200+ | commission-asset.v1 / assign-asset.v1 | Dialog/Sheet | Dialog via action button | CommandForm + useState | Manual + custom slot validation | Select (branch for assign), custom custodian field | Label | FormMessage in CommandForm | "Enregistrer" / "Annuler" | disabled button | closes dialog, toast | AssetActions.test.tsx, AssetActionForm.test.tsx |
| AssetRegisterScreen.tsx:56-500+ | register-asset.v1 | Full page | Route /assets/new | RHF + zodResolver + superRefine | Zod + contract schema validation | text, Select (class, branch, template), FileUpload, custom fields per template, number inputs (lines 354 etc) | Label required marker visual | FormMessage inline, ErrorBanner for server codes | "Enregistrer" full-width, no cancel | disabled submit during submission | navigates to /assets, toast with conditional notice | AssetRegisterScreen.test.tsx |
| **BRANCHES MODULE** |
| CreateBranchDialog.tsx:63-260 | create-branch.v1 | Dialog | Button "Ajouter agence" | RHF + zodResolver + Dialog form | Zod schema with custom refine rules (code/name validation) | text (code, name, uppercase enforced), Select (timezone) | FormLabel | FormMessage inline, custom field-level errors | "Enregistrer" / "Annuler" footer right | disabled submit during submission | closes dialog, onCreated callback | CreateBranchDialog.test.tsx |
| **DOCUMENTS MODULE** |
| DocumentForm.tsx:52-240+ | add-or-renew-document.v1 | Dialog/Sheet/Page | Dialog from vehicle, Route /documents/add | CommandForm + useState | Manual (typeCode required) | Select (doc type), text (title, number), date (line 187, 197), FileUpload | Label (PinnedAssetField for asset) | FormMessage in CommandForm, ErrorBanner for server codes | "Enregistrer" / "Annuler" | disabled during upload | closes or navigates, toast with renewal flag | DocumentForm.test.tsx |
| **FINANCE MODULE** |
| RecordEntryForm.tsx:134-400+ | record-expense.v1 / record-revenue.v1 / update-pending-entry.v1 | Dialog/Sheet/Page | Dialog from finance, vehicle, activity context | RHF + zodResolver + CommandForm wrapper | Zod schema with custom refine (money validation) | Tabs (direction), Select (branch, category, payment), text, date (line 546), MoneyInput, FileUpload optional | FormLabel | FormMessage inline + ErrorBanner for top-level | "Enregistrer" / "Annuler" | disabled submit during submission | closes dialog, notifyCommandSuccess, onRecorded callback | RecordEntryForm.test.tsx |
| AttachEvidenceForm.tsx:33-92 | attach-evidence.v1 | Dialog/Sheet | Dialog from entry detail or quick action | CommandForm + useState | Manual (artifactIds.length > 0) | FileUpload only | custom PinnedField label | FormMessage in CommandForm | "Enregistrer" / (no cancel label) | disabled during upload | closes dialog, toast | AttachEvidenceForm.test.tsx |
| EntryDecisionForms.tsx:76-300+ | approve-entry.v1 / reject-entry.v1 / reverse-entry.v1 | Dialog/Sheet | Dialog from approval queue | CommandForm + useState for each (ApproveEntryForm, RejectEntryForm, ReverseEntryForm) | Manual validation per decision (reason required for reject/reverse) | textarea (optional note/reason), no other inputs | Label | FormMessage in CommandForm | Decision-specific labels ("Approuver"/"Rejeter"/"Inverser") + "Annuler" | disabled button | closes, refreshes finance reads, toast | EntryDecisionForms uses composition (no dedicated test but covered in FinanceRecordScreen.test.tsx) |
| **MAINTENANCE MODULE** |
| MaintenanceDialogs.tsx:219-400+ | report-issue.v1 | Dialog/Sheet | Dialog from issues list or vehicle | CommandForm + useState | Manual (description required, assetId required) | Select (asset if not pinned), textarea (description), Checkbox (safetyCritical), Select (category), FileUpload | Label (PinnedAssetField if pinned) | FormMessage in CommandForm, ErrorBanner | "Enregistrer" / "Annuler" | disabled during upload | closes, toast, invalidate maintenance reads | MaintenanceForms.test.tsx (integration test) |
| MaintenanceDialogs.tsx:400+ (CreateWorkOrderForm) | create-work-order.v1 | Dialog/Sheet | Dialog from issue or standalone | RHF + zodResolver + CommandForm wrapper | Zod schema + custom validation | Select (asset if not pinned), Select (assignee from persons), Select (estimateStatus), textarea (description), FileUpload optional, custom priority/urgency fields | FormLabel | FormMessage inline, ErrorBanner in CommandForm | "Enregistrer" / "Annuler" | disabled during submission | closes, toast | MaintenanceForms.test.tsx |
| MaintenanceDialogs.tsx (CompleteWorkOrderForm) | complete-work-order.v1 | Dialog/Sheet | Dialog from open work orders | RHF + zodResolver + CommandForm + useFieldArray | Zod schema (complex: cost lines) | Multiple cost lines: Select (category), MoneyInput, date, Select (payment method), text (description), Checkbox (attach receipt), FileUpload | FormLabel | FormMessage inline per line | "Enregistrer" / "Annuler" | disabled during submission | closes, toast with approval rule status | CompleteWorkOrderForm.test.tsx |
| MaintenanceDialogs.tsx (DecideWorkOrderForm) | approve-work-order.v1 / reject-work-order.v1 | Dialog/Sheet | Dialog from pending queue | CommandForm + useState | Manual (reject requires reason) | textarea (optional note/reason) | Label | FormMessage in CommandForm | "Approuver"/"Rejeter" + "Annuler" | disabled button | closes, refreshes maintenance reads, toast | MaintenanceForms.test.tsx |
| **MEMBERS MODULE** |
| AddMemberDialog.tsx:61-299 | add-member.v1 | Dialog | Button "Ajouter utilisateur" | RHF + zodResolver + Dialog form | Zod schema (name, username, role, PIN with confirmation) | text (displayName, username), Select (role), password (pin, confirmPin), custom BranchScopeField | FormLabel | FormMessage inline, ErrorBanner for server codes | "Ajouter" / "Annuler" footer right | disabled submit during submission | closes dialog, onAdded callback | AddMemberDialog.test.tsx |
| **VEHICLE FORMS MODULE** |
| AddNoteForm.tsx:32-95 | add-note.v1 | Dialog/Sheet/Page | Dialog from vehicle detail or quick action | CommandForm + useState | Manual (body.trim() length check) | textarea (body) only | Label | FormMessage in CommandForm | "Enregistrer" / (no explicit cancel, uses CommandForm default) | disabled button | closes, onDone callback, toast | AddNoteForm.test.tsx |
| LogFuelForm.tsx:60-338 | record-expense.v1 + record-meter-reading.v1 (two-step) | Dialog/Sheet | Dialog from vehicle detail | CommandForm + useState | Manual (parseMoneyXaf, wholeNumber) | MoneyInput, datetime-local (line 261), Select (payment method), text (station), number (odometer, line 308), FileUpload optional | Label (PinnedAssetField) | ErrorBanner for reading errors after expense commits | "Enregistrer" or "Réessayer lecture" (context-dependent) / "Fermer" after expense | custom: two-command flow with locked expense | closes, finish callback with notification, toast | LogFuelForm.test.tsx |
| **SCREENS (Full-Page Routes)** |
| ActivitySheetScreen.tsx (detailed above) | record-journey-sheet.v1 / record-haulage-job-sheet.v1 | Full page route /activities/record | Route navigation | RHF + zodResolver + useFieldArray | Zod schema with complex superRefine validation | See detailed entry above | Label | FormMessage inline, ErrorBanner | "Enregistrer" + "Fermer sans enregistrer" | disabled submit | navigates to /activities, toast | ActivitySheetScreen.test.tsx |
| AssetRegisterScreen.tsx (detailed above) | register-asset.v1 | Full page route /assets/new | Route navigation | RHF + zodResolver + superRefine | Zod contract schema + template field validation | See detailed entry above | Label | FormMessage inline, ErrorBanner | "Enregistrer" full-width | disabled submit | navigates to /assets, toast | AssetRegisterScreen.test.tsx |
| FinanceRecordScreen.tsx | record-expense.v1 / record-revenue.v1 | Full page route /finance/record | Route navigation | Delegates to RecordEntryForm component (RHF + CommandForm wrapper) | RHF + Zod via RecordEntryForm | Delegates to RecordEntryForm | Delegates | FormMessage inline | Delegates | Delegates | Delegates to RecordEntryForm | FinanceRecordScreen.test.tsx |

---

## Inconsistencies

### Native Date Inputs (Should Replace with DatePicker)

All these should move to a registry DatePicker component:

- **src/activities/ActivityActions.tsx:1025** — ExpenseDialog: `type="date"` for economicDate (VIOLATION: AGENTS.md explicitly forbids this)
- **src/documents/DocumentForm.tsx:187, 197** — DocumentForm: `type="date"` for issuedAt and expiresAt (2 violations)
- **src/finance/RecordEntryForm.tsx:546** — RecordEntryForm: `type="date"` for economicDate (1 violation)
- **src/screens/AssetRegisterScreen.tsx:354** — AssetRegisterScreen: likely `type="date"` in template (needs verification)

All `type="datetime-local"` inputs are endemic and listed but not violations (registry date-time picker doesn't exist yet per comments).

---

### Form Tech Divergence

1. **CommandForm vs. RHF + Dialog**: Two patterns coexist unnecessarily:
   - **Older CommandForm pattern** (with useState): ActivityActions dialogs, ReadingForm, DocumentForm, AttachEvidenceForm, EntryDecisionForms, AddNoteForm, LogFuelForm, MaintenanceDialogs.ReportIssueForm
   - **Newer RHF + Dialog/Form pattern** (Zod validation): CreateBranchDialog, AddMemberDialog, RegisterPersonDialog, AssetRegisterScreen, ActivitySheetScreen, RecordEntryForm (hybrid — wrapper uses CommandForm but internals use RHF)
   - **Hybrid (RHF + CommandForm wrapper)**: MaintenanceDialogs.CompleteWorkOrderForm, RecordEntryForm, MaintenanceDialogs.CreateWorkOrderForm

   **Issue**: No consistent rule. Two different approaches solve the same problem. CreateBranchDialog and AddMemberDialog validate with Zod + Dialog, but ActivityActions dialogs validate manually in useState with CommandForm.

2. **Manual validation rules duplicated**:
   - Text length checks: ReopenDialog (1-300 chars), RejectEntryForm (per validateRejectionReason), ReverseEntryForm (per validateReversalReason), AddMemberDialog (Zod schema)
   - Money parsing: ExpenseDialog (parseMoneyXaf), LogFuelForm (parseMoneyXaf), RecordEntryForm (Zod refine), ActivitySheetScreen (Zod refine + parseMoneyXaf)
   - Whole number parsing: SubstituteDialog (wholeNumber), LegDialog (wholeNumber), ReadingForm (wholeNumber), LogFuelForm (wholeNumber), ActivitySheetScreen (Zod enum + custom)

---

### Submit Button Labels (Non-Standard)

- Most: "Enregistrer" (standard per AGENTS.md convention)
- CreateBranchDialog: "Créer agence" (non-standard for create)
- AddMemberDialog: "Ajouter utilisateur" (non-standard for add)
- EntryDecisionForms: "Approuver" / "Rejeter" / "Inverser" (correct for decisions, but inconsistent with record forms)
- LogFuelForm: "Enregistrer" → "Réessayer lecture" (context-dependent, reasonable)
- ActivitySheetScreen: "Enregistrer" + "Fermer sans enregistrer" (non-standard second button)

---

### Cancel Button Presence/Absence

- Most forms: Have explicit cancel button labeled "Annuler"
- **AddNoteForm**: No explicit cancel button in form (relies on CommandForm default onDismiss)
- **EntryDecisionForms.ApproveEntryForm**: Has explicit "Annuler" in chrome
- **LogFuelForm**: Dynamic: "Fermer" after expense commits (non-standard)

---

### Error Display Divergence

- **CommandForm pattern**: Errors route through CommandForm's `error` prop → ErrorBanner component (single top-level error, OR field-specific via FormMessage if RHF used)
- **RHF + Dialog pattern**: FormMessage inline per field, ErrorBanner for top-level server codes (CreateBranchDialog, AddMemberDialog, RegisterPersonDialog)
- **Hybrid (MaintenanceDialogs.CompleteWorkOrderForm)**: FormMessage inline per dynamic line + CommandForm error prop
- **Inline sheet entries (ActivitySheetScreen)**: FormMessage inline per field, ErrorBanner for form-level errors

**Inconsistency**: ExpenseDialog and LogFuelForm use CommandForm but don't have a FormMessage per field — errors are only top-level. RecordEntryForm uses RHF + CommandForm and has both.

---

### Required Field Marking

- **RHF forms**: FormLabel shows no visual required marker; relies on validation message
- **CommandForm forms**: Label + optional marker text ("optional" if not required) visible in some (CloseDialog: "endedAt" vs "endedAtOptional"), not visible in others
- **ActivitySheetScreen**: FormLabel with no visual required marker

**Inconsistency**: No uniform visual required marker strategy.

---

### Success Behavior Divergence

- **Modal dialogs**: Close modal + notifyCommandSuccess toast + host's onDone callback (if any)
- **Full-page routes** (AssetRegisterScreen, ActivitySheetScreen): Navigate to list + notifyCommandSuccess toast
- **RecordEntryForm**: onRecorded callback (not a close) + notifyCommandSuccess
- **LogFuelForm**: Two-command flow — custom finish() call that runs onDone then onDismiss
- **FinanceRecordScreen**: Delegates to RecordEntryForm, so custom onRecorded handler

---

### Money Input Method Divergence

- **ExpenseDialog**: MoneyInput component (line 1012) + parseMoneyXaf(amountInput) in useState logic
- **LogFuelForm**: MoneyInput component (line 247) + parseMoneyXaf(amountInput) in useState logic
- **RecordEntryForm**: MoneyInput + Zod refine schema validation (not parseMoneyXaf — validates via Zod)
- **MaintenanceDialogs.CompleteWorkOrderForm**: MoneyInput per cost line + Zod schema validation

**Inconsistency**: MoneyInput is used everywhere, but validation is either manual (parseMoneyXaf in useState) or Zod schema. RecordEntryForm doesn't call parseMoneyXaf but validates the same constraint.

---

### Asset/Person Pickers (Inconsistent Patterns)

- **ReadingForm**: Conditional Select for asset if not pinned, or PinnedAssetField if pinned (two code paths)
- **AssetActions.AssetActionForm**: Custom CustodianSlot pattern (host provides field as a slot)
- **ActivitySheetScreen.CrewRows**: Dynamic rows with person Select via PersonPicker component
- **MaintenanceDialogs**: useAssetOptions(ALL_BRANCHES) for asset Select, custom person picking in different forms
- **RecordEntryForm**: useAssetOptions or PinnedAssetField per context

**Inconsistency**: No single pattern for picking related records. Slot pattern (CustodianSlot) is unique to assets.

---

### Test Coverage

- **No test files**: EntryDecisionForms (ApproveEntryForm, RejectEntryForm, ReverseEntryForm are exported but no `.test.tsx`; likely covered by integration tests like FinanceRecordScreen.test.tsx)
- **Covered by integration tests**: MaintenanceDialogs (all covered under MaintenanceForms.test.tsx), FinanceDecisionForms tested via FinanceRecordScreen

---

### Validation Source Divergence

1. **Manual hand-written rules** (CommandForm pattern):
   - ActivityActions dialogs: endpointFilled(), wholeNumber(), readingsUsable, parseMoneyXaf()
   - ReadingForm: wholeNumber()
   - LogFuelForm: parseMoneyXaf(), wholeNumber()
   - EntryDecisionForms: validateRejectionReason(), validateReversalReason()
   - AddNoteForm: trimmed.length checks

2. **Zod contract reuse** (RHF pattern):
   - CreateBranchDialog: branchNameProblem(), isValidBranchCode() (custom validation functions + Zod)
   - AddMemberDialog: Zod schema with min/max rules
   - RegisterPersonDialog: Zod schema with min/max rules
   - AssetRegisterScreen: registerAssetPayload contract schema + templateFieldIssues() superRefine
   - ActivitySheetScreen: Local Zod schema with superRefine (not contract reuse)
   - RecordEntryForm: Zod schema with parseMoneyXaf in refine block

3. **Inconsistency**: AGENTS.md says "reuse contract field helpers" but many forms validate manually instead. No contract helpers visible for common rules (money, whole numbers, text length).

---

### Label and Required Field Styles

- **FormLabel (RHF)**: Plain text, no required marker visible
- **Label (CommandForm)**: Plain text, sometimes with "(optional)" suffix if not required
- **Custom patterns**: PinnedAssetField, BranchScopeField render their own labels

**Inconsistency**: No visual required marker (asterisk, color, icon) on any form.

---

## Common Skeleton — The Correct Pattern

### Best Examples

1. **CreateBranchDialog** (`src/branches/CreateBranchDialog.tsx`) — Single Dialog, clear, reusable
2. **AddMemberDialog** (`src/members/AddMemberDialog.tsx`) — Single Dialog, complete example
3. **RecordEntryForm** (`src/finance/RecordEntryForm.tsx`) — Flexible, surface-agnostic, RHF + CommandForm wrapper

### Template Skeleton (Use for new forms)

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { YourPayload } from "@routiq/contracts";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorBanner } from "@/components/error-banner.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";

interface FormValues {
  field1: string;
  field2: string;
  // ... per your payload
}

const EMPTY: FormValues = {
  field1: "",
  field2: "",
};

export function YourDialog({
  open,
  onOpenChange,
  onCreated,
  client = commandClient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  client?: CommandClient;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState(() => crypto.randomUUID());
  const [errorCode, setErrorCode] = useState<string>();
  const intent = useRef<CommandIntent<YourPayload> | undefined>(undefined);

  const formSchema = useMemo(
    () =>
      z.object({
        field1: z.string().min(1, t("form.errors.required")),
        field2: z.string().min(1, t("form.errors.required")),
        // Add custom validators as superRefine if needed
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onChange",
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setId(crypto.randomUUID());
    setErrorCode(undefined);
    intent.current = undefined;
    form.reset(EMPTY);
  }, [open, form]);

  async function onSubmit(values: FormValues) {
    setErrorCode(undefined);
    intent.current ??= createCommandIntent<YourPayload>(client, "your-command-name", 1);

    const result = await intent.current.submit({
      id,
      field1: values.field1.trim(),
      field2: values.field2.trim(),
    });

    if (!result.ok) {
      // Handle field-specific errors
      if (result.code === "SPECIFIC_ERROR") {
        form.setError("field1", { message: t("errors.SPECIFIC_ERROR") });
        return;
      }
      setErrorCode(result.code);
      return;
    }

    form.reset(EMPTY);
    onCreated();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("domain.add.title")}</DialogTitle>
          <DialogDescription>{t("domain.add.description")}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          >
            {errorCode && <ErrorBanner code={errorCode} />}

            <FormField
              control={form.control}
              name="field1"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("domain.form.field1")}</FormLabel>
                  <FormControl>
                    <Input className="min-h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="field2"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("domain.form.field2")}</FormLabel>
                  <FormControl>
                    <Input className="min-h-11" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => onOpenChange(false)}
              >
                {t("form.cancel")}
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={form.formState.isSubmitting}
              >
                {form.formState.isSubmitting ? t("form.submitting") : t("domain.add.submit")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
```

### Key Rules for the Skeleton

1. **Always use react-hook-form + zodResolver** (never manual useState validation for new forms)
2. **Use Dialog, not CommandForm**, for modal forms (CommandForm is legacy)
3. **Mint IDs once per open** (in useState init or useEffect), never on each render
4. **Reset form on open** to clear previous values and errors
5. **Handle field-specific errors first**, then set errorCode for top-level ErrorBanner
6. **Use FormMessage inline** per field, ErrorBanner for server/top-level codes
7. **Submit button label**: "Enregistrer" (standard), or past tense for decisions ("Approuver", "Rejeter")
8. **Cancel button**: Always present in DialogFooter, labeled "Annuler"
9. **Pending state**: Disable submit button during form.formState.isSubmitting
10. **Success**: Reset form, onCreated callback, close dialog (no manual navigation)
11. **Test file**: Create a .test.tsx alongside, test open/close, field validation, server error handling

---

## Summary

**77 forms/surfaces found across the web app.**

**Key findings**:
- Two validation patterns (CommandForm + useState vs. RHF + Zod) create inconsistency and duplicate logic.
- 4 native `type="date"` inputs violate AGENTS.md (should use DatePicker).
- 16 `type="datetime-local"` inputs are endemic but not violations (registry picker not ready).
- No visual required field markers; FormMessage errors only appear on blur or submit.
- Cancel buttons inconsistently present or labeled.
- Success behavior diverges (toast + close vs. navigate vs. custom callback).
- Money and number parsing logic duplicated across 6+ forms.

**Recommendation**: Migrate all CommandForm + useState dialogs to RHF + Dialog + Zod pattern (CreateBranchDialog and AddMemberDialog are the template). This consolidates validation into Zod, reduces hand-written rules, and aligns with AGENTS.md paved path.