import { Router, Request, Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { storage } from './storage';
import { getOllamaConfig } from './services/llmExtraction';
import { log } from './logger';
import ExcelJS from 'exceljs';
import type { GiActFile, GiProject } from '@shared/schema';
import { GI_FIELD_LABELS, GI_FIELD_KEYS, GI_FILE_STATUS_LABELS } from '@shared/schema';

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 500 * 1024 * 1024 } });
const ALLOWED_EXTS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.tif', '.tiff']);

// ── Security helpers ──────────────────────────────────────────────────────────

/** Strip path traversal and unsafe chars; keep only basename. */
function sanitizeFilename(raw: string): string {
  const base = path.basename(raw);
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 200) || 'file';
}

/**
 * Score how plausible a decoded filename is as real text (Russian filenames
 * with digits/latin/punctuation). Returns -1 if it contains characters that
 * essentially never appear in real filenames (the Unicode replacement char,
 * control chars, or Serbian/Macedonian Cyrillic letters that show up when a
 * codepage is mismatched), otherwise the count of "normal" characters.
 */
function scoreDecodedName(s: string): number {
  if (s.includes('\uFFFD')) return -1;
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x08\x0e-\x1f]/.test(s)) return -1;
  // Extended Cyrillic (Serbian/Macedonian) letters — excluding Ё/ё which are
  // normal Russian — are a strong signal of a codepage mismatch.
  if (/[\u0400\u0402-\u040f\u0450\u0452-\u045f]/.test(s)) return -1;
  const normal = s.match(/[а-яА-ЯёЁ0-9a-zA-Z\s.,()_\-№]/g);
  return normal ? normal.length : 0;
}

/**
 * Decode a ZIP entry filename that may be UTF-8 (modern tools, including
 * Windows "Send to compressed folder" which often writes UTF-8 bytes WITHOUT
 * setting the language-encoding/EFS flag) or a legacy Cyrillic codepage
 * (CP1251 or CP866 — both are produced by older DOS/Windows zip tools,
 * depending on which archiver/locale created the file).
 *
 * Strategy: if the EFS flag is set, adm-zip already decoded it correctly as
 * UTF-8. Otherwise, try a strict UTF-8 decode first (fails loudly on invalid
 * byte sequences). If that fails, decode with both CP1251 and CP866 and pick
 * whichever produces the more plausible result — guessing a single legacy
 * codepage caused real filenames in the other codepage to come out as
 * garbage (e.g. CP866 bytes forced through CP1251).
 */
function decodeZipEntryName(entry: any): string {
  // NOTE: `entry.efs` in adm-zip is unreliable — its default decoder hardcodes
  // `efs: true`, so that getter always returns true regardless of the actual
  // flag bit in the zip. Read the real bit via the header instead.
  const efsFlagSet: boolean = !!entry.header?.flags_efs;
  if (efsFlagSet) return entry.entryName;

  const rawBuf: Buffer = entry.rawEntryName;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(rawBuf);
  } catch {
    const candidates = ['cp1251', 'cp866'] as const;
    let best: { name: string; score: number } | null = null;
    for (const enc of candidates) {
      try {
        const decoded = iconv.decode(rawBuf, enc);
        const score = scoreDecodedName(decoded);
        if (score >= 0 && (!best || score > best.score)) best = { name: decoded, score };
      } catch { /* try next candidate */ }
    }
    return best ? best.name : entry.entryName;
  }
}

/**
 * Fix filenames from multer/busboy, which by default decodes multipart
 * header bytes as Latin-1 even though browsers send UTF-8-encoded filename
 * bytes. If reinterpreting the string's char codes as raw Latin-1 bytes
 * yields valid strict UTF-8, use that (this is a no-op/safe fallback when the
 * name was already correct, since real UTF-8 bytes reinterpreted this way
 * essentially never happen to form valid UTF-8 again).
 */
function fixMulterFilename(name: string): string {
  try {
    const buf = Buffer.from(name, 'latin1');
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return name;
  }
}

