# 03 — Dialog migration + action toasts

Status: ready-for-human
Blocked by: 01

Migrate every hand-rolled modal per spec § Design 3–4: lock-period → AlertDialog (Cancel + destructive confirm); reject/reverse/reopen reason and approve note → Dialog with DialogFooter (Annuler + submit disabled while invalid/submitting; shared validators stay the truth). ESC/overlay = cancel. Add `lib/notify.ts` (notifyCommandSuccess/Warnings/Error via sonner) and replace row-action success dialogs/banners with toasts (approve, reject, reverse, lock, reopen). Record screen outcome view unchanged. All strings via locale keys, fr + en.

Acceptance:
- [x] Command-routing jsdom tests updated for the new dialog structure and still assert the command-name sequences
- [x] Test: reject dialog submit disabled on empty reason; cancel closes without dispatch
- [x] Toast fired on approve success (sonner mock)
- [x] Web tests + typecheck green

## Comments

2026-07-26 [codex] clean first-round pass. All hand-rolled modals gone (no fixed inset-0 left in screens); AlertDialog for lock, Dialog+Footer with Annuler for the reason/note flows, shared validators still the enable truth; notify layer localizes per stable code with a generic fallback + console warn on missing keys. Command-sequence regressions preserved (approve->reject asserted), plus cancel-no-dispatch, empty-reason-disabled, and toast-on-success coverage. 140 web tests + typecheck green, Fable-verified.
