# 02 — Role, branch, and module-aware shell

**What to build:** The shell renders only what the signed-in member can actually do: role gates every mutating affordance, branch scope pre-filters reads, disabled modules remove their nav sections entirely.

**Blocked by:** None (backend dependency: `enabledModules` on `/v1/me` — spine session, done 2026-07-23).

**Status:** ready-for-agent

- [ ] `/v1/me` context (role, branchScope, principalType, enabledModules) loaded once at login, exposed via a provider, refreshed on 401
- [ ] EXECUTIVE_VIEWER sees zero submit/mutate affordances anywhere (asserted by a component test per screen as screens land)
- [ ] Nav sections for a disabled module (e.g. ASSETS off) are absent, not greyed
- [ ] Branch-scoped members see lists pre-filtered to their branches; ALL-scope sees everything
- [ ] Component tests for the three gate types (role, module, branch)
