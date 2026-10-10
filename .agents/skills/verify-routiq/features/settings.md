# Settings

Direction manages branches; Direction and administrators manage users (logins with a role and branch scope; an administrator only drivers, technicians and cashiers in their branches); Direction and administrators manage people (drivers and crew without a login). There is no modules screen. Modules and template presets are vendor-only (ADR-0005): no tenant role can change them, and a tenant session sending `enable-module`, `disable-module` or `set-template-preset` gets 403 `COMMAND_SCOPE_FORBIDDEN`.

## Sub-features

- `set-branches` lists branches and creates, renames, deactivates or reactivates one.
- `set-users` lists users with role and branch scope, adds a user with a PIN, changes a role, resets a PIN, deactivates.
- `set-people` lists people and adds a person ("Ajouter une personne").
- `set-modules` has no UI. Switch a module or preset on slot N as the vendor, with the slot's Postgres (port 24000+10N) and its `commandPayloadHmacKey` from `.verify/slots/N/state.json`: `DATABASE_URL=postgresql://routiq_app:routiq_app@127.0.0.1:<pg>/routiq_dev AUTH_DATABASE_URL=postgresql://routiq:routiq@127.0.0.1:<pg>/routiq_dev COMMAND_PAYLOAD_HMAC_KEY=<key> pnpm --filter @routiq/api entitlement --workspace transports-ngwa --disable-module FINANCE` (also `--enable-module`, `--enable-preset`, `--disable-preset`). `pnpm verify up --reseed` puts the seed's modules and presets back. A module another one requires (`requires` in `MODULE_MANIFESTS`) is refused off while that one is on, and the dependent is refused on while it is off: `--disable-module ACTIVITIES` with Scheduling on fails `409 MODULE_STILL_REQUIRED`, `--enable-module SCHEDULING` with Trips off fails `409 MODULE_DEPENDENCY_DISABLED`. With a module off, a direct link to one of its pages shows "This module is not enabled for your company." and reads nothing (`flow:maintenance-off`; any set of modules: `flow:modules-off`).

## How to get to it (user POV)

- The More page is gone (#316; `/more` redirects to Home). The pages keep their paths and are rows of the sidebar's Company group (#312):
- Sidebar → "Agences" / "Branches" (`/more/branches`, DIRECTOR).
- Sidebar → "Utilisateurs" / "Users" (`/more/users`, DIRECTOR and ADMIN).
- Sidebar → "Personnel" / "People" (`/more/persons`, needs the trips module).

## Driving it with pnpm verify

Preconditions:

- Fresh seed: branches BAF, DLA, YDE; eight users, one or more per role; driver Jean Ngwa (DRV001). Settings (branches) are Direction's: use `--role director`. Users is open to `admin` for drivers, technicians and cashiers in their branches.

- **All three screens.** Run `pnpm verify drive flow:settings --role director --lang en`. For each it opens "Branches", "Users" or "People" from its Company row in the sidebar, waits for the heading, and screenshots. Cross-checks: every code from `GET /v1/branches` is a cell on the page; `GET /v1/members` returns 7 members; `GET /v1/persons` answers 200.
- **Create a branch.** In a DriveScript on `/more/branches`: "New branch" → fill "Code", "Nom"/"Name", pick "Fuseau horaire"/"Time zone" → "Créer"/"Create". Read back with `pnpm verify api GET /v1/branches --role admin`. Mutates.
- **Change a role.** On `/more/users`: the user's row "Actions" → "Change role" → pick the role → "Save". Read back with `GET /v1/members`. Mutates.
- **Non-admin.** `pnpm verify drive /more/users --role finance` shows the heading "Utilisateurs" over "Votre rôle ne permet pas cette action."; the sidebar has no Users or Branches row for that role.
- **Proof.** `01-branches.png`, `02-users.png`, `03-people.png` and the cross-check lines.

## Gotchas

- "Personnel"/"People" are not users: they have no login. Roles live on Users.
- The role select shows translated labels, not the role codes; read codes from `GET /v1/members`.
- The create-branch and change-role recipes are not yet driven by a committed flow. Write one in `tools/verify/flows/` the first time you need them, and fix the labels here if they drifted.
