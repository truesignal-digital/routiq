# Administrators change the company settings, as well as Direction

The company settings are the approval thresholds (the recording band and the
band up to which Finance decides) and the Dashboard summary schedule. Direction
and the Administrateur role may both change them. Every other role is refused.
(Owner decision 2026-10-10, #711.) This amends one rule of ADR-0009, which gave
every setting to Direction; ADR-0009 asks for a new record when a role is
re-permissioned.

Why:

- **The owner decided it.** The people who control the company settings are
  the Director and the Administrators (2026-10-10).
- **The settings are company rules, not branch rules.** Each is one rule for
  the whole workspace. An Administrateur scoped to one branch changes the
  company's rule, never a copy for their branch. Approval rules kept to one
  branch or one category are exceptions the thresholds leave alone, whoever
  changes them.
- **Changes stay visible.** Every change is a command with an audit event in
  the name of whoever made it. A threshold change shows a notice to every
  member whose own entries it moves, naming who changed the rules; the person
  who made the change is not told about it.

What stays Direction's:

- Branches, categories and reopening a period. Modules and presets stay
  vendor-only (ADR-0005).
- Deciding entries above Finance's band. An Administrateur who raises Finance's
  band changes who decides, but cannot decide entries themselves: approve-entry
  and reject-entry remain Finance's and Direction's.

Consequences:

- `COMPANY_SETTINGS_ROLES` in `packages/contracts/src/roles.ts` is the one list.
  The commands (`update-approval-threshold` v1 and v2, `set-summary-schedule`),
  the reads (`GET /v1/approval-thresholds`, `GET /v1/company-settings`) and the
  web (`canManageCompanySettings`) all use it.
- The catalog approval defaults give ADMIN a rule for both commands, and
  migration 0051 gives existing workspaces the same rows.
- No command version changes: who may run a command is not part of its payload,
  so the contract snapshots stay as they are.
- The roles and access reference, the role matrix test and the Company
  settings page copy say "the Director and Administrators".
