# Deployment — GitHub, CI, and agent-autonomous delivery

Goal: agent works tasks end-to-end — branch, PR, CI green, merge, deploy to
the demo environment — without owner intervention per task. Owner intervenes
only at standing-authorization boundaries (secrets, money, production
promotion), not per change.

## Current state (verified 2026-07-30)

- **No git remote.** Repo is local-only; `main` is the working branch.
- `gh` authenticated as `truesignal-digital`, scopes `repo` + `workflow` —
  sufficient to create the repo, push, manage PRs, and configure Actions.
- No `.github/workflows`, no Dockerfile, no hosting config anywhere.
- `docker-compose.yml` runs the full stack cold (appliance seed, §6a guard 4)
  — the API service builds from the compose file, so a runnable container
  recipe exists there even without a standalone Dockerfile.
- Hosting decided (§8, not provisioned): Cloudflare Pages (PWA) + Render
  Frankfurt (API) + Supabase Frankfurt (DB/auth/storage). Latency caveat:
  measure MTN/Orange from Douala before committing region; if Paris wins,
  move API + DB together.
- Tests: vitest across packages; API tests hit Postgres (compose port 5435).
  CI needs a Postgres service container.
- Demo tenant reset script exists (`apps/api/scripts/seed-demo.ts`),
  provisioning via `scripts/provision.ts`.

## Environments

| Env | Purpose | Deploy trigger | Data |
|---|---|---|---|
| local | dev | manual | compose Postgres 5435 |
| **demo** | partner demo + pilot staging | auto on merge to `main` | routiq Postgres container on the owner's Hetzner box; `transports-ngwa` seed re-runnable |
| prod | real tenants (later) | manual promotion (owner clicks) | separate provisioning decision when a tenant signs; §8 managed stack remains the scale-up path |

**Demo host (decided 2026-07-30): the owner's existing Hetzner server**
(`178.156.253.244`, Ubuntu 24.04, Docker 29, hostname `jarvis-us`). Marginal
cost €0. Verified 2026-07-30: box already runs an unrelated project
(`servo-staging`: app + Caddy owning 80/443 + Postgres) plus Tailscale;
2.5 GB RAM and 28 GB disk free — enough for the ROUTIQ stack. The §8 managed
stack (Cloudflare Pages + Render + Supabase, $40–100/mo) is explicitly
deferred to prod, not abandoned — nothing in the code couples to either
(auth is app-owned username/PIN; no storage/bucket usage built yet).

Deploying with docker compose on a Linux box doubles as a standing rehearsal
of the §6a Topology B appliance path — every demo deploy proves the
distribution artifact still boots.

## Scope

### 1. Repo on GitHub

Private repo `truesignal-digital/routiq`. Push `main`. Branch protection on
`main`: PRs only, required check `ci`, no force-push (protects owner and
agent from each other equally). Owner action: none — `gh` scope covers it,
but the initial publish happens only on explicit owner go (standing git rule:
nothing is pushed until this spec is approved).

### 2. CI — `.github/workflows/ci.yml`

On PR and on `main`:

- pnpm install (frozen lockfile), Node 24, pnpm cached.
- `pnpm typecheck`; `pnpm test` — the API suite self-provisions Postgres via
  testcontainers (`apps/api/src/test/global-setup.ts`), no service container
  consumed by tests. A `postgres:17` service container exists anyway to
  rehearse the deploy-time `pnpm db:migrate` drizzle-kit CLI path
  (via `MIGRATION_DATABASE_URL`) before a merge can reach the box.
- Web build (`pnpm --filter @routiq/web build`) so PR failures surface before
  deploy, not during.
- `docker compose config -q` (§6a guard 4, cheap check; full cold boot is a
  nightly job).
- Single required status `ci` so branch protection has one stable name.
- Built as PR #1; merged reality is authoritative over this bullet list.

### 3. CD — deploy on merge to `main`

**Mechanism (revised 2026-07-31): self-hosted GitHub Actions runner on the
box** instead of SSH-from-CI. The runner (dedicated non-root user, docker
group, systemd service, labels `[self-hosted, demo]`) pulls jobs; no inbound
secret, no SSH key in GitHub, checkout uses the job's own token. Registration
uses a short-lived token minted via `gh api`. Private-repo default — PR
workflows from forks never reach self-hosted runners; same-repo branches do.

