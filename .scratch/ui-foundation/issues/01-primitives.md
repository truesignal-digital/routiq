# 01 — Primitives + toaster mount

Status: ready-for-agent
Blocked by: —

Add the shadcn/radix primitives the spec lists (§ Design 1) to `apps/web/src/components/ui/`: dialog, alert-dialog, select, textarea, badge, card, table, skeleton, sonner, form, separator. Follow the existing button/input/label vendored style (Tailwind 4, CSS-first — no tailwind.config.js). Pin any new runtime deps EXACT in apps/web/package.json (radix packages, sonner, react-hook-form resolver if missing). Mount `<Toaster richColors position="top-center" />` once in the AppShell.

Acceptance:
- [ ] All primitives compile and are exported; no screen changes yet beyond the Toaster mount
- [ ] A smoke test renders Dialog and AlertDialog open states (jsdom) asserting focus trap container and footer buttons exist
- [ ] pnpm --filter @routiq/web test && typecheck green