/** Apply rename template, substituting field values. */
function applyRenameTemplate(template: string, fieldMap: Record<string, string>): string {
  let result = template;
  for (const [key, val] of Object.entries(fieldMap)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val || '');
  }
  return result
    .replace(/\{[^}]+\}/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .trim()
    .replace(/_{2,}/g, '_')
    .replace(/^_|_$/g, '') || 'unnamed';
}

/**
 * Resolve project and verify it belongs to the authenticated user.
 * Returns the project or sends 404 and returns null.
 */
async function getOwnedProject(
  projectId: string, userId: string, res: Response
): Promise<GiProject | null> {
  const project = await storage.getGiProject(projectId);
  if (!project || project.userId !== userId) {
    res.status(404).json({ message: 'Not found' });
    return null;
  }
  return project;
}

/**
 * Resolve file and verify it belongs to the authenticated user via project ownership.
 * Returns the file or sends 404 and returns null.
 */
async function getOwnedFile(
  fileId: string, userId: string, res: Response
): Promise<GiActFile | null> {
  const file = await storage.getGiActFile(fileId);
  if (!file) { res.status(404).json({ message: 'Not found' }); return null; }
  const project = await storage.getGiProject(file.projectId);
  if (!project || project.userId !== userId) {
    res.status(404).json({ message: 'Not found' });
    return null;
  }
  return file;
}

// ── Routes ────────────────────────────────────────────────────────────────────

