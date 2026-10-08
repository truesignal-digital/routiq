# Six fixed roles, named in the team's words

ROUTIQ has exactly six roles: **Direction**, **Administrateur**, **Finance**,
**Caissier**, **Technicien** and **Chauffeur**. They replace the six built
roles (ADMIN, OPS_MANAGER, FIELD_SUBMITTER, MAINTENANCE, FINANCE_APPROVER,
EXECUTIVE_VIEWER). Roles stay code, never tenant data: a workspace cannot add,
rename or re-permission one. Which branches a person reaches is set beside the
role (Branch Scope), never by a new role. (Decided 2026-09-27.)

| Code | fr | en | Team profile ("Trucking Use Case", 2026-08-04) | Replaces |
|---|---|---|---|---|
| `DIRECTOR` | Direction | Director | SUPERBOSS | ADMIN (settings part), EXECUTIVE_VIEWER |
| `ADMIN` | Administrateur | Administrator | ADMIN (branch manager; Chef d'agence in the org chart) | ADMIN (daily part), OPS_MANAGER |
| `FINANCE` | Finance | Finance | FINANCE | FINANCE_APPROVER |
| `CASHIER` | Caissier / Caissière | Cashier | CASHIER | — (new) |
| `TECHNICIAN` | Technicien | Technician | — (added in the 2026-09 review) | MAINTENANCE |
| `DRIVER` | Chauffeur | Driver | DRIVERS | FIELD_SUBMITTER |

What each role does, feature by feature, is in
[the roles and access reference](../reference/roles-and-access.md). It is the
training source; this ADR records why.

Why:

- **The team already defined the profiles.** The pilot team's use-case
  document names Superboss, Admin, Finance, Cashier and Drivers. Users will be
  trained on these words, so the app uses them. The built set used
  engineering words ("Field submitter", "Executive (read-only)") that the team
  had to translate, and its read-only executive contradicted the team's
  Superboss, who approves, rejects with comments and manages users. That gap
  produced two of the 2026-09 review points (executive notes, finance payments).
- **It matches the industry shape.** Fleetio, Samsara, Motive and Whip Around
  all converge on: an owner at the top, an operations manager who runs
  everything except settings and users, a finance or billing gate, and narrow
  mechanic and driver roles. Whip Around ships five fixed roles of this kind.
  Scope (region, team, record set) is always layered on top, never a new role.
  Sources in [the research note](../research/2026-09-27-roles-and-people.md).
- **Technicien stays.** The team's use-case document has no mechanic profile,
  but its 2026-09 review of the vehicle workspace reviewed the technician view
  and kept it. Workshops log parts, labour and readings without seeing the
  books.
- **Caissier is fixed now, even though few of its features exist yet.** The
  team named it. Adding it later would change training material; reserving it
  now does not.
- **Administrateur is the Chef d'agence of the org chart.** The role keeps
  the team's own word, Administrateur. In the company's organisation it is the
  Chef d'agence, the person who runs a branch day to day. Training material
  says so. The role usually covers one branch, shown as "Administrateur ·
  Bafoussam", and may cover several. It holds no settings: those belong to
  Direction. Other job titles (DG, Chef de parc, Chef de garage) are the
  person's Fonction or free text, not a role (ADR-0010).
- **No read-only role.** Nobody in the pilot needs one. A board member or
  auditor role would be purely additive later and would change no existing
  role.

Rules that go with the roles:

- **Direction always covers every branch.** Every other role covers the
  branches its access lists.
- **Settings belong to Direction:** branches, categories, approval bands,
  template presets. Modules stay vendor-only (ADR-0005).
- **App access is managed by Direction for every role.** An Administrateur may
  give, change or remove access only in their own branches, and only for the
  Chauffeur, Technicien and Caissier roles. Nobody changes their own role.
- **Default approval chain:** work orders go to the Administrateur of the
  branch, money entries go to Finance, and anything above the top amount band
  goes to Direction. Direction may approve anything. The bands remain tenant
  data (Approval Chain); only these defaults change.
- **Nobody approves a record they submitted.** Entry and work-order decisions
  already refuse it (`MAKER_CANNOT_APPROVE`), and so does release to service
  (`SELF_RELEASE_FORBIDDEN`). The change keeps these and covers every
  decision command with one test.
- **Money visibility:** Direction, Administrateur (own branches) and Finance
  read the ledger. Caissier reads the entries of their branches. Technicien
  reads only the cost lines of work orders in their branches. Chauffeur reads
  only what they submitted. The built set let FIELD_SUBMITTER read the whole
  ledger; that changes.

Consequences:

- The migration is a plain map and promotes nobody (owner, 2026-10-04: "Admin
  is admin"): ADMIN, OPS_MANAGER and EXECUTIVE_VIEWER become ADMIN;
  FIELD_SUBMITTER becomes DRIVER; MAINTENANCE becomes TECHNICIAN;
  FINANCE_APPROVER becomes FINANCE. Existing workspaces get their DIRECTOR by
  hand afterwards, through a vendor-operator path, because no tenant role may
  grant Direction. New workspaces get theirs at provisioning: the first
  account is DIRECTOR.
- Every `allowedRoles` list, the approval defaults (new migration plus backfill
  into existing workspaces), `FINANCE_READER_ROLES`, the read gates, web
  capabilities, the i18n labels and the demo seed change, tested per role.
  The work ships as several PRs that each leave `develop` consistent, and
  `develop` is released to `main` only after all of them land.
  `ARCHITECTURE.md` §10 is updated to this list.
- Once shipped, renaming or re-permissioning a role needs a new ADR and new
  training material. Features added later slot into existing roles through the
  reference table; they do not create roles.
