import type { Express } from "express";
import { createServer, type Server } from "http";
import passport from "passport";
import multer from "multer";
import { storage } from "./storage";
import { requireAuth, requireModuleAccess } from "./auth";
import { insertMbtProjectSchema } from "@shared/schema";
import os from "os";
import path from "path";
import fs from "fs";
import { registerGiRoutes } from "./routes-gi";

export async function registerRoutes(app: Express): Promise<Server> {

  // ============================================================================
  // AUTH ROUTES
  // ============================================================================

  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: any, info: any) => {
      if (err) return next(err);
      if (!user) {
        return res.status(401).json({ message: info?.message || "Неверный email или пароль" });
      }
      req.logIn(user, (err) => {
        if (err) return next(err);
        return res.json({
          id: user.id,
          email: user.email,
          username: user.username,
          roleId: user.roleId,
          isActive: user.isActive,
        });
      });
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res) => {
    req.logout((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    const user = req.user as any;
    const role = await storage.getUserRole(user.id);
    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      roleId: user.roleId,
      role,
      isActive: user.isActive,
    });
  });

  // ============================================================================
  // LLM CONFIG ROUTES
  // ============================================================================

  app.get("/api/ollama/config", requireAuth, async (_req, res) => {
    try {
      const config = await storage.getOllamaConfig();
      res.json(config || {
        apiUrl: process.env.OLLAMA_API_URL || "",
        apiKey: process.env.OLLAMA_API_KEY || "",
        model: process.env.OLLAMA_MODEL || "qwen2.5:7b",
        aiProvider: "ollama",
        openaiApiUrl: "https://api.openai.com/v1",
        openaiModel: "gpt-4o",
        openaiApiKey: process.env.OPENAI_API_KEY || "",
        enableChunking: true,
        maxContextTokens: 28000,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get config" });
    }
  });

  app.post("/api/ollama/config", requireAuth, async (req, res) => {
    try {
      await storage.setOllamaConfig(req.body);
      res.json({ message: "Config saved" });
    } catch (error) {
      res.status(500).json({ message: "Failed to save config" });
    }
  });

  // ============================================================================
  // MBT PROJECTS
  // ============================================================================

  app.post("/api/mbt/projects", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const parsed = insertMbtProjectSchema.parse({ ...req.body, userId: req.user!.id });
      const project = await storage.createMbtProject(parsed);
      res.status(201).json(project);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to create MBT project" });
    }
  });

  app.get("/api/mbt/analytics", requireAuth, requireModuleAccess("mbt"), async (_req, res) => {
    try {
      const analytics = await storage.getMbtAnalytics();
      res.json(analytics);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mbt/projects", requireAuth, requireModuleAccess("mbt"), async (_req, res) => {
    try {
      const projects = await storage.getMbtProjects();
      res.json(projects);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch MBT projects" });
    }
  });

  app.get("/api/mbt/projects/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const project = await storage.getMbtProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      res.json(project);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch MBT project" });
    }
  });

  app.patch("/api/mbt/projects/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const project = await storage.getMbtProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const updated = await storage.updateMbtProject(req.params.id, req.body);
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to update MBT project" });
    }
  });

  app.delete("/api/mbt/projects/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const project = await storage.getMbtProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      await storage.deleteMbtProject(req.params.id);
      res.json({ message: "Project deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete MBT project" });
    }
  });

  // ============================================================================
  // MBT DOCUMENT ENDPOINTS
  // ============================================================================

  const mbtUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 },
  });

  const mbtChunkedSessions = new Map<string, {
    filename: string; fileSize: number; totalChunks: number;
    receivedChunks: Set<number>; tempPath: string; projectId: string; userId: string;
  }>();

  function sanitizeMbtFilename(name: string): string {
    const base = name.replace(/[/\\:*?"<>|]/g, '_').replace(/\.\./g, '_');
    return base.slice(0, 200) || 'document.zip';
  }

  app.post("/api/mbt/projects/:projectId/documents/upload/init", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { projectId } = req.params;
      const { filename, fileSize, totalChunks } = req.body;
      const project = await storage.getMbtProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const safeName = sanitizeMbtFilename(filename);
      const numSize = Number(fileSize);
      const numChunks = Number(totalChunks);
      if (!numSize || numSize <= 0 || numSize > 500 * 1024 * 1024)
        return res.status(400).json({ message: "Invalid file size" });
      if (!numChunks || numChunks <= 0 || numChunks > 200)
        return res.status(400).json({ message: "Invalid chunk count" });

      const uploadId = `mbt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const fs = await import('fs');
      const path = await import('path');
      const dir = path.join(process.cwd(), 'uploads', 'mbt', projectId);
      fs.mkdirSync(dir, { recursive: true });
      const tempPath = path.join('/tmp', `mbt_chunk_${uploadId}`);
      fs.writeFileSync(tempPath, Buffer.alloc(0));

      mbtChunkedSessions.set(uploadId, {
        filename: safeName, fileSize: numSize, totalChunks: numChunks,
        receivedChunks: new Set(),
        tempPath, projectId, userId: req.user!.id,
      });

      res.json({ uploadId });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mbt/projects/:projectId/documents/upload/chunk", requireAuth, requireModuleAccess("mbt"), mbtUpload.single('chunk'), async (req, res) => {
    try {
      const { uploadId, chunkIndex } = req.body;
      const session = mbtChunkedSessions.get(uploadId);
      if (!session) return res.status(400).json({ message: "Invalid upload session" });
      if (session.userId !== req.user!.id || session.projectId !== req.params.projectId)
        return res.status(403).json({ message: "Session mismatch" });
      if (!req.file) return res.status(400).json({ message: "No chunk data" });

      const fs = await import('fs');
      const CHUNK_SIZE = 5 * 1024 * 1024;
      const idx = parseInt(chunkIndex);
      if (isNaN(idx) || idx < 0 || idx >= session.totalChunks)
        return res.status(400).json({ message: "Invalid chunk index" });

      const fd = fs.openSync(session.tempPath, 'r+');
      fs.writeSync(fd, req.file.buffer, 0, req.file.buffer.length, idx * CHUNK_SIZE);
      fs.closeSync(fd);

      session.receivedChunks.add(idx);
      res.json({ received: session.receivedChunks.size, total: session.totalChunks });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mbt/projects/:projectId/documents/upload/finalize", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { uploadId } = req.body;
      const session = mbtChunkedSessions.get(uploadId);
      if (!session) return res.status(400).json({ message: "Invalid upload session" });
      if (session.userId !== req.user!.id || session.projectId !== req.params.projectId)
        return res.status(403).json({ message: "Session mismatch" });
      if (session.receivedChunks.size !== session.totalChunks)
        return res.status(400).json({ message: `Missing chunks: ${session.receivedChunks.size}/${session.totalChunks}` });

      const fs = await import('fs');
      const path = await import('path');

      const stat = fs.statSync(session.tempPath);
      if (stat.size > session.fileSize) {
        fs.truncateSync(session.tempPath, session.fileSize);
      }

      const dir = path.join(process.cwd(), 'uploads', 'mbt', session.projectId);
      fs.mkdirSync(dir, { recursive: true });
      const destFilename = `${Date.now()}_${sanitizeMbtFilename(session.filename)}`;
      const destPath = path.join(dir, destFilename);
      fs.copyFileSync(session.tempPath, destPath);
      fs.unlinkSync(session.tempPath);

      const doc = await storage.createMbtDocument({
        projectId: session.projectId,
        userId: session.userId,
        filename: destFilename,
        originalName: session.filename,
        filePath: destPath,
        fileSize: String(session.fileSize),
        status: 'extracting',
      });

      mbtChunkedSessions.delete(uploadId);

      const { extractZipAndCreateFiles } = await import('./services/mbtDocumentAnalysis');
      extractZipAndCreateFiles(doc.id, destPath, dir).catch(err => {
        console.error("MBT ZIP extraction error:", err);
      });

      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mbt/projects/:projectId/documents/upload", requireAuth, requireModuleAccess("mbt"), mbtUpload.single('file'), async (req, res) => {
    try {
      const { projectId } = req.params;
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const project = await storage.getMbtProject(projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const fs = await import('fs');
      const path = await import('path');
      const dir = path.join(process.cwd(), 'uploads', 'mbt', projectId);
      fs.mkdirSync(dir, { recursive: true });

      const safeOrigName = sanitizeMbtFilename(req.file.originalname);
      const destFilename = `${Date.now()}_${safeOrigName}`;
      const destPath = path.join(dir, destFilename);
      fs.writeFileSync(destPath, req.file.buffer);

      const doc = await storage.createMbtDocument({
        projectId,
        userId: req.user!.id,
        filename: destFilename,
        originalName: safeOrigName,
        filePath: destPath,
        fileSize: String(req.file.size),
        status: 'extracting',
      });

      storage.logActivity({
        projectId,
        userId: req.user!.id,
        action: 'document_uploaded',
        entityType: 'document',
        entityId: doc.id,
        entityLabel: safeOrigName,
        meta: { fileSize: req.file.size },
      }).catch(() => {});

      const { extractZipAndCreateFiles } = await import('./services/mbtDocumentAnalysis');
      extractZipAndCreateFiles(doc.id, destPath, dir).catch(err => {
        console.error("MBT ZIP extraction error:", err);
      });

      res.json(doc);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mbt/projects/:projectId/documents", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const docs = await storage.getMbtDocuments(req.params.projectId);
      res.json(docs);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch documents" });
    }
  });

  app.delete("/api/mbt/documents/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const doc = await storage.getMbtDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const fs = await import('fs');
      const files = await storage.getMbtDocumentFiles(doc.id);
      for (const f of files) {
        try { if (f.filePath) fs.unlinkSync(f.filePath); } catch {}
        try { if (f.pdfPath) fs.unlinkSync(f.pdfPath); } catch {}
      }
      try { fs.unlinkSync(doc.filePath); } catch {}
      await storage.deleteMbtDocument(req.params.id);
      res.json({ message: "Document deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete document" });
    }
  });

  app.get("/api/mbt/documents/:documentId/files", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const files = await storage.getMbtDocumentFiles(req.params.documentId);
      res.json(files);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch files" });
    }
  });

  app.get("/api/mbt/files/:fileId/serve", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });
      const fs = await import('fs');
      const servePath = file.pdfPath || file.filePath;
      if (!fs.existsSync(servePath)) {
        return res.status(404).json({ message: "File not found on disk" });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
      const stream = fs.createReadStream(servePath);
      stream.pipe(res);
    } catch (error) {
      res.status(500).json({ message: "Failed to serve file" });
    }
  });

  // ── PDF Split ────────────────────────────────────────────────────────────────
  // POST /api/mbt/files/:fileId/split
  // Body: { ranges: [{start, end, name}] }
  // Returns: { files: MbtDocumentFile[] }
  app.post("/api/mbt/files/:fileId/split", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      const ranges: Array<{ start: number; end: number; name: string }> = req.body.ranges;
      if (!Array.isArray(ranges) || ranges.length === 0) {
        return res.status(400).json({ message: "ranges array required" });
      }

      const pdfSrc = file.pdfPath || file.filePath;
      if (!fs.existsSync(pdfSrc)) {
        return res.status(404).json({ message: "PDF file not found on disk" });
      }

      // Output directory = same folder as source file
      const outputDir = path.dirname(pdfSrc);

      const { spawn } = await import('child_process');

      const result = await new Promise<any>((resolve, reject) => {
        const proc = spawn('python3', [
          'python_server/split_pdf.py',
          pdfSrc,
          outputDir,
          JSON.stringify(ranges),
        ]);
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => {
          try { resolve(JSON.parse(out.trim())); }
          catch { reject(new Error('Split script parse error: ' + out.slice(0, 200))); }
        });
        proc.on('error', reject);
        setTimeout(() => { proc.kill('SIGKILL'); reject(new Error('Split timed out')); }, 120_000);
      });

      if (!result.ok) {
        return res.status(500).json({ message: result.error || 'Split failed' });
      }

      // Create new file records in the same document
      const created: any[] = [];
      for (const f of result.files as any[]) {
        const record = await storage.createMbtDocumentFile({
          documentId:      file.documentId,
          sectionId:       file.sectionId ?? null,
          folderId:        file.folderId ?? null,
          filename:        f.name,
          fileType:        'pdf',
          filePath:        f.path,
          pdfPath:         f.path,
          fileSize:        String(f.size),
          extractionStatus: 'completed',
          analysisStatus:  'none',
          pageCount:       f.pages,
        });
        created.push(record);
      }

      storage.logActivity({
        projectId:   req.body.projectId || '',
        userId:      req.user!.id,
        action:      'document_uploaded',
        entityType:  'file',
        entityId:    file.id,
        entityLabel: file.filename,
        meta:        { splitInto: created.length },
      }).catch(() => {});

      res.json({ files: created, total: result.total });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Split failed' });
    }
  });

  // GET /api/mbt/files/:fileId/page-count — quick page count for split dialog
  app.get("/api/mbt/files/:fileId/page-count", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      if (file.pageCount && file.pageCount > 0) {
        return res.json({ pageCount: file.pageCount });
      }

      const pdfSrc = file.pdfPath || file.filePath;
      if (!fs.existsSync(pdfSrc)) return res.json({ pageCount: 0 });

      const { spawn } = await import('child_process');
      const count = await new Promise<number>((resolve) => {
        const proc = spawn('python3', ['-c',
          `from pypdf import PdfReader, errors; ` +
          `import sys, json; ` +
          `r = PdfReader(sys.argv[1]); print(len(r.pages))`,
          pdfSrc,
        ]);
        let out = '';
        proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
        proc.on('close', () => { resolve(parseInt(out.trim(), 10) || 0); });
        proc.on('error', () => { resolve(0); });
        setTimeout(() => { proc.kill(); resolve(0); }, 30_000);
      });

      // Cache in DB
      if (count > 0) {
        storage.updateMbtDocumentFile(file.id, { pageCount: count }).catch(() => {});
      }
      res.json({ pageCount: count });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || 'Failed' });
    }
  });

  app.post("/api/mbt/files/:fileId/analyze", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      let templateConfig: { systemPrompt?: string; parameters?: any[]; templateId?: string } = {};
      if (req.body.templateId) {
        const tmpl = await storage.getAnalysisTemplate(req.body.templateId);
        if (tmpl) {
          templateConfig = { systemPrompt: tmpl.systemPrompt, parameters: tmpl.parameters, templateId: tmpl.id };
        }
      } else if (req.body.customParameters) {
        templateConfig = { parameters: req.body.customParameters, systemPrompt: req.body.systemPrompt };
      }

      const options = {
        findDates: req.body.findDates !== false,
        findSignatures: req.body.findSignatures !== false,
        findSeals: req.body.findSeals !== false,
        useOcr: !!req.body.useOcr,
        ...templateConfig,
      };
      const { analyzeMbtDocument } = await import('./services/mbtDocumentAnalysis');
      analyzeMbtDocument(req.params.fileId, req.user!.id, options).catch(err => {
        console.error("MBT analysis error:", err);
      });
      res.json({ message: "Analysis started" });
    } catch (error) {
      res.status(500).json({ message: "Failed to start analysis" });
    }
  });

  app.get("/api/mbt/files/:fileId/analysis", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const analysis = await storage.getLatestMbtAnalysis(req.params.fileId);
      res.json(analysis || null);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch analysis" });
    }
  });

  app.post("/api/mbt/batch-analyze", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { fileIds, skipAnalyzed = false, ...settingsRaw } = req.body;
      if (!Array.isArray(fileIds) || fileIds.length === 0)
        return res.status(400).json({ message: "fileIds is required and must be a non-empty array" });

      let templateConfig: { systemPrompt?: string; parameters?: any[]; templateId?: string } = {};
      if (settingsRaw.templateId) {
        const tmpl = await storage.getAnalysisTemplate(settingsRaw.templateId);
        if (tmpl) {
          templateConfig = { systemPrompt: tmpl.systemPrompt, parameters: tmpl.parameters, templateId: tmpl.id };
        }
      } else if (settingsRaw.customParameters) {
        templateConfig = { parameters: settingsRaw.customParameters, systemPrompt: settingsRaw.systemPrompt };
      }

      const options = {
        findDates: settingsRaw.findDates !== false,
        findSignatures: settingsRaw.findSignatures !== false,
        findSeals: settingsRaw.findSeals !== false,
        useOcr: !!settingsRaw.useOcr,
        ...templateConfig,
      };
      const { analyzeMbtDocument } = await import('./services/mbtDocumentAnalysis');
      let queued = 0;
      for (const fileId of fileIds) {
        const file = await storage.getMbtDocumentFile(fileId);
        if (!file) continue;
        if (skipAnalyzed && file.analysisStatus === 'completed') continue;
        analyzeMbtDocument(fileId, req.user!.id, options).catch(err => {
          console.error(`MBT batch analysis error for ${fileId}:`, err);
        });
        queued++;
      }
      res.json({ message: "Batch analysis started", queued });
    } catch (error) {
      res.status(500).json({ message: "Failed to start batch analysis" });
    }
  });

  // ── MBT Analysis Templates ───────────────────────────────────────────────────
  app.get("/api/mbt/analysis-templates", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const projectId = req.query.projectId as string | undefined;
      const templates = await storage.getAnalysisTemplates(projectId);
      res.json(templates);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch analysis templates" });
    }
  });

  app.post("/api/mbt/analysis-templates", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { name, systemPrompt, parameters, projectId, isDefault } = req.body;
      if (!name || !systemPrompt) return res.status(400).json({ message: "name and systemPrompt are required" });
      const template = await storage.createAnalysisTemplate({
        name,
        systemPrompt,
        parameters: parameters || [],
        projectId: projectId || null,
        isDefault: !!isDefault,
        createdBy: req.user!.id,
      });
      res.status(201).json(template);
    } catch (error) {
      res.status(500).json({ message: "Failed to create analysis template" });
    }
  });

  app.put("/api/mbt/analysis-templates/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const existing = await storage.getAnalysisTemplate(req.params.id);
      if (!existing) return res.status(404).json({ message: "Template not found" });
      const { name, systemPrompt, parameters, isDefault } = req.body;
      const updated = await storage.updateAnalysisTemplate(req.params.id, {
        ...(name !== undefined && { name }),
        ...(systemPrompt !== undefined && { systemPrompt }),
        ...(parameters !== undefined && { parameters }),
        ...(isDefault !== undefined && { isDefault }),
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to update analysis template" });
    }
  });

  app.delete("/api/mbt/analysis-templates/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const existing = await storage.getAnalysisTemplate(req.params.id);
      if (!existing) return res.status(404).json({ message: "Template not found" });
      await storage.deleteAnalysisTemplate(req.params.id);
      res.json({ message: "Template deleted" });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete analysis template" });
    }
  });

  // ── MBT Sections ────────────────────────────────────────────────────────────
  app.get("/api/mbt/projects/:projectId/sections", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      res.json(await storage.getMbtSections(req.params.projectId));
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch sections" });
    }
  });

  app.post("/api/mbt/projects/:projectId/sections", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { name, order } = req.body;
      res.json(await storage.createMbtSection({ projectId: req.params.projectId, name, order: order ?? 0 }));
    } catch (error) {
      res.status(500).json({ message: "Failed to create section" });
    }
  });

  app.patch("/api/mbt/sections/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      res.json(await storage.updateMbtSection(req.params.id, req.body));
    } catch (error) {
      res.status(500).json({ message: "Failed to update section" });
    }
  });

  app.delete("/api/mbt/sections/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      await storage.deleteMbtSection(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete section" });
    }
  });

  app.post("/api/mbt/sections/:id/rules", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { type, value } = req.body;
      res.json(await storage.createMbtSectionRule({ sectionId: req.params.id, type, value }));
    } catch (error) {
      res.status(500).json({ message: "Failed to create rule" });
    }
  });

  app.patch("/api/mbt/section-rules/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      res.json(await storage.updateMbtSectionRule(req.params.id, req.body.value));
    } catch (error) {
      res.status(500).json({ message: "Failed to update rule" });
    }
  });

  app.delete("/api/mbt/section-rules/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      await storage.deleteMbtSectionRule(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete rule" });
    }
  });

  app.patch("/api/mbt/files/:fileId/section", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { sectionId } = req.body;
      res.json(await storage.updateMbtFileSection(req.params.fileId, sectionId ?? null));
    } catch (error) {
      res.status(500).json({ message: "Failed to update file section" });
    }
  });

  app.delete("/api/mbt/files/:fileId", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });
      await storage.deleteMbtDocumentFile(req.params.fileId);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete file" });
    }
  });

  app.patch("/api/mbt/files/:fileId/rename", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { filename } = req.body;
      if (!filename?.trim()) return res.status(400).json({ message: "Filename required" });
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });
      const updated = await storage.updateMbtDocumentFile(req.params.fileId, { filename: filename.trim() });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ message: "Failed to rename file" });
    }
  });

  app.post("/api/mbt/documents/:id/route", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const doc = await storage.getMbtDocument(req.params.id);
      if (!doc) return res.status(404).json({ message: "Document not found" });
      const count = await storage.routeMbtDocumentFiles(doc.id, doc.projectId);
      res.json({ routed: count });
    } catch (error) {
      res.status(500).json({ message: "Failed to route files" });
    }
  });

  // ── MBT Mark Buttons ────────────────────────────────────────────────────────
  app.get("/api/mbt/projects/:id/mark-buttons", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { sectionId } = req.query;
      res.json(await storage.getMbtMarkButtons(req.params.id, sectionId as string | undefined));
    } catch (error) {
      res.status(500).json({ message: "Failed to get mark buttons" });
    }
  });

  app.post("/api/mbt/projects/:id/mark-buttons", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { label, key, sectionId, order } = req.body;
      res.json(await storage.createMbtMarkButton({
        projectId: req.params.id,
        key: key || label.toLowerCase().replace(/\s+/g, '_'),
        label,
        sectionId: sectionId || null,
        order: order ?? 0,
      }));
    } catch (error) {
      res.status(500).json({ message: "Failed to create mark button" });
    }
  });

  app.patch("/api/mbt/mark-buttons/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { label, order } = req.body;
      res.json(await storage.updateMbtMarkButton(req.params.id, { label, order }));
    } catch (error) {
      res.status(500).json({ message: "Failed to update mark button" });
    }
  });

  app.delete("/api/mbt/mark-buttons/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      await storage.deleteMbtMarkButton(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete mark button" });
    }
  });

  // ── MBT File Annotations ────────────────────────────────────────────────────
  app.get("/api/mbt/files/:fileId/annotations", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      res.json(await storage.getMbtFileAnnotations(req.params.fileId));
    } catch (error) {
      res.status(500).json({ message: "Failed to get annotations" });
    }
  });

  app.post("/api/mbt/files/:fileId/marks/toggle", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { buttonKey, page } = req.body;
      const userId = (req as any).user?.id;
      const pageNum = parseInt(page, 10) || 1;
      res.json(await storage.toggleMbtFileMark(req.params.fileId, buttonKey, userId, pageNum));
    } catch (error) {
      res.status(500).json({ message: "Failed to toggle mark" });
    }
  });

  app.post("/api/mbt/files/:fileId/approve", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { approved } = req.body;
      const userId = (req as any).user?.id;
      const result = await storage.approveMbtFile(req.params.fileId, !!approved, userId);

      // Log activity — look up file → document → project
      storage.getMbtDocumentFile(req.params.fileId).then(async (file) => {
        if (!file) return;
        const doc = await storage.getMbtDocument(file.documentId);
        if (!doc) return;
        storage.logActivity({
          projectId: doc.projectId,
          userId,
          action: approved ? 'file_approved' : 'file_rejected',
          entityType: 'file',
          entityId: file.id,
          entityLabel: file.originalName || file.filename,
        }).catch(() => {});
      }).catch(() => {});

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to approve file" });
    }
  });

  app.post("/api/mbt/files/:fileId/extract-payments", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      const { spawn } = await import('child_process');
      const result = await new Promise<any>((resolve, reject) => {
        const proc = spawn('python3', ['python_server/extract_payments.py', file.filePath]);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`Extractor exited with code ${code}: ${stderr}`));
            return;
          }
          try { resolve(JSON.parse(stdout)); }
          catch (e) { reject(new Error('Failed to parse extractor output')); }
        });
        proc.on('error', (e: Error) => reject(e));
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Extraction failed" });
    }
  });

  // Export payment orders to XLSX
  app.get("/api/mbt/files/:fileId/extract-payments/xlsx", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    const tmpPath = path.join(os.tmpdir(), `mbt_pp_${req.params.fileId}_${Date.now()}.xlsx`);
    try {
      console.log('[XLSX] export started for', req.params.fileId);
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      const { spawn } = await import('child_process');
      const extracted = await new Promise<any>((resolve, reject) => {
        const proc = spawn('python3', ['python_server/extract_payments.py', file.filePath]);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code: number) => {
          if (code !== 0) { reject(new Error(`Extractor: ${stderr}`)); return; }
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error('Failed to parse extractor output')); }
        });
        proc.on('error', reject);
      });

      console.log('[XLSX] extracted', extracted?.payments?.length, 'payments');

      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'КПД';
      wb.created = new Date();

      const ws = wb.addWorksheet('Реестр ПП');
      ws.columns = [
        { key: 'num',     width: 6  },
        { key: 'page',    width: 7  },
        { key: 'type',    width: 8  },
        { key: 'number',  width: 10 },
        { key: 'date',    width: 14 },
        { key: 'amount',  width: 22 },
        { key: 'purpose', width: 70 },
      ];

      const headerRow = ws.addRow(['№', 'Стр.', 'Тип', 'Номер', 'Дата', 'Сумма, руб.', 'Назначение платежа']);
      headerRow.font = { bold: true, size: 11 };
      headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F7' } };
      headerRow.alignment = { vertical: 'middle', wrapText: true };
      headerRow.height = 22;

      (extracted.payments as any[]).forEach((pp, idx) => {
        const row = ws.addRow([idx + 1, pp.page ?? '', pp.type || 'ПП', pp.number, pp.date, pp.amount || 0, pp.purpose]);
        const amtCell = row.getCell('amount');
        amtCell.numFmt = '#,##0.00';
        amtCell.alignment = { horizontal: 'right' };
        row.getCell('purpose').alignment = { wrapText: true, vertical: 'top' };
        row.height = 18;
        if (idx % 2 === 1) {
          row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFF' } };
        }
      });

      const totalRow = ws.addRow(['', 'Итого:', `${extracted.total_count}`, '', extracted.total_amount || 0, '']);
      totalRow.font = { bold: true };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F7' } };
      totalRow.getCell('amount').numFmt = '#,##0.00';
      totalRow.getCell('amount').alignment = { horizontal: 'right' };

      const borderStyle = { style: 'thin' as const, color: { argb: 'FFBBBBBB' } };
      ws.eachRow(row => { row.eachCell(cell => { cell.border = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle }; }); });
      ws.views = [{ state: 'frozen', ySplit: 1 }];

      const safeName = (file.filename || file.originalName || 'export').replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_').slice(0, 40);
      const dateStr = new Date().toISOString().slice(0, 10);
      const xlsxName = `Реестр_ПП_${safeName}_${dateStr}.xlsx`;

      console.log('[XLSX] writing to', tmpPath);
      await wb.xlsx.writeFile(tmpPath);
      const stat = fs.statSync(tmpPath);
      console.log('[XLSX] file written, size =', stat.size, 'bytes');

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(xlsxName)}`);
      res.setHeader('Content-Length', stat.size);

      const readStream = fs.createReadStream(tmpPath);
      readStream.on('end', () => { fs.unlink(tmpPath, () => {}); });
      readStream.on('error', (err) => { console.error('[XLSX] stream error', err); fs.unlink(tmpPath, () => {}); });
      readStream.pipe(res);

    } catch (error: any) {
      console.error('[XLSX] ERROR:', error?.message, error?.stack);
      fs.unlink(tmpPath, () => {});
      if (!res.headersSent) {
        res.status(500).json({ message: error?.message || "Export failed" });
      }
    }
  });

  // ── Statement extraction job system ─────────────────────────────────────────
  // Jobs are stored in memory: Map<jobId, JobState>
  // Start → poll status → download xlsx when done

  interface StatementJobState {
    status: 'running' | 'done' | 'error';
    fileId: string;
    fileName: string;
    startPage: number;
    endPage: number;
    progress: { chunk: number; totalChunks: number; pagesDone: number; totalPages: number; rowsSoFar: number };
    columns: string[];
    rows: string[][];      // kept for backward compat (empty when resultFilePath is set)
    resultFilePath?: string; // temp .jsonl file written by Python to avoid pipe overflow
    totalRows: number;
    error?: string;
    createdAt: number;
  }
  const statementJobs = new Map<string, StatementJobState>();

  // Cleanup jobs older than 2 hours (including temp .jsonl files)
  setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, job] of statementJobs.entries()) {
      if (job.createdAt < cutoff) {
        if (job.resultFilePath) fs.unlink(job.resultFilePath, () => {});
        statementJobs.delete(id);
      }
    }
  }, 10 * 60 * 1000);

  // POST /api/mbt/files/:fileId/extract-statement/start
  app.post("/api/mbt/files/:fileId/extract-statement/start", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      const startPage = parseInt(String(req.body.startPage ?? '1'), 10) || 1;
      const endPage   = req.body.endPage ? (parseInt(String(req.body.endPage), 10) || undefined) : undefined;
      // Smaller chunks = less RAM per process; each process exits cleanly
      const chunkSize = Math.min(parseInt(String(req.body.chunkSize ?? '200'), 10) || 200, 200);
      const CHUNK_TIMEOUT_MS = 210_000; // 210 sec per chunk (middle pages ~77s/200pp, safety margin)

      const jobId = `stmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Shared accumulator .jsonl file — all chunks append here
      const sharedResultPath = path.join(os.tmpdir(), `stmt_${jobId}.jsonl`);

      const job: StatementJobState = {
        status: 'running',
        fileId: req.params.fileId,
        fileName: file.filename || file.filePath.split('/').pop() || 'statement',
        startPage,
        endPage: endPage ?? 0,
        progress: { chunk: 0, totalChunks: 0, pagesDone: 0, totalPages: 0, rowsSoFar: 0 },
        columns: [],
        rows: [],
        resultFilePath: sharedResultPath,
        totalRows: 0,
        createdAt: Date.now(),
      };
      statementJobs.set(jobId, job);

      // ── Background orchestrator ───────────────────────────────────────────────
      // Runs chunks sequentially, one Python process per chunk.
      // Each process opens the PDF fresh → no memory accumulation across chunks.
      (async () => {
        const { spawn } = await import('child_process');

        // Determine total page count first (lightweight pdfplumber call)
        let resolvedEnd = endPage;
        if (!resolvedEnd) {
          try {
            resolvedEnd = await new Promise<number>((resolve) => {
              const proc = spawn('python3', ['-c',
                `import pdfplumber, json, sys; ` +
                `pdf = pdfplumber.open(sys.argv[1]); ` +
                `print(len(pdf.pages)); pdf.close()`,
                file.filePath,
              ]);
              let out = '';
              proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
              proc.on('close', () => { resolve(parseInt(out.trim(), 10) || startPage); });
              proc.on('error', () => { resolve(startPage); });
            });
          } catch {
            resolvedEnd = startPage;
          }
        }
        job.endPage = resolvedEnd!;

        const totalPages   = resolvedEnd! - startPage + 1;
        const totalChunks  = Math.ceil(totalPages / chunkSize);
        job.progress       = { chunk: 0, totalChunks, pagesDone: 0, totalPages, rowsSoFar: 0 };

        // Helper: run one Python chunk process with timeout
        const runChunk = (chunkStart: number, chunkEnd: number): Promise<{rows: number; columns: string[]}> =>
          new Promise((resolve, reject) => {
            const proc = spawn('python3', [
              'python_server/extract_statement.py',
              file.filePath,
              String(chunkStart),
              String(chunkEnd),
            ]);

            let stdout = '';
            let killed = false;

            // Kill process if it hangs past timeout
            const timer = setTimeout(() => {
              killed = true;
              proc.kill('SIGKILL');
              reject(new Error(`Chunk ${chunkStart}-${chunkEnd} timed out after ${CHUNK_TIMEOUT_MS / 1000}s`));
            }, CHUNK_TIMEOUT_MS);

            proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });

            proc.on('close', async (code) => {
              clearTimeout(timer);
              if (killed) return;
              // Parse last JSON line from stdout
              const lines = stdout.trim().split('\n').filter(Boolean);
              const lastLine = lines[lines.length - 1] ?? '';
              try {
                const msg = JSON.parse(lastLine);
                if (msg.type === 'result_file') {
                  // Append chunk rows to shared file
                  const readline = await import('readline');
                  const appendRows = await new Promise<number>((res2, rej2) => {
                    const rl = readline.createInterface({
                      input: fs.createReadStream(msg.path, { encoding: 'utf-8' }),
                      crlfDelay: Infinity,
                    });
                    const writeStream = fs.createWriteStream(sharedResultPath, { flags: 'a', encoding: 'utf-8' });
                    let count = 0;
                    rl.on('line', (line) => { if (line.trim()) { writeStream.write(line + '\n'); count++; } });
                    rl.on('close', () => { writeStream.end(); res2(count); });
                    rl.on('error', rej2);
                  });
                  // Clean up chunk's own temp file
                  fs.unlink(msg.path, () => {});
                  resolve({ rows: appendRows, columns: msg.columns ?? [] });
                } else if (msg.type === 'error') {
                  reject(new Error(msg.message));
                } else {
                  reject(new Error(`Unexpected message: ${lastLine.slice(0, 200)}`));
                }
              } catch (e) {
                reject(new Error(`Failed to parse chunk output: ${lastLine.slice(0, 200)}`));
              }
            });

            proc.on('error', (e) => { clearTimeout(timer); reject(e); });
          });

        // Run all chunks sequentially
        for (let ci = 0; ci < totalChunks; ci++) {
          if (job.status === 'error') break;

          const cStart = startPage + ci * chunkSize;
          const cEnd   = Math.min(cStart + chunkSize - 1, resolvedEnd!);

          try {
            const { rows, columns } = await runChunk(cStart, cEnd);
            job.totalRows += rows;
            if (job.columns.length === 0 && columns.length > 0) {
              job.columns = columns; // use first chunk's detected columns
            }
            job.progress = {
              chunk:       ci + 1,
              totalChunks,
              pagesDone:   cEnd - startPage + 1,
              totalPages,
              rowsSoFar:   job.totalRows,
            };
          } catch (err: any) {
            console.error(`[STMT] chunk ${ci + 1} failed:`, err.message);
            // Non-fatal: log and continue with next chunk
            job.progress = {
              chunk:       ci + 1,
              totalChunks,
              pagesDone:   cEnd - startPage + 1,
              totalPages,
              rowsSoFar:   job.totalRows,
            };
          }
        }

        job.status = 'done';
      })().catch((err) => {
        job.status = 'error';
        job.error  = err.message;
      });

      res.json({ jobId, status: 'running' });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Failed to start extraction" });
    }
  });

  // GET /api/mbt/extract-statement/status/:jobId
  app.get("/api/mbt/extract-statement/status/:jobId", requireAuth, requireModuleAccess("mbt"), (req, res) => {
    const job = statementJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    res.json({
      jobId: req.params.jobId,
      status: job.status,
      progress: job.progress,
      totalRows: job.totalRows,
      columns: job.status === 'done' ? job.columns : [],
      error: job.error,
    });
  });

  // GET /api/mbt/extract-statement/download/:jobId  → xlsx
  app.get("/api/mbt/extract-statement/download/:jobId", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    const job = statementJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.status !== 'done') return res.status(400).json({ message: "Job not finished yet" });

    const tmpPath = path.join(os.tmpdir(), `mbt_stmt_${req.params.jobId}.xlsx`);
    try {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'КПД';
      wb.created = new Date();

      const ws = wb.addWorksheet('Выписка');

      // Columns
      const colCount = job.columns.length || 1;
      ws.columns = Array.from({ length: colCount }, (_, i) => ({
        key: `c${i}`,
        width: i === 0 ? 12 : i === colCount - 1 ? 60 : 20,
      }));

      // Header row
      if (job.columns.length > 0) {
        const hRow = ws.addRow(job.columns);
        hRow.font = { bold: true, size: 10 };
        hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F7' } };
        hRow.alignment = { vertical: 'middle', wrapText: true };
        hRow.height = 22;
      }

      // Data rows — read from temp .jsonl file line by line (avoids loading all into RAM)
      const borderStyle = { style: 'thin' as const, color: { argb: 'FFBBBBBB' } };

      const readline = await import('readline');
      const sourceRows: string[][] = job.resultFilePath
        ? await new Promise<string[][]>((resolve, reject) => {
            const rows: string[][] = [];
            const rl = readline.createInterface({
              input: fs.createReadStream(job.resultFilePath as string, { encoding: 'utf-8' }),
              crlfDelay: Infinity,
            });
            rl.on('line', (line) => {
              if (!line.trim()) return;
              try { rows.push(JSON.parse(line)); } catch { /* skip malformed */ }
            });
            rl.on('close', () => resolve(rows));
            rl.on('error', reject);
          })
        : job.rows;

      sourceRows.forEach((row, idx) => {
        const r = ws.addRow(row);
        r.font = { size: 9 };
        r.height = 14;
        if (idx % 2 === 1) {
          r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFF' } };
        }
      });

      // Borders on all used cells
      ws.eachRow(row => {
        row.eachCell(cell => {
          cell.border = { top: borderStyle, left: borderStyle, bottom: borderStyle, right: borderStyle };
        });
      });

      ws.views = [{ state: 'frozen', ySplit: job.columns.length > 0 ? 1 : 0 }];

      // Summary sheet
      const ws2 = wb.addWorksheet('Сводка');
      ws2.addRow(['Параметр', 'Значение']);
      ws2.addRow(['Файл', job.fileName]);
      ws2.addRow(['Страницы', `${job.startPage}–${job.endPage}`]);
      ws2.addRow(['Строк данных', job.totalRows]);
      ws2.addRow(['Колонок', colCount]);
      ws2.addRow(['Дата экспорта', new Date().toLocaleString('ru-RU')]);
      ws2.columns = [{ width: 22 }, { width: 50 }];
      ws2.getRow(1).font = { bold: true };

      await wb.xlsx.writeFile(tmpPath);
      const stat = fs.statSync(tmpPath);

      const safeName = encodeURIComponent(`Выписка_${job.startPage}-${job.endPage}_${job.totalRows}строк.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
      res.setHeader('Content-Length', stat.size);

      const cleanup = () => {
        fs.unlink(tmpPath, () => {});
        // Also delete the .jsonl temp file written by Python
        if (job.resultFilePath) fs.unlink(job.resultFilePath, () => {});
      };

      const stream = fs.createReadStream(tmpPath);
      stream.pipe(res);
      stream.on('end', cleanup);
      stream.on('error', cleanup);
    } catch (error: any) {
      fs.unlink(tmpPath, () => {});
      if (!res.headersSent) res.status(500).json({ message: error?.message || "Export failed" });
    }
  });

  app.delete("/api/mbt/annotations/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      await storage.deleteMbtFileAnnotation(req.params.id);
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ message: "Failed to delete annotation" });
    }
  });

  // ── MBT Report ──────────────────────────────────────────────────────────────
  app.get("/api/mbt/report", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { projectId, documentId, sectionId, fileId, format } = req.query as Record<string, string>;
      if (!projectId) return res.status(400).json({ message: "projectId required" });

      const data = await storage.getMbtReportData({ projectId, documentId, sectionId, fileId });

      if (format === 'xlsx') {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet('Отчёт КПД');

        ws.columns = [
          { header: '№', key: 'num', width: 5 },
          { header: 'Файл', key: 'filename', width: 35 },
          { header: 'Раздел', key: 'section', width: 22 },
          { header: 'Согласован', key: 'approved', width: 13 },
          { header: 'Печатей', key: 'seals', width: 10 },
          { header: 'Подписей', key: 'signatures', width: 11 },
          { header: 'Дат', key: 'dates', width: 8 },
          { header: 'Отметки', key: 'marks', width: 40 },
          { header: 'Статус анализа', key: 'analysis', width: 16 },
        ];

        const headerRow = ws.getRow(1);
        headerRow.font = { bold: true, size: 11 };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        headerRow.alignment = { vertical: 'middle', wrapText: true };
        headerRow.height = 20;

        const ANALYSIS_LABELS: Record<string, string> = {
          completed: 'Завершён', processing: 'Обрабатывается',
          error: 'Ошибка', none: 'Не запускался', pending: 'Ожидает',
        };

        let rowNum = 2;
        let lastSectionId: string | null | undefined = undefined;
        let sectionSealSum = 0, sectionSigSum = 0, sectionDateSum = 0;

        const flushSectionTotal = (secName: string | null) => {
          if (lastSectionId === undefined) return;
          const totalRow = ws.getRow(rowNum++);
          totalRow.values = ['', `Итого: ${secName ?? 'Нераспределённые'}`, '', '', sectionSealSum, sectionSigSum, sectionDateSum, '', ''];
          totalRow.font = { bold: true, italic: true, color: { argb: 'FF64748B' } };
          totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
          sectionSealSum = 0; sectionSigSum = 0; sectionDateSum = 0;
        };

        let idx = 0;
        for (const row of data.rows) {
          if (row.sectionId !== lastSectionId) {
            if (lastSectionId !== undefined) {
              const prevName = data.rows.find(r => r.sectionId === lastSectionId)?.sectionName ?? null;
              flushSectionTotal(prevName);
            }
            lastSectionId = row.sectionId;
          }
          sectionSealSum += row.sealCount;
          sectionSigSum += row.signatureCount;
          sectionDateSum += row.dateCount;

          const marksText = row.marks.length === 0
            ? ''
            : row.marks.map(m => m.page ? `${m.label} (стр. ${m.page})` : m.label).join('; ');

          const dataRow = ws.getRow(rowNum++);
          dataRow.values = [
            ++idx, row.filename, row.sectionName ?? 'Нераспределённые',
            row.isApproved ? 'Да' : 'Нет',
            row.sealCount, row.signatureCount, row.dateCount,
            marksText, ANALYSIS_LABELS[row.analysisStatus] ?? row.analysisStatus,
          ];
          if (row.isApproved) {
            dataRow.getCell('approved').font = { color: { argb: 'FF16A34A' }, bold: true };
          }
          if (row.marks.length > 0) {
            dataRow.getCell('marks').font = { color: { argb: 'FFDC2626' } };
          }
          dataRow.alignment = { vertical: 'top', wrapText: true };
        }

        const lastSectionName = data.rows.find(r => r.sectionId === lastSectionId)?.sectionName ?? null;
        flushSectionTotal(lastSectionName);

        const grandRow = ws.getRow(rowNum);
        grandRow.values = ['', 'ИТОГО по архиву', '', '',
          data.rows.reduce((s, r) => s + r.sealCount, 0),
          data.rows.reduce((s, r) => s + r.signatureCount, 0),
          data.rows.reduce((s, r) => s + r.dateCount, 0),
          '',
          `${data.rows.filter(r => r.isApproved).length} / ${data.rows.length} согласовано`,
        ];
        grandRow.font = { bold: true, size: 11 };
        grandRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

        const dateStr = new Date().toISOString().split('T')[0];
        const safeName = data.project.name.replace(/[/\\:*?"<>|]/g, '_');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`КПД_${safeName}_${dateStr}.xlsx`)}`);
        const buffer = await wb.xlsx.writeBuffer();
        return res.end(Buffer.from(buffer));
      }

      return res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message || 'Failed to generate report' });
    }
  });

  // ============================================================================
  // CHECKLIST TEMPLATES
  // ============================================================================

  app.get("/api/checklist-templates", requireAuth, async (_req, res) => {
    try {
      const { seedBuiltinTemplates } = await import('./services/checklistService');
      await seedBuiltinTemplates();
      const templates = await storage.getChecklistTemplates();
      res.json(templates);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/checklist-templates/:id", requireAuth, async (req, res) => {
    try {
      const data = await storage.getChecklistTemplateWithItems(req.params.id);
      if (!data) return res.status(404).json({ message: "Template not found" });
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/checklist-templates", requireAuth, async (req, res) => {
    try {
      const { name, description, caseType, items } = req.body;
      if (!name) return res.status(400).json({ message: "Name is required" });
      const template = await storage.createChecklistTemplate({
        name, description, caseType: caseType ?? 'custom',
        isBuiltin: false, createdBy: req.user!.id,
      });
      if (Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          await storage.createChecklistItem({
            templateId: template.id,
            name: it.name,
            description: it.description,
            isRequired: it.isRequired ?? true,
            matchRules: it.matchRules ?? [],
            order: it.order ?? i,
            alternativeGroupId: it.alternativeGroupId,
          });
        }
      }
      const full = await storage.getChecklistTemplateWithItems(template.id);
      res.status(201).json(full);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/checklist-templates/:id", requireAuth, async (req, res) => {
    try {
      const { name, description, caseType } = req.body;
      const updated = await storage.updateChecklistTemplate(req.params.id, { name, description, caseType });
      res.json(updated);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/checklist-templates/:id", requireAuth, async (req, res) => {
    try {
      const tpl = await storage.getChecklistTemplate(req.params.id);
      if (!tpl) return res.status(404).json({ message: "Template not found" });
      if (tpl.isBuiltin) return res.status(403).json({ message: "Cannot delete built-in template" });
      await storage.deleteChecklistTemplate(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/checklist-templates/:id/items", requireAuth, async (req, res) => {
    try {
      const item = await storage.createChecklistItem({ ...req.body, templateId: req.params.id });
      res.status(201).json(item);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.patch("/api/checklist-items/:id", requireAuth, async (req, res) => {
    try {
      const item = await storage.updateChecklistItem(req.params.id, req.body);
      res.json(item);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  });

  app.delete("/api/checklist-items/:id", requireAuth, async (req, res) => {
    try {
      await storage.deleteChecklistItem(req.params.id);
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // PROJECT CHECK (completeness + cross-check + conclusion)
  // ============================================================================

  app.post("/api/mbt/projects/:id/check", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { templateId } = req.body;
      const project = await storage.getMbtProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const {
        checkCompleteness, crossCheckDocuments, buildConclusion, seedBuiltinTemplates,
      } = await import('./services/checklistService');

      await seedBuiltinTemplates();

      const completenessResult = templateId
        ? await checkCompleteness(req.params.id, templateId)
        : [];
      const crossCheckResult = await crossCheckDocuments(req.params.id);
      const { status, completenessScore, criticalIssues, nonCriticalIssues } =
        buildConclusion(completenessResult, crossCheckResult);

      const conclusion = await storage.createConclusion({
        projectId: req.params.id,
        checklistTemplateId: templateId ?? null,
        status,
        completenessScore,
        completenessResult,
        crossCheckResult,
        criticalIssues,
        nonCriticalIssues,
        createdBy: req.user!.id,
      });

      storage.logActivity({
        projectId: req.params.id,
        userId: req.user!.id,
        action: 'check_run',
        entityType: 'conclusion',
        entityId: conclusion.id,
        meta: { status, completenessScore, criticalIssues, nonCriticalIssues },
      }).catch(() => {});

      res.json(conclusion);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mbt/projects/:id/conclusion", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const conclusion = await storage.getLatestConclusion(req.params.id);
      res.json(conclusion ?? null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mbt/projects/:id/conclusions", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const history = await storage.getConclusionHistory(req.params.id);
      res.json(history);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mbt/conclusions/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const conclusion = await storage.getConclusion(req.params.id);
      if (!conclusion) return res.status(404).json({ message: "Conclusion not found" });
      res.json(conclusion);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/mbt/conclusions/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { manualOverrides, reviewerNote, finalStatus, isReviewed } = req.body;
      const patch: Record<string, any> = {};
      if (manualOverrides !== undefined) patch.manualOverrides = manualOverrides;
      if (reviewerNote !== undefined) patch.reviewerNote = reviewerNote;
      if (finalStatus !== undefined) patch.finalStatus = finalStatus;
      if (isReviewed !== undefined) {
        patch.isReviewed = isReviewed;
        if (isReviewed) {
          patch.reviewedBy = req.user!.id;
          patch.reviewedAt = new Date();
        } else {
          patch.reviewedBy = null;
          patch.reviewedAt = null;
        }
      }
      const updated = await storage.updateConclusion(req.params.id, patch);

      if (isReviewed !== undefined || finalStatus !== undefined || manualOverrides !== undefined) {
        const conclusion = await storage.getConclusion(req.params.id);
        if (conclusion) {
          const action = isReviewed === true ? 'conclusion_signed'
            : isReviewed === false ? 'conclusion_unsigned'
            : manualOverrides !== undefined ? 'override_set'
            : 'reviewer_note_updated';
          storage.logActivity({
            projectId: conclusion.projectId,
            userId: req.user!.id,
            action: action as any,
            entityType: 'conclusion',
            entityId: conclusion.id,
            meta: finalStatus ? { finalStatus } : undefined,
          }).catch(() => {});
        }
      }

      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mbt/conclusions/:id/export", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const conclusion = await storage.getConclusion(req.params.id);
      if (!conclusion) return res.status(404).json({ message: "Conclusion not found" });
      const project = await storage.getMbtProject(conclusion.projectId);
      if (!project) return res.status(404).json({ message: "Project not found" });

      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'КПД';
      wb.created = new Date();

      const DOC_CONCLUSION_STATUS_LABELS_LOCAL: Record<string, string> = {
        approved: 'Одобрено', revision: 'Требует доработки',
        rejected: 'Отказано', pending: 'На рассмотрении',
      };

      const effectiveStatus = conclusion.finalStatus ?? conclusion.status;

      const summary = wb.addWorksheet('Заключение');
      summary.columns = [{ key: 'key', width: 32 }, { key: 'val', width: 48 }];
      const addRow = (key: string, val: string, bold = false) => {
        const row = summary.addRow({ key, val });
        if (bold) { row.getCell('key').font = { bold: true }; row.getCell('val').font = { bold: true }; }
      };
      summary.addRow({ key: 'Проект', val: project.name });
      summary.addRow({ key: 'Дата проверки', val: new Date(conclusion.createdAt).toLocaleString('ru-RU') });
      summary.addRow({});
      addRow('Итоговый статус', DOC_CONCLUSION_STATUS_LABELS_LOCAL[effectiveStatus] ?? effectiveStatus, true);
      addRow('Комплектность', `${conclusion.completenessScore ?? 0}%`, true);
      addRow('Критических замечаний', String(conclusion.criticalIssues ?? 0));
      addRow('Некритических замечаний', String(conclusion.nonCriticalIssues ?? 0));
      if (conclusion.isReviewed) {
        summary.addRow({});
        addRow('Верификация', 'Подписано рецензентом');
        if (conclusion.reviewedAt) addRow('Дата верификации', new Date(conclusion.reviewedAt).toLocaleString('ru-RU'));
        if (conclusion.reviewerNote) addRow('Примечание рецензента', conclusion.reviewerNote);
      }

      const statusCell = summary.getCell('B4');
      if (effectiveStatus === 'approved') statusCell.font = { bold: true, color: { argb: 'FF166534' } };
      else if (effectiveStatus === 'rejected') statusCell.font = { bold: true, color: { argb: 'FF991B1B' } };
      else statusCell.font = { bold: true, color: { argb: 'FF92400E' } };

      const completeness = (conclusion.completenessResult ?? []) as Array<{
        itemId: string; itemName: string; isRequired: boolean;
        status: string; matchedFileName?: string;
      }>;
      const manualOverrides = (conclusion.manualOverrides ?? []) as Array<{
        itemId: string; status: string; note?: string; fileName?: string;
      }>;

      if (completeness.length > 0) {
        const ws = wb.addWorksheet('Комплектность');
        ws.columns = [
          { header: '№', key: 'n', width: 5 },
          { header: 'Позиция', key: 'name', width: 40 },
          { header: 'Обязательный', key: 'req', width: 14 },
          { header: 'Автостатус', key: 'auto', width: 18 },
          { header: 'Ручной статус', key: 'manual', width: 18 },
          { header: 'Найденный файл', key: 'file', width: 45 },
          { header: 'Примечание', key: 'note', width: 30 },
        ];
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        const STATUS_LABEL: Record<string, string> = {
          found: 'Найден', missing: 'Отсутствует', alternative_found: 'Альтернатива',
          not_applicable: 'Не применимо',
        };
        completeness.forEach((item, idx) => {
          const ov = manualOverrides.find(o => o.itemId === item.itemId);
          const row = ws.addRow({
            n: idx + 1, name: item.itemName,
            req: item.isRequired ? 'Да' : 'Нет',
            auto: STATUS_LABEL[item.status] ?? item.status,
            manual: ov ? STATUS_LABEL[ov.status] ?? ov.status : '',
            file: ov?.fileName ?? item.matchedFileName ?? '',
            note: ov?.note ?? '',
          });
          const autoCell = row.getCell('auto');
          if (item.status === 'found') autoCell.font = { color: { argb: 'FF166534' } };
          else if (item.status === 'missing') autoCell.font = { color: { argb: 'FF991B1B' }, bold: item.isRequired };
          else autoCell.font = { color: { argb: 'FF92400E' } };
          if (ov) {
            const manualCell = row.getCell('manual');
            if (ov.status === 'found') manualCell.font = { color: { argb: 'FF166534' }, bold: true };
            else if (ov.status === 'not_applicable') manualCell.font = { color: { argb: 'FF6B7280' } };
            else manualCell.font = { color: { argb: 'FF991B1B' } };
          }
        });
      }

      const crossCheck = (conclusion.crossCheckResult ?? []) as Array<{
        field: string; fieldLabel: string; status: string;
        values: Array<{ fileId: string; fileName: string; value: string }>;
      }>;
      if (crossCheck.length > 0) {
        const ws = wb.addWorksheet('Сверка реквизитов');
        ws.columns = [
          { header: 'Реквизит', key: 'field', width: 22 },
          { header: 'Статус', key: 'status', width: 16 },
          { header: 'Значение', key: 'value', width: 26 },
          { header: 'Файл', key: 'file', width: 50 },
        ];
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
        for (const item of crossCheck) {
          for (const v of item.values) {
            const row = ws.addRow({
              field: item.fieldLabel,
              status: item.status === 'match' ? 'Совпадает' : 'Расхождение',
              value: v.value, file: v.fileName,
            });
            const sc = row.getCell('status');
            if (item.status === 'match') sc.font = { color: { argb: 'FF166534' } };
            else sc.font = { color: { argb: 'FF991B1B' }, bold: true };
          }
        }
      }

      const filename = `conclusion_${project.name.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_')}_${new Date(conclusion.createdAt).toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      const buffer = await wb.xlsx.writeBuffer();
      return res.end(Buffer.from(buffer));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/mbt/projects/:id/conclusion/export", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const project = await storage.getMbtProject(req.params.id);
      if (!project) return res.status(404).json({ message: "Project not found" });
      const conclusion = await storage.getLatestConclusion(req.params.id);
      if (!conclusion) return res.status(404).json({ message: "No conclusion found" });

      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'КПД';
      wb.created = new Date();

      const DOC_CONCLUSION_STATUS_LABELS: Record<string, string> = {
        approved: 'Одобрено', revision: 'Требует доработки',
        rejected: 'Отказано', pending: 'На рассмотрении',
      };

      // ── Sheet 1: Summary ──────────────────────────────────────────────
      const summary = wb.addWorksheet('Заключение');
      summary.columns = [
        { key: 'key', width: 32 },
        { key: 'val', width: 48 },
      ];

      const addRow = (key: string, val: string | number, bold = false) => {
        const row = summary.addRow({ key, val });
        if (bold) {
          row.getCell('key').font = { bold: true };
          row.getCell('val').font = { bold: true };
        }
      };

      summary.addRow({ key: 'Проект', val: project.name });
      summary.addRow({ key: 'Дата проверки', val: new Date(conclusion.createdAt).toLocaleString('ru-RU') });
      summary.addRow({});
      addRow('Итоговый статус', DOC_CONCLUSION_STATUS_LABELS[conclusion.status] ?? conclusion.status, true);
      addRow('Комплектность', `${conclusion.completenessScore ?? 0}%`, true);
      addRow('Критических замечаний', String(conclusion.criticalIssues ?? 0));
      addRow('Некритических замечаний', String(conclusion.nonCriticalIssues ?? 0));

      const statusCell = summary.getCell('B4');
      if (conclusion.status === 'approved') statusCell.font = { bold: true, color: { argb: 'FF166534' } };
      else if (conclusion.status === 'rejected') statusCell.font = { bold: true, color: { argb: 'FF991B1B' } };
      else statusCell.font = { bold: true, color: { argb: 'FF92400E' } };

      // ── Sheet 2: Completeness ─────────────────────────────────────────
      const completeness = (conclusion.completenessResult ?? []) as Array<{
        itemId: string; itemName: string; isRequired: boolean;
        status: string; matchedFileName?: string; alternativeGroupId?: string;
      }>;

      if (completeness.length > 0) {
        const ws = wb.addWorksheet('Комплектность');
        ws.columns = [
          { header: '№', key: 'n', width: 5 },
          { header: 'Позиция', key: 'name', width: 40 },
          { header: 'Обязательный', key: 'req', width: 16 },
          { header: 'Статус', key: 'status', width: 20 },
          { header: 'Найденный файл', key: 'file', width: 50 },
        ];
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

        const STATUS_LABEL: Record<string, string> = {
          found: 'Найден', missing: 'Отсутствует', alternative_found: 'Альтернатива',
        };

        completeness.forEach((item, idx) => {
          const row = ws.addRow({
            n: idx + 1,
            name: item.itemName,
            req: item.isRequired ? 'Да' : 'Нет',
            status: STATUS_LABEL[item.status] ?? item.status,
            file: item.matchedFileName ?? '',
          });
          const statusCell = row.getCell('status');
          if (item.status === 'found') statusCell.font = { color: { argb: 'FF166534' } };
          else if (item.status === 'missing') {
            statusCell.font = { color: { argb: 'FF991B1B' }, bold: item.isRequired };
          } else statusCell.font = { color: { argb: 'FF92400E' } };
        });
      }

      // ── Sheet 3: Cross-check ──────────────────────────────────────────
      const crossCheck = (conclusion.crossCheckResult ?? []) as Array<{
        field: string; fieldLabel: string; status: string;
        values: Array<{ fileId: string; fileName: string; value: string }>;
      }>;

      if (crossCheck.length > 0) {
        const ws = wb.addWorksheet('Сверка реквизитов');
        ws.columns = [
          { header: 'Реквизит', key: 'field', width: 22 },
          { header: 'Статус', key: 'status', width: 16 },
          { header: 'Значение', key: 'value', width: 26 },
          { header: 'Файл', key: 'file', width: 50 },
        ];
        ws.getRow(1).font = { bold: true };
        ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

        for (const item of crossCheck) {
          const statusLabel = item.status === 'match' ? 'Совпадает' : 'Расхождение';
          for (const v of item.values) {
            const row = ws.addRow({
              field: item.fieldLabel,
              status: statusLabel,
              value: v.value,
              file: v.fileName,
            });
            const sc = row.getCell('status');
            if (item.status === 'match') sc.font = { color: { argb: 'FF166534' } };
            else sc.font = { color: { argb: 'FF991B1B' }, bold: true };
          }
        }
      }

      const filename = `conclusion_${project.name.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      const buffer = await wb.xlsx.writeBuffer();
      return res.end(Buffer.from(buffer));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // FOLDERS
  // ============================================================================
  app.get("/api/mbt/projects/:id/folders", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const folders = await storage.getFolders(req.params.id);
      res.json(folders);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mbt/projects/:id/folders", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { name, parentId, color } = req.body;
      if (!name?.trim()) return res.status(400).json({ message: "Name is required" });
      const folder = await storage.createFolder({
        projectId: req.params.id,
        name: name.trim(),
        parentId: parentId ?? null,
        color: color ?? '#6b7280',
        order: 0,
      });
      res.json(folder);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/mbt/folders/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { name, parentId, color, order } = req.body;
      const folder = await storage.updateFolder(req.params.id, { name, parentId, color, order });
      res.json(folder);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/mbt/folders/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      await storage.deleteFolder(req.params.id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/mbt/files/:id/folder", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { folderId } = req.body;
      await storage.assignFileToFolder(req.params.id, folderId ?? null);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // FILE RELATIONS
  // ============================================================================
  app.get("/api/mbt/files/:id/relations", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const relations = await storage.getFileRelations(req.params.id);
      res.json(relations);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/mbt/files/:id/relations", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { relatedFileId, relationType, note } = req.body;
      if (!relatedFileId || !relationType) return res.status(400).json({ message: "relatedFileId and relationType are required" });
      if (relatedFileId === req.params.id) return res.status(400).json({ message: "Cannot link file to itself" });
      const relation = await storage.createFileRelation({
        fileId: req.params.id,
        relatedFileId,
        relationType,
        note: note ?? null,
        createdBy: req.user!.id,
      });
      res.json(relation);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/mbt/file-relations/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      await storage.deleteFileRelation(req.params.id);
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // PROJECT ASSISTANT
  // ============================================================================
  app.post("/api/mbt/projects/:id/assistant", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { messages, sessionState } = req.body;
      if (!Array.isArray(messages)) return res.status(400).json({ message: "messages array required" });
      const state = sessionState ?? { createdTemplateId: null };
      const { runProjectAssistant } = await import('./services/projectAssistant');
      const result = await runProjectAssistant(req.params.id, req.user!.id, messages, state);
      // Return updated sessionState so client can persist it across turns
      res.json({ ...result, sessionState: state });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // ACTIVITY LOG
  // ============================================================================
  app.get("/api/mbt/projects/:id/activity", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const limit = Math.min(parseInt(String(req.query.limit ?? '100'), 10) || 100, 200);
      const log = await storage.getActivityLog(req.params.id, limit);
      res.json(log);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ============================================================================
  // PARSING TEMPLATES — CRUD
  // ============================================================================

  app.get("/api/mbt/parsing-templates", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const { projectId } = req.query;
      if (!projectId) return res.status(400).json({ message: "projectId required" });
      const templates = await storage.getParsingTemplates(String(projectId));
      res.json(templates);
    } catch {
      res.status(500).json({ message: "Failed to fetch parsing templates" });
    }
  });

  app.post("/api/mbt/parsing-templates", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const template = await storage.createParsingTemplate(req.body);
      res.json(template);
    } catch {
      res.status(500).json({ message: "Failed to create parsing template" });
    }
  });

  app.put("/api/mbt/parsing-templates/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const template = await storage.updateParsingTemplate(req.params.id, req.body);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch {
      res.status(500).json({ message: "Failed to update parsing template" });
    }
  });

  app.delete("/api/mbt/parsing-templates/:id", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      await storage.deleteParsingTemplate(req.params.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ message: "Failed to delete parsing template" });
    }
  });

  // ============================================================================
  // APPLY TEMPLATE — run on file
  // ============================================================================

  app.post("/api/mbt/files/:fileId/apply-template", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      let template = req.body.template;
      if (!template && req.body.templateId) {
        const saved = await storage.getParsingTemplate(req.body.templateId);
        if (!saved) return res.status(404).json({ message: "Template not found" });
        template = { columns: saved.columns, mappings: saved.mappings };
      }
      if (!template) return res.status(400).json({ message: "No template provided" });

      const pageFrom: number = Number(req.body.pageFrom) || 1;
      const pageTo:   number = Number(req.body.pageTo)   || 0;

      const { spawn } = await import('child_process');
      const result = await new Promise<any>((resolve, reject) => {
        const proc = spawn('python3', ['python_server/apply_template.py', file.pdfPath || file.filePath]);
        let stdout = '';
        let stderr = '';
        proc.stdin.write(JSON.stringify({ ...template, pageFrom, pageTo }));
        proc.stdin.end();
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code: number) => {
          if (code !== 0) { reject(new Error(`Parser exited ${code}: ${stderr}`)); return; }
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error('Failed to parse output')); }
        });
        proc.on('error', reject);
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Apply template failed" });
    }
  });

  // ============================================================================
  // APPLY TEMPLATE — XLSX export
  // ============================================================================

  app.post("/api/mbt/files/:fileId/apply-template/xlsx", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    const tmpPath = path.join(os.tmpdir(), `parsing_${req.params.fileId}_${Date.now()}.xlsx`);
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      let template = req.body.template;
      const templateName: string = req.body.templateName ?? 'шаблон';
      if (!template && req.body.templateId) {
        const saved = await storage.getParsingTemplate(req.body.templateId);
        if (!saved) return res.status(404).json({ message: "Template not found" });
        template = { columns: saved.columns, mappings: saved.mappings };
      }
      if (!template) return res.status(400).json({ message: "No template provided" });

      const xlsxPageFrom: number = Number(req.body.pageFrom) || 1;
      const xlsxPageTo:   number = Number(req.body.pageTo)   || 0;

      const { spawn } = await import('child_process');
      const extracted = await new Promise<any>((resolve, reject) => {
        const proc = spawn('python3', ['python_server/apply_template.py', file.pdfPath || file.filePath]);
        let stdout = '';
        let stderr = '';
        proc.stdin.write(JSON.stringify({ ...template, pageFrom: xlsxPageFrom, pageTo: xlsxPageTo }));
        proc.stdin.end();
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code: number) => {
          if (code !== 0) { reject(new Error(`Parser: ${stderr}`)); return; }
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error('Failed to parse output')); }
        });
        proc.on('error', reject);
      });

      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'КПД';
      wb.created = new Date();
      const ws = wb.addWorksheet('Результат парсинга');
      const cols: any[] = template.columns ?? [];

      ws.columns = [
        { key: '_num', header: '№', width: 5 },
        ...cols.map((c: any) => ({ key: c.id, header: c.name, width: 22 })),
      ];
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };

      const rows: any[] = extracted.rows ?? [];
      rows.forEach((row: any, i: number) => {
        const xlsxRow: any = { _num: i + 1 };
        cols.forEach((c: any) => {
          const val = row[c.id] ?? '';
          if (c.isNumeric) {
            const num = parseFloat(val.replace(',', '.').replace(/\s/g, ''));
            xlsxRow[c.id] = isNaN(num) ? val : num;
          } else {
            xlsxRow[c.id] = val;
          }
        });
        ws.addRow(xlsxRow);
      });

      const stats = extracted.stats ?? {};
      if (stats.totalAmount) {
        const lastRow = ws.addRow({ _num: 'Итого' });
        const numColIdx = cols.findIndex((c: any) => c.isNumeric);
        if (numColIdx >= 0) {
          const cell = lastRow.getCell(numColIdx + 2);
          cell.value = stats.totalAmount;
          cell.numFmt = '#,##0.00';
        }
        lastRow.font = { bold: true };
      }

      const origName = (file.originalName || file.filename).replace(/\.pdf$/i, '');
      const safeTpl  = templateName.replace(/[/\\:*?"<>|]/g, '_');
      const xlsxFilename = `${origName}(${safeTpl}).xlsx`;

      await wb.xlsx.writeFile(tmpPath);
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(xlsxFilename)}`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      const fs = await import('fs');
      const stream = fs.createReadStream(tmpPath);
      stream.pipe(res);
      stream.on('end', () => { fs.unlink(tmpPath, () => {}); });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "XLSX export failed" });
    }
  });

  // ============================================================================
  // APPLY BBOX TEMPLATE — zone-based ПП/ПО parser
  // ============================================================================

  app.post("/api/mbt/files/:fileId/apply-bbox-template", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      const config = req.body; // { zones, columns, filterPP }
      if (!config?.zones?.length) return res.status(400).json({ message: "No zones provided" });

      const { spawn } = await import('child_process');
      const result = await new Promise<any>((resolve, reject) => {
        const proc = spawn('python3', ['python_server/extract_payments_bbox.py', file.pdfPath || file.filePath]);
        let stdout = '';
        let stderr = '';
        proc.stdin.write(JSON.stringify(config));
        proc.stdin.end();
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code: number) => {
          if (code !== 0) { reject(new Error(`BboxParser exited ${code}: ${stderr}`)); return; }
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error('Failed to parse bbox output')); }
        });
        proc.on('error', reject);
      });

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "Bbox template failed" });
    }
  });

  // ============================================================================
  // APPLY BBOX TEMPLATE — XLSX export
  // ============================================================================

  app.post("/api/mbt/files/:fileId/apply-bbox-template/xlsx", requireAuth, requireModuleAccess("mbt"), async (req, res) => {
    const tmpPath = path.join(os.tmpdir(), `bbox_${req.params.fileId}_${Date.now()}.xlsx`);
    try {
      const file = await storage.getMbtDocumentFile(req.params.fileId);
      if (!file) return res.status(404).json({ message: "File not found" });

      const { config, templateName = 'bbox-шаблон' } = req.body;
      if (!config?.zones?.length) return res.status(400).json({ message: "No zones provided" });

      const { spawn } = await import('child_process');
      const extracted = await new Promise<any>((resolve, reject) => {
        const proc = spawn('python3', ['python_server/extract_payments_bbox.py', file.pdfPath || file.filePath]);
        let stdout = '';
        let stderr = '';
        proc.stdin.write(JSON.stringify(config));
        proc.stdin.end();
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        proc.on('close', (code: number) => {
          if (code !== 0) { reject(new Error(`BboxParser exited ${code}: ${stderr}`)); return; }
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error('Failed to parse output')); }
        });
        proc.on('error', reject);
      });

      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(templateName.slice(0, 31));

      const columns: any[] = config.columns ?? [];
      const headers = ['№', 'Стр.', ...columns.map((c: any) => c.name)];
      ws.addRow(headers);
      ws.getRow(1).font = { bold: true };

      (extracted.rows ?? []).forEach((row: any, i: number) => {
        ws.addRow([i + 1, row._page ?? '', ...columns.map((c: any) => row[c.id] ?? '')]);
      });

      ws.columns.forEach(col => { col.width = 20; });

      await wb.xlsx.writeFile(tmpPath);
      const filename = encodeURIComponent(`bbox_${templateName}_${Date.now()}.xlsx`);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
      const stream = fs.createReadStream(tmpPath);
      stream.pipe(res);
      stream.on('end', () => { fs.unlink(tmpPath, () => {}); });
    } catch (error: any) {
      res.status(500).json({ message: error?.message || "XLSX export failed" });
    }
  });

  registerGiRoutes(app as any);

  const httpServer = createServer(app);
  return httpServer;
}
