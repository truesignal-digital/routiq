# 04 — Form standardization (record screen)

Status: ready-for-agent
Blocked by: 01

Migrate FinanceRecordScreen from useState to react-hook-form + zodResolver + shadcn Form per spec § Design 5. Native selects → shadcn Select; textareas → Textarea; status chips (entries/approvals) → Badge variants. Keep model.ts as the payload mapper (form → toRecordExpensePayload unchanged); keep the branch select and outcome view behavior identical. AssetRegisterScreen: align field markup to shadcn Form only where trivial — do not restructure its working logic.

Acceptance:
- [ ] Existing model/permission tests untouched and green; form-level test asserts invalid amount blocks submit and valid state dispatches unchanged payload shape
- [ ] Web tests + typecheck green
