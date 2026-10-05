# One list of people; app access is optional and belongs to a person

A **Person** is someone who works for the company and appears in its records:
drivers, mechanics, hostesses, convoyeurs, managers. **App access** is the
login, role and branches that let a person use ROUTIQ. The two stay separate
records, but every app access belongs to exactly one person, and the app shows
one list of people. It does not show two lists that overlap. (Decided
2026-09-27.)

Before this decision the app had two screens for the same humans:
"Personnel" (persons: drivers and crew, no login) and "Utilisateurs"
(members: login and role). A driver who got a login existed twice, with no
link shown. An administrator with a login had no person record. "Custodian"
pointed at a member, so a driver without a login could never be one.

The model:

- **Person** (`persons`): name, phone, staff code, home branch, **Fonction**
  (Chauffeur, Mécanicien, Hôtesse, Convoyeur, Caissier, Autre), active. Records
  that name the people who did the work, such as trip crew, labour lines and
  individual payees, point to the person.
- **App access** (`memberships`, with credentials): role (ADR-0009), Branch
  Scope, username and PIN, active. At most one per person per workspace, and
  never without a person.
- **Principal**: the internal identity that signs commands. Humans, AI agents
  and integrations have one. It is never shown in the UI.

Rules:

- **Giving access starts from the person.** "Donner l'accès à l'application"
  on the person page adds a role, branches and a username. For someone new,
  the admin fills in the person and the access in one form. There is no
  separate "add user" that creates a nameless login.
- **Removing access keeps the person and all history.** A person who leaves
  the company is deactivated, and deactivating a person also removes their
  access. Nothing is deleted.
- **Fonction is not Role.** Fonction says what the person does on the ground.
  Role says what they may do in the app. A Chauffeur by Fonction given access
  gets the Chauffeur role by default, and the admin can change it. Job titles
  such as DG or Chef de parc are free text on the person. They are not a Fonction
  and not a role.
- **Custodian is replaced by Chauffeur attitré (Assigned driver).** It is an
  optional person on the vehicle, and that person must have the Chauffeur
  Fonction. They need no login. Accountability for a vehicle comes from its
  home branch's Administrateur, so "Custodian" leaves the vocabulary.
- **Companies are not people.** Garages, fuel stations and suppliers are
  counterparties now and a Suppliers list later (Fleetio keeps Vendors apart
  from Contacts). Only individual payees are people.

Why not merge the tables:

- **Most people in the records never log in.** Hostesses, convoyeurs and
  many drivers never do. Every surveyed fleet product keeps such people as records
  without a login: Fleetio contacts, Odoo's driver field pointing at a contact,
  Wialon drivers inside a resource.
- **Some principals are not people.** AI agents and integrations sign commands
  (ARCHITECTURE.md §7) and must never appear in Personnel.
- **Auth stays behind its thin interface** (§6a). Credentials and sessions
  must be replaceable without touching business records.
- **Keeping two records is not the confusion.** Showing them as two lists is.
  Fleetio's "Enable user access on a contact" solves exactly this, and it is
  the pattern adopted here.

Consequences:

- **Existing members get backfilled.** Each member without a person gets one
  in its home branch, or its first scoped branch. The link becomes required
  and unique (it builds on the unmerged `feat/identity-capabilities`
  link/unlink work, which must be reconciled first).
- **One people screen.** "Personnel" becomes the only people screen, with an
  "Accès" column and filter. The Utilisateurs screen folds into it, and its
  access actions (role, PIN reset, remove access) move to the person page.
- **The vehicle workspace changes.** `custodian_membership_id` (on `develop`
  since the vehicle workspace merged) becomes `assigned_driver_person_id`
  through a migration. The `CUSTODIAN_INELIGIBLE` error becomes "not an
  active person with the Chauffeur Fonction".
- **Fonction values change.** They grow from DRIVER, CONDUCTOR, ASSISTANT,
  RELIEF, MECHANIC, CLERK, OTHER to include HOSTESS and CASHIER, with French
  labels from the team's words. Existing values map one to one.
