# 04 — Queueable flag + offline decision gating

**What to build:** Every command gets an explicit `queueable` boolean in a registry in packages/contracts. Decision commands (asset lifecycle transitions, period locks) are non-queueable; offline attempts render "connexion requise pour cette décision", not an error.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Add `commandQueueability` registry in `packages/contracts/src/commands/index.ts` (or new file): Map<commandName, boolean>; declare: register-asset=true, add-or-renew-document=true, commission-asset=false, assign-asset=true (custody movement is a physical fact per §6; server flags discrepancies), module-toggle=true; future decision commands default false
- [ ] In `apps/web/src/commands/client.ts`, check offline state + queueability before submit: if offline + !queueable, show designed state "Cette décision requiert une connexion" (fr, non-dismissible, input disabled)
- [ ] Meta-test in `packages/contracts`: every command exported from contracts has an entry in commandQueueability (registry guard proves no command slips through undeclared)
- [ ] Unit tests: offline + queueable=false shows connection-required state; offline + queueable=true proceeds to outbox; online proceeds regardless
