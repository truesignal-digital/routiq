# 04 — Form standardization (record screen)

Status: ready-for-human
Blocked by: 01

Migrate FinanceRecordScreen from useState to react-hook-form + zodResolver + shadcn Form per spec § Design 5. Native selects → shadcn Select; textareas → Textarea; status chips (entries/approvals) → Badge variants. Keep model.ts as the payload mapper (form → toRecordExpensePayload unchanged); keep the branch select and outcome view behavior identical. AssetRegisterScreen: align field markup to shadcn Form only where trivial — do not restructure its working logic.

Acceptance:
- [x] Existing model/permission tests untouched and green; form-level test asserts invalid amount blocks submit and valid state dispatches unchanged payload shape
- [x] Web tests + typecheck green

## Comments

2026-07-26 [codex] clean pass. Record screen on RHF+zodResolver+vendored Form, payload mapper untouched (payload-equality test asserts it); shared FinanceStatusBadge maps the four statuses to Badge variants across entries/approvals/detail. AssetRegisterScreen churn reviewed line-by-line: mechanical Form-wrapping only (fieldError helpers -> FormMessage), RHF core and submit flow intact. 142 web tests + typecheck green, Fable-verified.
