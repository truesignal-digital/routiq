# 03 — Dialog migration + action toasts

Status: ready-for-agent
Blocked by: 01

Migrate every hand-rolled modal per spec § Design 3–4: lock-period → AlertDialog (Cancel + destructive confirm); reject/reverse/reopen reason and approve note → Dialog with DialogFooter (Annuler + submit disabled while invalid/submitting; shared validators stay the truth). ESC/overlay = cancel. Add `lib/notify.ts` (notifyCommandSuccess/Warnings/Error via sonner) and replace row-action success dialogs/banners with toasts (approve, reject, reverse, lock, reopen). Record screen outcome view unchanged. All strings via locale keys, fr + en.

Acceptance:
- [ ] Command-routing jsdom tests updated for the new dialog structure and still assert the command-name sequences
- [ ] Test: reject dialog submit disabled on empty reason; cancel closes without dispatch
- [ ] Toast fired on approve success (sonner mock)
- [ ] Web tests + typecheck green
