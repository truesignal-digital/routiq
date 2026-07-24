# ROUTIQ Full-Identity Rename

Status: approved  
Approved by: Linus  
Date: 2026-07-23

## Objective

Rename the product and repository from the provisional asset-management
identity to the official name **ROUTIQ**. The result must identify the product
as ROUTIQ at every user-facing and technical identity boundary while retaining
business-domain language such as asset, asset register, and `asset_id`.

## Chosen Approach

Use a preserved, atomic cutover:

1. Back up the existing PostgreSQL development database.
2. Rename source-controlled identity markers.
3. Create ROUTIQ-named database resources and restore existing data.
4. Rename the repository and UI worktree directories.
5. Reinstall dependencies and verify source, migrations, tests, build, Docker,
   Git worktrees, and runtime identity.
6. Keep the database backup until the cutover has been verified.

This provides a clean ROUTIQ identity without discarding seeded, demo, or pilot
records.

## Rename Map

| Boundary | Old | New |
|---|---|---|
| Product display name | Asset Management | ROUTIQ |
| Repository directory | `asset-management` | `routiq` |
| UI worktree directory | `asset-management-web` | `routiq-web` |
| Root package | `asset-management` | `routiq` |
| Package scope | `@asset/*` | `@routiq/*` |
| Development database | `asset_dev` | `routiq_dev` |
| Database owner/login | `asset` | `routiq` |
| Restricted runtime role | `asset_app` | `routiq_app` |
| Browser session key | `asset.sessions.v1` | `routiq.sessions.v1` |
| Docker Compose project identity | directory-derived asset-management name | explicit `routiq` |
| PostgreSQL volume | asset-management-derived volume | `routiq_pgdata` |
| Default S3 development credential | `asset` | `routiq` |

Package names are lowercase because npm requires it. The visible brand remains
uppercase **ROUTIQ**.

## Source and Migration Policy

- Update package manifests, imports, scripts, lockfile, UI copy, PWA metadata,
  environment examples, Docker configuration, tests, documentation, and agent
  instructions.
- Update setup migrations so a fresh installation creates `routiq_app` and
  contains no obsolete product identity.
- Do not rename domain concepts: assets, asset lifecycle, asset commands,
  tables such as `assets`, or identifiers such as `asset_id`.
- Do not rewrite Git commit history.
- Do not modify archived Claude session transcripts; they are external
  historical records and renaming them would disconnect session discovery.

## Existing Work Protection

- Preserve all uncommitted financial-core work in the primary worktree.
- Preserve the uncommitted documents-screen work in the `web-ui` worktree.
- Rename both worktree directories through Git-aware operations so `.git`
  worktree metadata remains valid.
- Stage rename changes explicitly; never sweep unrelated work into a commit.

## Database Cutover

1. Create a timestamped custom-format `pg_dump` backup outside the repository.
2. Stop the existing Compose services.
3. Create the ROUTIQ Compose project and `routiq_pgdata` volume.
4. Apply the renamed migration chain to `routiq_dev`.
5. Restore application data where required, or rename/transfer the existing
   database when that produces a safer equivalent result.
6. Verify row counts and migration state before retiring old containers or
   volumes.

Destructive cleanup happens only after the ROUTIQ database has passed
verification and the backup path is known.

## Verification

The rename is complete only when:

- repository searches find no obsolete technical identity outside explicitly
  documented historical context;
- all workspace packages resolve under `@routiq/*`;
- typechecking, unit/integration tests, and the production web build pass,
  except for pre-existing unfinished financial-core failures that are
  separately identified and unchanged;
- a fresh database can run the complete renamed migration chain;
- the preserved development database is available as `routiq_dev`;
- Docker uses the ROUTIQ project, database, credentials, and volume;
- both Git worktrees are valid at their ROUTIQ paths;
- the web UI visibly identifies itself as ROUTIQ.

