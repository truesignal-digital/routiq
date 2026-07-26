# @routiq/web

Vite + React 19 PWA for ROUTIQ asset lifecycle platform.

## UI Registry

The `@routiq` namespace provides a shadcn-style registry of shared UI components, distributed as JSON descriptors that can be installed into other applications.

### Installation

```bash
pnpm dlx shadcn@latest add http://localhost:5173/r/<item>.json
```

Replace `<item>` with the component name (e.g., `button`, `card`, `data-table`).

### Adding new components

Every new file under `src/components/` must be registered in `registry.json` in the same change. This ensures the registry stays in sync with the source and the `registry:build` test validates all paths exist.

### Building the registry

The registry is built as part of deployment:

```bash
pnpm --filter @routiq/web registry:build
```

This generates JSON descriptors under `apps/web/public/r/` for each registered component. Run this before `vite build` when deploying the appliance.
