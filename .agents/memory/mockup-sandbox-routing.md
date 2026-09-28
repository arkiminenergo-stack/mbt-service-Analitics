---
name: Mockup Sandbox Routing
description: How to get Vite sandbox on port 8000 to serve preview components correctly, and tool limitations
---

## Rules

1. `allowedHosts: true` (not `"all"` string) in vite.config.ts for Vite 7
2. Plugin middleware must check `req.url.startsWith("/__mockup/preview/")` — the FULL path with base prefix, NOT `"/preview/"` (Vite does NOT strip base from req.url in middlewares)
3. Route injection: use `window.__MOCKUP_ROUTE__ = "folder/Name"` as an inline sync `<script>` tag before `<div id="root">`, NOT dataset attribute
4. App.tsx reads `window.__MOCKUP_ROUTE__` first, then falls back to pathname
5. Generated registry: import paths `../../src/components/mockups/...` from `src/.generated/` resolve correctly (../../ = sandbox root, then src/components/...)
6. Plugin auto-regenerates registry on file add/unlink — manual edits to `mockup-components.ts` get overwritten on restart

## Screenshot tool limitations
- `external_url` tool CANNOT render ES modules from port 8000 — always shows blank (Firecrawl limitation)
- `app_preview` tool ONLY screenshots main app on port 5000 — useless for sandbox
- Landing page `/__mockup/` CAN be screenshotted (renders with JS) — inconsistency likely due to caching
- For actual verification: user must view Canvas tab in their browser; canvas iframe uses port 8000 URL directly

**Why:** Replit's sandbox runs on port 8000, screenshot tools only properly execute JS from the proxied port 443/5000 environment.
