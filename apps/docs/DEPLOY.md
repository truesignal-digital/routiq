# Deploying the tester handbook

The tester handbook is a static VitePress site served by the box's shared `edge-caddy` proxy. It is
available on both ROUTIQ demo hostnames:

- `https://demo.truesignaldigital.com/team-docs-k4v9w2/`
- `https://routiq.178.156.253.244.nip.io/team-docs-k4v9w2/`

The path is public but unlisted. Caddy sends `X-Robots-Tag: noindex, nofollow`, and the pages carry the
same robots directive in their HTML. This is not authentication; anyone with the URL can open it.

`DEPLOY.md` and `CREDENTIALS.md` are excluded from the VitePress build through `srcExclude` in
`.vitepress/config.ts`.

## Deployment layout

- Server: `root@178.156.253.244`
- Static files: `/srv/routiq/team-docs/`
- Shared proxy container: `edge-caddy`
- Shared proxy compose file: `/srv/edge/compose.yml`
- Global Caddyfile: `/srv/edge/Caddyfile` — never edit it for a project deployment
- ROUTIQ site file: `/srv/edge/sites/routiq-demo.caddy`
- Files and Servo site files: do not edit `files.caddy` or `servo.caddy`

The shared proxy compose service mounts the handbook read-only:

```yaml
volumes:
  - ./Caddyfile:/etc/caddy/Caddyfile:ro
  - ./sites:/etc/caddy/sites:ro
  - /srv/routiq/team-docs:/srv/routiq/team-docs:ro
  - caddy_data:/data
  - caddy_config:/config
```

The mount is one-time proxy configuration. Ordinary handbook deployments only rebuild and synchronize
the static files.

## Build the site

From the `docs/tester-handbook` worktree:

```bash
pnpm --filter @routiq/docs build
```

The build output is `apps/docs/.vitepress/dist/`. VitePress bakes `/team-docs-k4v9w2/` into links,
assets, and the local search index through `base` in `.vitepress/config.ts`.

Preview the production output locally when needed:

```bash
pnpm --filter @routiq/docs preview
```

## Synchronize the build

Create the destination and synchronize the contents of `dist/`:

```bash
ssh root@178.156.253.244 'mkdir -p /srv/routiq/team-docs'

rsync -avz --delete \
  apps/docs/.vitepress/dist/ \
  root@178.156.253.244:/srv/routiq/team-docs/
```

The trailing slash on `dist/` copies its contents directly into `/srv/routiq/team-docs/`. `--delete`
removes pages and search assets left by an older build.

## Configure shared proxy access

This section is only needed if the read-only mount is absent from `/srv/edge/compose.yml`.

Add this line to the `caddy` service's `volumes`:

```yaml
- /srv/routiq/team-docs:/srv/routiq/team-docs:ro
```

Recreate the shared proxy:

```bash
ssh root@178.156.253.244 'cd /srv/edge && docker compose up -d'
```

This briefly interrupts every vhost on the box. Confirm the unrelated files host and the demo app have
recovered before changing a site rule:

```bash
curl -sI https://files.truesignaldigital.com/
curl -sI https://demo.truesignaldigital.com/
```

Both must return `200`.

## Configure the ROUTIQ site

Back up the project site file before editing it:

```bash
ssh root@178.156.253.244 \
  'cp /srv/edge/sites/routiq-demo.caddy /srv/edge/sites/routiq-demo.caddy.bak'
```

Keep the existing comment header and both hostnames in `/srv/edge/sites/routiq-demo.caddy`. The site
block must be:

```caddyfile
routiq.178.156.253.244.nip.io, demo.truesignaldigital.com {
	handle_path /team-docs-k4v9w2/* {
		root * /srv/routiq/team-docs
		header X-Robots-Tag "noindex, nofollow"
		file_server
	}
	handle {
		reverse_proxy routiq-demo-web:80
	}
}
```

The `handle_path` must remain above the SPA catch-all `handle`. It strips the handbook prefix before
the file server resolves a path. If the reverse proxy runs first, the demo PWA returns its own app shell
for handbook URLs instead.

Do not edit `/srv/edge/Caddyfile`, `files.caddy`, or `servo.caddy`.

## Validate and reload Caddy

Validate the assembled configuration inside the running container before reloading it:

```bash
ssh root@178.156.253.244 \
  'docker exec edge-caddy caddy validate --config /etc/caddy/Caddyfile'
```

If validation fails, restore `/srv/edge/sites/routiq-demo.caddy.bak` and stop. Do not reload or retry by
guessing.

After a successful validation:

```bash
ssh root@178.156.253.244 \
  'docker exec edge-caddy caddy reload --config /etc/caddy/Caddyfile'
```

## Verify the deployment

Check both handbook hostnames and the two services that must remain unaffected:

```bash
curl -sI https://demo.truesignaldigital.com/team-docs-k4v9w2/
curl -sI https://routiq.178.156.253.244.nip.io/team-docs-k4v9w2/
curl -sI https://demo.truesignaldigital.com/
curl -sI https://files.truesignaldigital.com/
```

Expected results:

- Both handbook URLs return `200`.
- The handbook response includes `X-Robots-Tag: noindex, nofollow`.
- The demo app still returns `200` at `/`.
- The files host still returns `200`.

Finally, open a walkthrough page in a real browser and confirm:

- Screenshots load.
- Local search returns results.
- The Mermaid workflow diagram renders.

## Repeat deployment checklist

- [ ] `pnpm --filter @routiq/docs build` passes.
- [ ] The `dist/` contents are synchronized with the trailing source slash and `--delete`.
- [ ] Both handbook hostnames return `200` with the noindex header.
- [ ] The demo app and files host still return `200`.
- [ ] Screenshots, local search, and Mermaid render in a browser.
