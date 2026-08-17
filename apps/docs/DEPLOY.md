# Deploying the tester handbook

The handbook is a static VitePress site served by the box's existing Caddy under an obscure path on
the demo vhost. It is **not** part of the demo app's container, is not built by CI, and is not in the
root `typecheck`/`test` pipelines — publishing it is a manual step.

This file is excluded from the site build (`srcExclude` in `.vitepress/config.ts`), so it never ships
to the box.

## 1. Build

```bash
pnpm install
pnpm --filter @routiq/docs build
```

Output: **`apps/docs/.vitepress/dist/`**

Every link, asset, and search-index URL in that output is prefixed with `/team-docs-k4v9w2/`, because
`base` is set in `.vitepress/config.ts`. Change `base` and you must rebuild — the path is baked into
the HTML, not resolved at request time. Sanity check before shipping:

```bash
grep -o '/team-docs-k4v9w2/[^"]*' apps/docs/.vitepress/dist/index.html | head
```

To preview the built output locally (serves at the base path):

```bash
pnpm --filter @routiq/docs preview
```

## 2. Copy to the box

The demo box is the owner's Hetzner server (`178.156.253.244`, hostname `jarvis-us`). Put the site
next to the other ROUTIQ runtime files:

```bash
rsync -avz --delete \
  apps/docs/.vitepress/dist/ \
  <you>@178.156.253.244:/srv/routiq/team-docs/
```

`--delete` is deliberate: stale pages from a previous build would otherwise stay reachable and stay
in the search index. The trailing slash on the source is what copies the *contents* of `dist/`
rather than a nested `dist/` directory — getting this wrong lands the site at
`/srv/routiq/team-docs/dist/` and every URL 404s.

Caddy runs in the `servo-staging-caddy` container, so `/srv/routiq/team-docs` must be visible inside
it. Add a read-only bind mount to that project's compose service (once, not per deploy):

```yaml
volumes:
  - /srv/routiq/team-docs:/srv/routiq/team-docs:ro
```

## 3. Caddy site block

This edit belongs to the **servo-staging** Caddyfile — the owner's other project, which owns 80/443
on the box. Propose it, get approval, apply it once; the deploy workflow must never touch it.

```caddyfile
routiq.178.156.253.244.nip.io {
	# The handbook is internal. Keep it out of search indexes at the edge as
	# well as in the page <head>, since crawlers that ignore the meta tag
	# still honour the header.
	handle_path /team-docs-k4v9w2/* {
		root * /srv/routiq/team-docs
		header X-Robots-Tag "noindex, nofollow"
		file_server
	}

	# MUST stay below the handle_path block above. This is the demo PWA's
	# catch-all: the web container answers any unmatched path with the SPA's
	# index.html so client-side routing works. If it were matched first, a
	# request for /team-docs-k4v9w2/ would be proxied into the SPA and come
	# back as HTTP 200 with the app shell — the handbook would silently never
	# be served, and there would be no 404 to point at the cause.
	handle {
		reverse_proxy routiq-demo-web:80
	}
}
```

Notes:

- `handle_path` (not `handle`) strips the `/team-docs-k4v9w2` prefix before `file_server` resolves
  the file, so `root` points at the directory holding `index.html` directly. Pair it with the
  matching `base` in the VitePress config — the prefix has to be stripped on the way in and re-added
  on the way out, and those two settings are the two halves of that.
- Both blocks are `handle` blocks so they are mutually exclusive and evaluated in written order. If
  the site block ever grows other path rules and the ordering gets hard to reason about, wrap the
  whole thing in `route { … }`, which forces literal top-to-bottom evaluation.
- Reload without dropping connections: `docker exec servo-staging-caddy caddy reload --config /etc/caddy/Caddyfile`.
- The public hostname actually in use comes from `PUBLIC_URL` in `/srv/routiq/demo.env`; use that
  hostname if it differs from the nip.io default above.

## 4. Verify

```bash
curl -sI https://routiq.178.156.253.244.nip.io/team-docs-k4v9w2/ | grep -i 'HTTP/\|x-robots-tag'
```

Expect `200` and `X-Robots-Tag: noindex, nofollow`. Then open the URL in a browser and confirm the
sidebar navigates, local search returns results, and a mermaid diagram renders. Also confirm the demo
app itself still loads at `/` — a misordered Caddy block breaks the app, not just the docs.

## Checklist

- [ ] `pnpm --filter @routiq/docs build` passes locally.
- [ ] **Capture the Start Here screenshots against the live demo app and drop them into
      `apps/docs/public/`.** Several pages reference image slots that are empty until this is done.
      Files in `public/` are copied to the site root, so `public/login.png` is referenced in markdown
      as `![…](/login.png)` — VitePress adds the base path at build time, do not write it yourself.
      Use the English UI (app language switched to English) so the screenshots match the handbook's
      steps.
- [ ] `rsync` with `--delete` completed.
- [ ] Caddy block present, ordered above the SPA catch-all, config reloaded.
- [ ] `curl` shows 200 + `X-Robots-Tag`.
- [ ] Demo app still serves at `/`.