`.github/workflows/deploy-demo.yml`, `runs-on: [self-hosted, demo]`, runs
after `ci` succeeds on `main`, entirely on the box:

1. `git pull` in `/opt/routiq` (shallow clone of `main`).
2. `docker compose -f docker-compose.demo.yml build` — demo compose derives
   from the appliance compose: routiq Postgres (internal network, published
   nowhere — port 5432 stays closed, as it is today), API container, web
   static container. No port 80/443 binding of its own.
3. **Migrations before switch**: run `pnpm db:migrate` in a one-off container
   against the routiq Postgres. Failure halts the deploy with the old
   containers still serving.
4. `docker compose up -d` to switch, then smoke `/health` through the public
   URL; failure fails the workflow loudly.
5. Demo seed re-run only via `workflow_dispatch` input — never automatic,
   demo data may be mid-story with a partner.

**Routing/TLS**: the existing `servo-staging-caddy` owns 80/443 and gains one
site block reverse-proxying to the routiq containers. PWA requires a secure
context, so plain `http://<ip>` is not an option; without a real domain,
`routiq.178.156.253.244.nip.io` + Caddy auto-TLS covers it. If the owner has
a spare (sub)domain, an A record is strictly better — one-line question
before build. Touching `servo-staging`'s Caddy config is a change to the
owner's other project: the exact edit is proposed for owner approval in the
issue, applied once, and never modified by the deploy workflow afterwards.

**Backups**: nightly `pg_dump` of routiq Postgres via cron on the box,
rotated locally (7 dailies), copied off-box weekly by the owner until an
object-store target exists. Demo data is reseedable; this is cheap insurance,
not a compliance posture.

### 4. Secrets

**None in GitHub.** The self-hosted runner eliminates the SSH deploy key;
checkout uses the job token. Runtime env (`DATABASE_URL` with a generated
demo password, API port) lives in an env file on the box readable only by the
runner user. Sentry DSN joins later with observability (non-blocking). The
owner's personal SSH key never enters CI; agent sessions use it only for
box preparation, from the owner's machine.

### 5. Agent working agreement (the "without intervention" part)

What this spec, once approved, pre-authorizes for the agent — recorded in
CLAUDE.local.md so every future session inherits it:

- Create feature branches, commit, push to `origin`, open PRs — for work the
  owner asked for (a spec'd issue, a reported bug). No speculative branches.
- Merge own PR when: CI green + change is within the issue's spec + no
  migration touching approved/posted financial data semantics. Anything
  outside that → PR waits for owner review, agent says so explicitly.
- Deploys to **demo** happen implicitly via merge — that is the point.
- Never: force-push, history rewrite, secret handling, prod promotion,
  deleting the repo or branches others may hold, changing branch protection.
- Owner can revoke by editing CLAUDE.local.md; sessions check it every start.

### 6. On-prem guard

Nothing here may leak into business code: deploy stays in `.github/` +
provider dashboards. `docker-compose.yml` remains the cold-start distribution
artifact and CI asserts it stays buildable (compose config check in `ci`,
full cold-start boot as a nightly job, not per-PR — it's slow).

## Non-scope

- Production environment build-out (spec'd above, built when a real tenant
  signs).
- Topology B appliance update/licensing channel (§6a deferred list).
- Preview deploys per PR (Cloudflare Pages supports it; add when UI review
  needs it, not before).
- Custom domain, WAF, uptime paging — pilot uses provider subdomains.

## Build order

1. `ci.yml` + branch protection + initial push (needs: owner "go").
2. Box prep issue: deploy user + restricted key, `/opt/routiq` clone, `.env`,
   `docker-compose.demo.yml`, Caddy site block (exact diff proposed to owner
   — touches servo-staging's Caddy), domain-or-nip.io decision. Owner sets
   the two GitHub secrets.
3. `deploy-demo.yml` end-to-end; first demo deploy; then measure MTN/Orange
   latency from Douala to this US-region box — if it's painful for the
   partner demo, moving demo to a Falkenstein VPS (~€4/mo) is a compose-copy,
   not a redesign.
4. Nightly compose cold-start job + backup cron.
5. CLAUDE.local.md working-agreement entry (with owner's exact approved
   wording).
