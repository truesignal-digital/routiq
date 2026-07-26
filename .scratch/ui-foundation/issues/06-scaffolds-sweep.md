# 06 — Page scaffolds + sweep + regression

Status: ready-for-agent
Blocked by: 02, 03, 04, 05

Build `components/page.tsx` (PageHeader/EmptyState/ErrorState/LoadingState with skeletons) per spec § Design 7 and sweep ALL screens onto them, deleting per-screen copies. No command/intent logic may change. Locale sweep for any new keys (fr + en, parity test must stay green).

Acceptance:
- [ ] grep shows no remaining hand-rolled `fixed inset-0` modals or bespoke loading/empty/error markup in screens
- [ ] Full repo pnpm test + typecheck green; command-routing regression tests green
- [ ] Walkthrough notes in Comments for ready-for-human review
