---
name: GI Acts Module
description: Key decisions and durable patterns for the GI hydraulic testing acts module
---

## Durable decisions

**Filename sanitization + ZIP path check:** `sanitizeFilename()` strips path separators. For ZIP entries, resolve BOTH `uploadDir` and `destPath` via `path.resolve()` before comparing — mixing relative and absolute causes the check to always fail (entries silently dropped).

**Ownership (IDOR):** All GI endpoints use `getOwnedProject(id, userId, res)` / `getOwnedFile(id, userId, res)` helpers that return 404 if the resource doesn't belong to the current user. `storage.getGiProjects(userId)` filters by userId in SQL.

**ZIP filename encoding (adm-zip `efs` is unreliable):** adm-zip's `entry.efs` getter is USELESS for detecting the real UTF-8 flag — its default decoder hardcodes `efs: true`, so it always returns `true` regardless of the actual flag bit. Read `entry.header.flags_efs` instead (checks the real bit). When that's false, try a strict UTF-8 decode of `entry.rawEntryName` first (many modern zip tools, incl. Windows "Send to compressed folder", write UTF-8 bytes without setting the flag). If strict UTF-8 fails, don't assume a single legacy codepage — real-world Russian zips come in BOTH CP1251 and CP866 (DOS-era archivers/locales), and guessing wrong turns one into garbage while fixing the other. Decode with both and score each result with a plausibility heuristic (reject if it contains U+FFFD, control chars, or Serbian/Macedonian Cyrillic letters outside Ё/ё — those only appear when a codepage is mismatched); pick whichever scores higher. See `scoreDecodedName`/`decodeZipEntryName` in `server/routes-gi.ts`.

**Direct (non-ZIP) upload filename mangling:** multer/busboy decodes multipart `Content-Disposition; filename=` header bytes as Latin-1 by default, even though browsers send UTF-8 bytes for the filename — this silently mangles any Cyrillic filename on a plain single-file upload (separate bug from the ZIP entry encoding issue above, needs its own fix). Fix: reinterpret the string's char codes as raw Latin-1 bytes via `Buffer.from(name, 'latin1')`, then strict-decode as UTF-8; if that succeeds, use it, else keep the original name (this direction is safe/idempotent — an already-correct Unicode name essentially never round-trips into valid UTF-8 by accident). See `fixMulterFilename` in `server/routes-gi.ts`.

**Upload rename across filesystems (EXDEV):** multer's temp upload dir (`os.tmpdir()`) can be on a different device/filesystem than the app's own `uploads/` dir in this environment. `fs.renameSync(tmpPath, destPath)` throws `EXDEV: cross-device link not permitted` in that case. Always use `fs.copyFileSync` + `fs.unlinkSync` instead of `fs.renameSync` when moving an uploaded file from multer's temp dir into a project's storage dir.

**needs_review threshold:** Flag a file for review when ANY extracted field with a value has confidence < 0.7 (per-field check), not the average. Using average confidence misses files with a single unreliable critical field.

**TanStack Query v5 — onSuccess removed:** Use `useEffect` watching query data instead of `onSuccess` callback for side effects like toggling polling state.

**PDF preview in review dialog:** Served via `GET /api/gi/files/:id/view` route that streams the file with `Content-Type: application/pdf` + `Content-Disposition: inline`. Rendered client-side with `react-pdf` (`Document`/`Page`, pdf.js), NOT a raw `<iframe src=".../view">`. In Replit's environment the app itself already runs inside a preview iframe, and Chrome blocks its native PDF viewer plugin from loading inside a nested/doubly-sandboxed iframe (shows "Эта страница была заблокирована браузером Chrome"). react-pdf renders to canvas in-page, avoiding the native PDF viewer and the nested-iframe restriction entirely. Pattern already used in `MbtProjectPage.tsx`.

**Why separate routes-gi.ts:** Keeps routes.ts under control at ~2300 lines. Registered at the bottom via `registerGiRoutes(app as any)`.

**XLSX export: unverified = yellow fill.** Per reviewer requirement: rows where not all fields are verified get `fgColor: FFFFF2CC` fill on every cell.
