# Sign in and switch roles

A user signs in with a workspace, a username and a numeric PIN, lands on Home (or the page they were sent from), and can sign out and sign in as someone else. What each role sees afterwards differs: navigation is gated by module, pages and actions by role.

## Sub-features

- `signin-ok` signs in with the workspace, username and PIN and lands on `/`.
- `signin-redirect` returns to the requested page after `/login?redirect=<path>`.
- `signin-wrong-pin` shows the stable error for a wrong PIN and clears the PIN.
- `signout` signs out from the sidebar footer or the More page and returns to `/login`.
- `switch-role` signs in as a different seeded account in the same browser.
- `session-persists` keeps the session across a full reload (14-day token in `localStorage["routiq.sessions.v1"]`).

## How to get to it (user POV)

- Open any page while signed out; the app redirects to `/login`.
- Sidebar footer → "Se déconnecter" / "Sign out".
- More (`/more`) → "Se déconnecter" / "Sign out".

## Driving it with pnpm verify

Preconditions:

- Slot up and doctor PASS; the seven accounts in `../SKILL.md` exist (doctor's login checks).

- **Sign in.** Run `pnpm verify login --role admin`. The form is filled by label: "Espace de travail" = `transports-ngwa`, "Nom d'utilisateur" = `boris`, "Code PIN" = `222222`, then "Se connecter". The step `log in as boris` passes and the screenshot shows Home with `boris` and `transports-ngwa` in the sidebar footer.
- **Every role.** Repeat with `--role director|admin|admin-yde|finance|cashier|technician|driver|driver-yde`. `pnpm verify doctor` already proves each PIN works against the API.
- **Switch role.** Run `pnpm verify drive flow:switch-user --role director --lang en`. It clicks "Sign out", lands on `/login`, signs in as `clarisse` (CASHIER), and checks Home has no `[data-kpi="pendingApprovals"]` card. The flow's API cross-check reads `GET /v1/me` → role `CASHIER`.
- **Wrong PIN.** In a DriveScript, sign out, fill the form with a wrong PIN and click "Se connecter". `getByRole("alert")` reads "Nom d'utilisateur ou code PIN incorrect." and the "Code PIN" field is empty. The API answers `401 {"error":{"code":"AUTH_INVALID_CREDENTIALS"}}`. Not yet a committed flow.
- **Proof.** Screenshots `01-signed-out.png` and `02-home-as-clarisse.png` in the run directory, plus the `/v1/me` line on stdout.

## Gotchas

- Five wrong PINs lock the account for 15 minutes (`AUTH_LOCKED`). Use a throwaway attempt count, or reseed.
- Workspace and username are prefilled from the last identity on this browser profile. Each drive uses a fresh profile, so they start empty.
- `patrice` is scoped to YDE and every seeded truck is in DLA, so his trucks list is empty. That is the expected branch-scoped view, not a bug.
- `herve` (TECHNICIAN) sees "Finances" in the sidebar but gets a permission screen there; the sidebar gates by module, not role.
