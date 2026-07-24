# 01 — PWA shell, precache, and storage persistence

**What to build:** The app becomes installable and loads offline with vite-plugin-pwa; the outbox is reachable even when the network dies. Storage persistence is requested at login and its granted/denied state is shown in settings.

**Blocked by:** nothing

**Status:** ready-for-agent

- [ ] Install vite-plugin-pwa in `apps/web`, configure precache + manifest (app name, icons, start_url, display: 'standalone')
- [ ] Verify app-shell routes load offline (shell cached, outbox + settings reachable without fetch)
- [ ] At login success, call `navigator.storage.persist()` and store the boolean grant result in Dexie
- [ ] Settings screen displays storage persistence state: "Stockage persistant autorisé" or "Non autorisé" (user-facing)
- [ ] Unit test: app shell loads, install event fires, precached assets served offline
