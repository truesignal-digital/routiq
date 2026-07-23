# Wayfinder map: MTP live with pilot operators

Label: wayfinder:map
Tracker: local markdown (this directory; see conventions in mattpocock/skills issue-tracker-local.md)

## Destination

Phase 1 MTP running in production with the partners' two pilot businesses (one trucking, one travel agency): every decision blocking build, config, and pilot deployment resolved. Build execution is handed off as the way clears — it is not charted as tickets here.

## Notes

- Canonical spec: [ARCHITECTURE.md](../../ARCHITECTURE.md) v0.2 — domain model, schema, command layer, deployment topologies, decision log #1–27. All pre-map decisions live there, not in Decisions-so-far.
- Business context: partners Azalea & Ange bring Cameroon clientele + domain knowledge; Linus builds. Phase 0 concierge pilot runs **in parallel** with spine build (decided at charting, 2026-07-22).
- Standing preferences: ~/.claude/CLAUDE.md (pnpm/bun, no commits unless asked, verify by running, keep implementations simple).
- Adaptations: no git repo yet → research findings recorded inline in ticket files (no research/ branches). HITL tickets involving partners resolve through Linus relaying — the agent never invents partner answers.
- Tickets are decisions or decision-unblocking tasks, one agent session each. Never resolve more than one per session (research excepted).

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Repo + scaffold baseline](issues/05-repo-baseline.md) — git repo live on `main`, root commit `0448daf`; toolchain pinned per §8 (drizzle now exact); typecheck + 7 tests green. Build hand-off structure unblocked.

- [Research: Supabase Storage S3 compatibility vs MinIO](issues/13-research-supabase-s3-minio.md) — S3 API portable for CRUD/multipart/presigned URLs; TUS resumable upload needs a dual-path abstraction *only if* on-prem means a raw S3 store; **MinIO is unmaintained (archived Apr 2026) → on-prem target is RustFS**. Surfaced ticket: on-prem storage shape (14).
- [Research: WhatsApp Business Cloud API for Cameroon alerts](issues/12-research-whatsapp-api.md) — utility messages to Cameroon ≈ $0.004/msg ("Rest of Africa" rate) → ~$2–5/month at pilot scale; the blocker is Meta Business Verification lead time + a dedicated number + intl card, not cost. Recommendation: in-app for MTP, WhatsApp fast-follow; start verification in parallel if partners can supply business docs. Unblocks the channel decision (11).

## Not yet specified

- Composite sheet form field lists (haulage job sheet, journey sheet) — awaits Phase 0 forms being used on paper; graduates when pilot kit (01) is in the field.
- Approval-rules seed data per tenant — awaits thresholds (06) + pilot observations.
- Build hand-off structure (spec → implementation tickets for build steps 1–7) — graduates once architecture sign-off (02) and repo baseline (05) resolve.
- Pilot go/no-go criteria and success metrics for "MTP live".
- Historical backfill scope for the two pilot tenants (30–90 days: which records, which format).
- On-prem appliance packaging + first LAN client — awaits demand qualification with partners (§12.8a).
- WhatsApp digest implementation shape — awaits channel decision (11).

## Out of scope

- Ticketing module build — planned optional module behind workspace flag (ARCHITECTURE.md §3.3a), post-MTP.
- Phase 2 AI features (receipts, voice, queries) — separate effort per §7.
- Business terms between Linus and partners (pricing, revenue split) — negotiation, not a build decision; pilots run free.
- SMS notification channel — rejected; WhatsApp or in-app only.
- Desktop app in any form — rejected 2026-07-22; PWA covers desktop, appliance packaging is a §6a concern.
- React Native driver app — trigger is the GPS module, outside this destination.
