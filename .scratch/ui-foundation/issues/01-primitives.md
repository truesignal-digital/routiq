# 01 — Primitives + toaster mount

Status: ready-for-human
Blocked by: —

Add the shadcn (base-nova / Base UI) primitives the spec lists (§ Design 1) to `apps/web/src/components/ui/`: dialog, alert-dialog, select, textarea, badge, card, table, skeleton, sonner, form, separator. Follow the existing button/input/label vendored style (Tailwind 4, CSS-first — no tailwind.config.js). Pin any new runtime deps EXACT in apps/web/package.json (sonner, resolver if missing). The headless layer is Base UI (@base-ui/react — already installed) via the base-nova style in components.json; use the shadcn CLI so it vendors Base UI-backed components. NEVER add @radix-ui packages. Mount `<Toaster richColors position="top-center" />` once in the AppShell.

Acceptance:
- [x] All primitives compile and are exported; no screen changes yet beyond the Toaster mount
- [x] A smoke test renders Dialog and AlertDialog open states (jsdom) asserting focus trap container and footer buttons exist
- [x] pnpm --filter @routiq/web test && typecheck green

## Comments

2026-07-26 [codex] two rounds. v1: Base UI-backed primitives correct (no radix — the corrected spec held), but shipped next-themes as sonner-template cruft, missed form.tsx, and imported Toaster from sonner directly. v2: next-themes removed entirely, form.tsx added with test, Toaster via the vendored wrapper, sonner@1.6.1 the only new dep (exact). 128 web tests + typecheck green, Fable-verified.
