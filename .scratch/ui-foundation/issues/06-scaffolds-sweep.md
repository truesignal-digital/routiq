# 06 — Page scaffolds + sweep + regression

Status: ready-for-human
Blocked by: 02, 03, 04, 05

Build `components/page.tsx` (PageHeader/EmptyState/ErrorState/LoadingState with skeletons) per spec § Design 7 and sweep ALL screens onto them, deleting per-screen copies. No command/intent logic may change. Locale sweep for any new keys (fr + en, parity test must stay green).

Acceptance:
- [x] grep shows no remaining hand-rolled `fixed inset-0` modals or bespoke loading/empty/error markup in screens
- [x] Full repo pnpm test + typecheck green; command-routing regression tests green
- [x] Walkthrough notes in Comments for ready-for-human review

## Comments

2026-07-26 [codex] final ticket, clean pass. page.tsx scaffolds (PageHeader/EmptyState/ErrorState/LoadingState) with jsdom coverage; sweep verified by independent greps: zero fixed-inset-0 modals in screens, PageHeader on all 9 full screens (login + 2 stubs excluded by design), command/intent logic and data hooks untouched. Full repo gate: 384 tests (150 web / 174 api / 57 contracts / 3 domain) + typecheck green. ui-foundation effort complete: six tickets, six commits.
