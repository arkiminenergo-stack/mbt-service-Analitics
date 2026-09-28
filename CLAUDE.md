# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

КПД / MBT Service — a document-verification web app (Russian-language UI and domain: межбюджетные трансферты, акты ГИ, банковские выписки, платёжные поручения). Users upload ZIP/PDF/DOCX/XLSX packages into projects; the server converts them to PDF, OCRs/extracts text, runs regex + LLM analysis (seals, signatures, dates, payments), and reviewers approve findings and export XLSX reports. Originally built on Replit (`.replit`, `replit.md`, `.agents/memory/`).

## Commands

```bash
npm install
npm run db:push      # apply shared/schema.ts to Postgres via drizzle-kit (no migration files; schema is pushed)
npm run dev          # Express + Vite middleware on port 5000 (PORT env overrides)
npm run build        # vite build (client) + esbuild bundle of server/index.ts -> dist/
npm start            # production, serves built client statically
npx tsc              # typecheck only (tsconfig has noEmit); covers client, server, shared
```

There is no test suite and no linter configured.

`npm run dev`/`start` use POSIX `NODE_ENV=... ` prefixes — on Windows run them from Git Bash, or set `NODE_ENV` separately.

Required env: `DATABASE_URL`, `SESSION_SECRET`. Optional: `ADMIN_EMAIL`/`ADMIN_PASSWORD` (default admin `admin@mbt.local`/`admin123`, created by `server/bootstrap.ts`), `OLLAMA_API_URL`/`OLLAMA_API_KEY`/`OLLAMA_MODEL`, `OPENAI_API_KEY`/`OPENAI_MODEL`. OpenAI is preferred when its key is set, otherwise Ollama (`server/services/llmExtraction.ts`); runtime config can also be changed via `POST /api/ollama/config`.

System deps needed at runtime: `python3` on PATH (with `python_server/requirements.txt`), `libreoffice` (office→PDF conversion), poppler-utils, Tesseract (OCR).

## Architecture

Monorepo, single process:

- `client/` — React 18 + Vite, Wouter routing (`/mbt`, `/mbt/:projectId`, `/gi`, `/gi/:projectId`, `/login`), TanStack Query v5 (`client/src/lib/queryClient.ts`), shadcn/Radix UI in `components/ui/`. Path alias `@/*` → `client/src/*`.
- `shared/schema.ts` — single source of truth: Drizzle tables + drizzle-zod insert schemas + domain label/const maps. Imported as `@shared/schema` from both sides.
- `server/` — Express. `index.ts` wires session auth (`auth.ts`, Passport local + connect-pg-simple), runs `bootstrap()` (seeds roles/admin, resets jobs stuck in `processing` after restart), registers routes, then Vite dev middleware (`vite.ts`) or static serving.
  - `routes.ts` (~2300 lines) — all MBT/checklist/assistant/parsing-template endpoints. `routes-gi.ts` — the GI (hydraulic-testing acts) module, registered from `routes.ts` via `registerGiRoutes`. New large feature areas should get their own `routes-*.ts` file.
  - `storage.ts` — `DatabaseStorage` class; all DB access goes through it.
  - `services/` — `mbtDocumentAnalysis.ts` (ingestion, LibreOffice conversion, analysis pipeline), `llmExtraction.ts` (LLM provider selection, calls `document_parser.py`), `checklistService.ts` (project check → conclusions), `projectAssistant.ts` (LLM agent returning JSON actions like create_section/create_folder/run_check that the server executes), `patternExtraction.ts` (regex extraction).
- `python_server/` — standalone CLI scripts, **not a server**. Node spawns them with `spawn('python3', ['python_server/<script>.py', filePath])`; they print JSON to stdout (some, e.g. `apply_template.py`, read a JSON config from stdin). Paths are relative to repo root, so the server must run with cwd = repo root.
- Uploaded files live under `uploads/` (e.g. `uploads/mbt/<projectId>/`), gitignored.
- `artifacts/mockup-sandbox/` — separate Vite app (own `package.json`) for previewing UI mockups on port 8000 in Replit; not part of the main build.

Design principle from `SYSTEM_DESCRIPTION.md`: extraction is deterministic (regex/pdfplumber/OCR/bbox) wherever possible; the LLM is used as orchestrator/fallback and results are cached.

## Gotchas (from `.agents/memory/` — read those files for details)

- exceljs: always `wb.xlsx.writeBuffer()` + `res.send(buffer)`, never `wb.xlsx.write(res)`.
- Register specific routes (e.g. `/export`) before generic `/:id` routes.
- `storage.logActivity(...)` is fire-and-forget: `.catch(() => {})`, don't await in the response path.
- TanStack Query v5 has no `onSuccess` on queries — use `useEffect` on query data.
- PDFs are rendered with `react-pdf` (canvas), not `<iframe>` — nested iframes block Chrome's PDF viewer.
- Filename encoding: multer mangles Cyrillic filenames (Latin-1) — see `fixMulterFilename`; ZIP entry names may be UTF-8, CP1251 or CP866 — see `decodeZipEntryName` in `server/routes-gi.ts`. Don't trust adm-zip's `entry.efs`.
- Moving uploads out of multer's temp dir: use `copyFileSync` + `unlinkSync`, not `renameSync` (EXDEV).
- GI endpoints enforce ownership via `getOwnedProject`/`getOwnedFile` helpers (404 on mismatch) — follow the same pattern.
- `client/src/pages/MbtProjectPage.tsx` and `server/routes.ts` are very large; read targeted sections rather than whole files.