export function registerGiRoutes(app: Router) {

  // Projects list — scoped to current user
  app.get('/api/gi/projects', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      res.json(await storage.getGiProjects(user.id));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.get('/api/gi/projects/:id', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const project = await getOwnedProject(req.params.id, user.id, res);
      if (!project) return;
      res.json(project);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.post('/api/gi/projects', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      res.status(201).json(await storage.createGiProject({ ...req.body, userId: user.id }));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.patch('/api/gi/projects/:id', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const project = await getOwnedProject(req.params.id, user.id, res);
      if (!project) return;
      const updated = await storage.updateGiProject(req.params.id, req.body);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  app.delete('/api/gi/projects/:id', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const project = await getOwnedProject(req.params.id, user.id, res);
      if (!project) return;
      await storage.deleteGiProject(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Files list
  app.get('/api/gi/projects/:projectId/files', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const project = await getOwnedProject(req.params.projectId, user.id, res);
      if (!project) return;
      res.json(await storage.getGiActFiles(req.params.projectId));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Serve PDF for in-browser preview
  app.get('/api/gi/files/:fileId/view', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const f = await getOwnedFile(req.params.fileId, user.id, res);
      if (!f) return;
      const filePath = f.pdfPath || f.filePath;
      if (!fs.existsSync(filePath)) return res.status(404).json({ message: 'File missing on disk' });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline');
      fs.createReadStream(filePath).pipe(res);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Upload (ZIP or PDF/image)
  app.post('/api/gi/projects/:projectId/upload',
    upload.single('file'),
    async (req: Request, res: Response) => {
      if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
      const user = req.user as any;
      const projectId = req.params.projectId;

      if (!req.file) return res.status(400).json({ message: 'No file' });

      const project = await getOwnedProject(projectId, user.id, res);
      if (!project) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return;
      }

      const uploadDir = path.resolve('uploads', 'gi', projectId);
      fs.mkdirSync(uploadDir, { recursive: true });

      const ext = path.extname(req.file.originalname).toLowerCase();
      const created: GiActFile[] = [];

      try {
        if (ext === '.zip') {
          const zip = new AdmZip(req.file.path);
          const entries = zip.getEntries();

          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const decodedName = decodeZipEntryName(entry);
            const fname = sanitizeFilename(decodedName);
            const fext = path.extname(fname).toLowerCase();
            if (!ALLOWED_EXTS.has(fext)) continue;

            // Resolve both paths to prevent traversal
            const resolvedUploadDir = uploadDir + path.sep;
            const resolvedDest = path.resolve(uploadDir, fname);
            if (!resolvedDest.startsWith(resolvedUploadDir)) {
              log.warn('[GI] ZIP entry blocked (path traversal attempt)', { fname });
              continue;
            }

            fs.writeFileSync(resolvedDest, entry.getData());

            const fileRecord = await storage.createGiActFile({
              projectId, userId: user.id, originalFilename: fname,
              filePath: resolvedDest, status: 'pending',
            });
            created.push(fileRecord);
          }
        } else if (ALLOWED_EXTS.has(ext)) {
          const fname = sanitizeFilename(fixMulterFilename(req.file.originalname));
          const destPath = path.resolve(uploadDir, fname);
          // Use copy+unlink instead of rename: multer's temp dir may be on a
          // different filesystem/device than uploadDir, and fs.renameSync
          // throws EXDEV ("cross-device link not permitted") in that case.
          fs.copyFileSync(req.file.path, destPath);
          fs.unlinkSync(req.file.path);
          const fileRecord = await storage.createGiActFile({
            projectId, userId: user.id, originalFilename: fname,
            filePath: destPath, status: 'pending',
          });
          created.push(fileRecord);
        } else {
          fs.unlinkSync(req.file.path);
          return res.status(400).json({ message: 'Unsupported file type. Use ZIP, PDF or image.' });
        }

        if (fs.existsSync(req.file.path)) try { fs.unlinkSync(req.file.path); } catch {}
        res.status(201).json({ created: created.length, files: created });
      } catch (e: any) {
        try { if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
        res.status(500).json({ message: e.message });
      }
    }
  );

  // Process single file
  app.post('/api/gi/files/:fileId/process', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const f = await getOwnedFile(req.params.fileId, user.id, res);
      if (!f) return;

      await storage.updateGiActFile(f.id, { status: 'processing', errorMessage: null as any });
      res.json({ ok: true, status: 'processing' });

      processGiFile(f.id).catch(err =>
        log.error('[GI] processGiFile unhandled error', { fileId: f.id, err: err?.message })
      );
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Process all pending/error/needs_review files in project
  app.post('/api/gi/projects/:projectId/process-all', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const project = await getOwnedProject(req.params.projectId, user.id, res);
      if (!project) return;

      const files = await storage.getGiActFiles(req.params.projectId);
      const pending = files.filter(f => ['pending', 'error', 'needs_review'].includes(f.status));
      if (pending.length === 0) return res.json({ queued: 0 });

      res.json({ queued: pending.length });

      (async () => {
        for (const f of pending) {
          try {
            await storage.updateGiActFile(f.id, { status: 'processing', errorMessage: null as any });
            await processGiFile(f.id);
          } catch (err: any) {
            log.error('[GI] batch processGiFile error', { fileId: f.id, err: err?.message });
          }
        }
      })();
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Rename single file by template
  app.post('/api/gi/files/:fileId/rename', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const f = await getOwnedFile(req.params.fileId, user.id, res);
      if (!f) return;

      const project = await storage.getGiProject(f.projectId);
      const template = req.body?.template || project?.renameTemplate || '{act_date}_{heat_source}';

      const fields = await storage.getGiActFields(f.id);
      const fieldMap: Record<string, string> = {};
      for (const fld of fields) { if (fld.fieldValue) fieldMap[fld.fieldKey] = fld.fieldValue; }

      const ext = path.extname(f.originalFilename);
      const renamed = applyRenameTemplate(template, fieldMap) + ext;

      const updated = await storage.updateGiActFile(f.id, { renamedFilename: renamed });
      res.json({ renamedFilename: renamed, file: updated });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Rename all done/needs_review files in project
  app.post('/api/gi/projects/:projectId/rename-all', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const project = await getOwnedProject(req.params.projectId, user.id, res);
      if (!project) return;

      const template = req.body?.template || project.renameTemplate || '{act_date}_{heat_source}';
      const files = await storage.getGiActFiles(req.params.projectId);
      const targets = files.filter(f => ['done', 'needs_review'].includes(f.status));

      let renamed = 0;
      for (const f of targets) {
        const fields = await storage.getGiActFields(f.id);
        const fieldMap: Record<string, string> = {};
        for (const fld of fields) { if (fld.fieldValue) fieldMap[fld.fieldKey] = fld.fieldValue; }
        const ext = path.extname(f.originalFilename);
        const newName = applyRenameTemplate(template, fieldMap) + ext;
        await storage.updateGiActFile(f.id, { renamedFilename: newName });
        renamed++;
      }
      res.json({ renamed });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Get fields for a file
  app.get('/api/gi/files/:fileId/fields', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const f = await getOwnedFile(req.params.fileId, user.id, res);
      if (!f) return;
      res.json(await storage.getGiActFields(f.id));
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Update a single field
  app.patch('/api/gi/fields/:fieldId', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    const user = req.user as any;
    try {
      // Verify field ownership via file → project chain
      const existingField = await storage.getGiActField(req.params.fieldId);
      if (!existingField) return res.status(404).json({ message: 'Not found' });
      const f = await getOwnedFile(existingField.fileId, user.id, res);
      if (!f) return;

      const field = await storage.updateGiActField(req.params.fieldId, {
        fieldValue: req.body.fieldValue,
        isVerified: req.body.isVerified,
        verifiedBy: req.body.isVerified ? user.id : undefined,
      });
      if (!field) return res.status(404).json({ message: 'Not found' });
      res.json(field);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Verify all fields for a file
  app.post('/api/gi/files/:fileId/verify', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    const user = req.user as any;
    try {
      const f = await getOwnedFile(req.params.fileId, user.id, res);
      if (!f) return;

      const fields = await storage.getGiActFields(f.id);
      for (const fld of fields) {
        await storage.updateGiActField(fld.id, { isVerified: true, verifiedBy: user.id });
      }
      await storage.updateGiActFile(f.id, { status: 'done' });
      res.json({ ok: true, verified: fields.length });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // Delete file
  app.delete('/api/gi/files/:fileId', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const f = await getOwnedFile(req.params.fileId, user.id, res);
      if (!f) return;
      if (f.filePath) try { fs.unlinkSync(f.filePath); } catch {}
      if (f.pdfPath) try { fs.unlinkSync(f.pdfPath); } catch {}
      await storage.deleteGiActFile(f.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });

  // XLSX Export
  app.get('/api/gi/projects/:projectId/export', async (req: Request, res: Response) => {
    if (!req.isAuthenticated()) return res.status(401).json({ message: 'Unauthorized' });
    try {
      const user = req.user as any;
      const project = await getOwnedProject(req.params.projectId, user.id, res);
      if (!project) return;

      const files = await storage.getGiActFiles(req.params.projectId);
      const wb = new ExcelJS.Workbook();
      wb.creator = 'КПД ГИ';
      const ws = wb.addWorksheet('Акты ГИ');

      const headers = [
        'Файл (переименованный)', 'Оригинальное имя', 'Статус', 'Достоверность',
        'Дата обработки', 'Проверено',
        ...GI_FIELD_KEYS.map(k => GI_FIELD_LABELS[k as keyof typeof GI_FIELD_LABELS]),
      ];
      const headerRow = ws.addRow(headers);
      headerRow.font = { bold: true };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9EAD3' } };
      headerRow.alignment = { wrapText: true };

      for (const f of files) {
        const fields = await storage.getGiActFields(f.id);
        const fieldMap: Record<string, string> = {};
        for (const fld of fields) { fieldMap[fld.fieldKey] = fld.fieldValue || ''; }
        const allVerified = fields.length > 0 && fields.every(fld => fld.isVerified);

        const staticCols = [
          f.renamedFilename || f.originalFilename,
          f.originalFilename,
          GI_FILE_STATUS_LABELS[f.status as keyof typeof GI_FILE_STATUS_LABELS] || f.status,
          f.confidenceAvg ? `${Math.round(parseFloat(f.confidenceAvg) * 100)}%` : '—',
          f.processedAt ? new Date(f.processedAt).toLocaleString('ru-RU') : '—',
          allVerified ? 'Да' : 'Нет',
        ];
        const fieldCols = GI_FIELD_KEYS.map(k => fieldMap[k] || '');
        const dataRow = ws.addRow([...staticCols, ...fieldCols]);

        if (!allVerified) {
          dataRow.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
          });
        }
      }

      ws.columns.forEach((col, idx) => { col.width = idx < 6 ? 22 : 20; });

      const buf = await wb.xlsx.writeBuffer();
      const filename = encodeURIComponent(`gi_acts_${project.name}_${Date.now()}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      res.send(buf);
    } catch (e: any) { res.status(500).json({ message: e.message }); }
  });
}

// ── Core extraction logic ─────────────────────────────────────────────────────

async function processGiFile(fileId: string): Promise<void> {
  const fileRecord = await storage.getGiActFile(fileId);
  if (!fileRecord) throw new Error(`File ${fileId} not found`);

  const filePath = fileRecord.filePath;
  if (!fs.existsSync(filePath)) {
    await storage.updateGiActFile(fileId, {
      status: 'error',
      errorMessage: `File not found on disk: ${filePath}`,
    });
    return;
  }

  try {
    const config = await getOllamaConfig();
    const configJson = JSON.stringify({
      openaiApiKey: config.openaiApiKey || '',
      stepfunApiKey: process.env.StepFun || '',
      stepfunApiUrl: config.apiUrl || '',
      stepfunModel: 'step-3.7-flash',
    });

    const result = await new Promise<any>((resolve, reject) => {
      const py = spawn('python3', ['python_server/extract_gi_act.py', filePath], {
        env: { ...process.env },
      });

      py.stdin.write(configJson);
      py.stdin.end();

      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        try { py.kill('SIGKILL'); } catch {}
        reject(new Error('Python extraction timed out (5 min)'));
      }, 5 * 60 * 1000);

      py.stdout.on('data', (d: Buffer) => { stdout += d; });
      py.stderr.on('data', (d: Buffer) => { stderr += d; });
      py.on('close', (code: number) => {
        clearTimeout(timer);
        if (code !== 0) {
          log.error('[GI] Python exited', { code, stderr: stderr.slice(0, 500) });
          reject(new Error(stderr.slice(0, 300) || `Exit code ${code}`));
        } else {
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error(`Invalid JSON from extractor: ${stdout.slice(0, 200)}`)); }
        }
      });
      py.on('error', reject);
    });

    if (result.error) {
      await storage.updateGiActFile(fileId, { status: 'error', errorMessage: result.error });
      return;
    }

    const fields: Array<{
      fieldKey: string; fieldValue?: string | null;
      confidence?: string | null; rawOcrText?: string | null;
    }> = (result.fields || []).map((f: any) => ({
      fieldKey: f.key,
      fieldValue: f.value || null,
      confidence: f.confidence || null,
      rawOcrText: f.rawOcr || null,
    }));

    await storage.upsertGiActFields(fileId, fields);

    const avgConf: number = result.avgConfidence ?? 0;
    // Flag for review if ANY field with a value has confidence < 0.7
    const needsReview = (result.fields || []).some(
      (f: any) => f.value && parseFloat(f.confidence ?? '1') < 0.7
    );

    await storage.updateGiActFile(fileId, {
      status: needsReview ? 'needs_review' : 'done',
      pageCount: result.pageCount || 1,
      confidenceAvg: String(avgConf),
      processedAt: new Date(),
      errorMessage: null as any,
    });

    log.info('[GI] File processed', { fileId, avgConf, fields: fields.length, needsReview });
  } catch (err: any) {
    const msg = err?.message || String(err);
    log.error('[GI] processGiFile error', { fileId, msg });
    await storage.updateGiActFile(fileId, {
      status: 'error',
      errorMessage: msg.slice(0, 500),
    });
  }
}
