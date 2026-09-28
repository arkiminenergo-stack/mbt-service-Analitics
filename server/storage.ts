import { db, pool } from './db';
import { eq, desc, and, inArray, or, isNull, asc } from 'drizzle-orm';
import {
  users, roles, systemConfigs,
  userModulePermissions,
  mbtProjects, mbtDocuments, mbtDocumentFiles, mbtDocumentPages,
  mbtDocumentAnalyses, mbtSections, mbtSectionRules, mbtMarkButtons, mbtFileAnnotations,
  mbtAnalysisTemplates,
  docChecklistTemplates, docChecklistItems, docConclusions,
  docFolders, docFileRelations,
  mbtActivityLog,
  parsingTemplates,
  giProjects, giActFiles, giActFields,
} from '@shared/schema';
import type {
  User, Role, SystemConfig, UserModulePermission, ModuleId,
  InsertMbtProject, MbtProject, InsertMbtDocument, MbtDocument,
  InsertMbtDocumentFile, MbtDocumentFile, InsertMbtDocumentPage, MbtDocumentPage,
  InsertMbtDocumentAnalysis, MbtDocumentAnalysis,
  InsertMbtSection, MbtSection, InsertMbtSectionRule, MbtSectionRule,
  InsertMbtMarkButton, MbtMarkButton, InsertMbtFileAnnotation, MbtFileAnnotation,
  InsertMbtAnalysisTemplate, MbtAnalysisTemplate,
  InsertDocChecklistTemplate, DocChecklistTemplate,
  InsertDocChecklistItem, DocChecklistItem,
  InsertDocConclusion, DocConclusion,
  InsertDocFolder, DocFolder,
  InsertDocFileRelation, DocFileRelation,
  MbtActivityLogEntry, MbtActivityAction,
  InsertParsingTemplate, ParsingTemplate,
  InsertGiProject, GiProject, InsertGiActFile, GiActFile, InsertGiActField, GiActField,
} from '@shared/schema';
import type { OllamaConfig } from './services/llmExtraction';

class DatabaseStorage {
  // ============================================================================
  // USERS & AUTH
  // ============================================================================
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserRole(userId: string): Promise<"admin" | "user" | undefined> {
    const [result] = await db.select({ roleName: roles.name })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .where(eq(users.id, userId));
    return result?.roleName as "admin" | "user" | undefined;
  }

  async getUserModuleAccess(userId: string, moduleId: ModuleId): Promise<boolean> {
    const userRole = await this.getUserRole(userId);
    if (userRole === "admin") return true;
    const [permission] = await db.select()
      .from(userModulePermissions)
      .where(and(
        eq(userModulePermissions.userId, userId),
        eq(userModulePermissions.moduleId, moduleId)
      ));
    return permission?.hasAccess ?? false;
  }

  // ============================================================================
  // SYSTEM CONFIGS (for LLM settings)
  // ============================================================================
  async getConfig(key: string, userId?: string): Promise<SystemConfig | undefined> {
    if (userId) {
      const [userConfig] = await db.select()
        .from(systemConfigs)
        .where(and(eq(systemConfigs.configKey, key), eq(systemConfigs.userId, userId)))
        .limit(1);
      if (userConfig) return userConfig;
    }
    const [globalConfig] = await db.select()
      .from(systemConfigs)
      .where(and(eq(systemConfigs.configKey, key), eq(systemConfigs.isGlobal, true)))
      .limit(1);
    return globalConfig;
  }

  async setConfig(key: string, value: any, userId?: string, isGlobal: boolean = false): Promise<void> {
    const existing = await this.getConfig(key, userId);
    if (existing) {
      await db.update(systemConfigs)
        .set({ configValue: value, updatedAt: new Date() })
        .where(eq(systemConfigs.id, existing.id));
    } else {
      await db.insert(systemConfigs).values({
        configKey: key,
        configValue: value,
        userId: userId || null,
        isGlobal,
        createdBy: userId || null,
      });
    }
  }

  async getOllamaConfig(): Promise<OllamaConfig | null> {
    const config = await this.getConfig('ollama_config');
    return config ? (config.configValue as OllamaConfig) : null;
  }

  async setOllamaConfig(config: OllamaConfig, userId?: string): Promise<void> {
    await this.setConfig('ollama_config', config, userId, !userId);
  }

  // ============================================================================
  // MBT PROJECTS
  // ============================================================================
  async createMbtProject(data: InsertMbtProject): Promise<MbtProject> {
    const [project] = await db.insert(mbtProjects).values(data).returning();
    return project;
  }

  async getMbtProjects(): Promise<MbtProject[]> {
    return db.select().from(mbtProjects).orderBy(desc(mbtProjects.createdAt));
  }

  async getMbtProject(id: string): Promise<MbtProject | undefined> {
    const [project] = await db.select().from(mbtProjects).where(eq(mbtProjects.id, id));
    return project;
  }

  async updateMbtProject(id: string, data: Partial<InsertMbtProject>): Promise<MbtProject> {
    const [updated] = await db.update(mbtProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mbtProjects.id, id))
      .returning();
    return updated;
  }

  async deleteMbtProject(id: string): Promise<void> {
    await db.delete(mbtProjects).where(eq(mbtProjects.id, id));
  }

  // ============================================================================
  // MBT DOCUMENTS
  // ============================================================================
  async createMbtDocument(data: InsertMbtDocument): Promise<MbtDocument> {
    const [doc] = await db.insert(mbtDocuments).values(data).returning();
    return doc;
  }

  async getMbtDocuments(projectId: string): Promise<MbtDocument[]> {
    return db.select().from(mbtDocuments)
      .where(eq(mbtDocuments.projectId, projectId))
      .orderBy(desc(mbtDocuments.uploadedAt));
  }

  async getMbtDocument(id: string): Promise<MbtDocument | undefined> {
    const [doc] = await db.select().from(mbtDocuments).where(eq(mbtDocuments.id, id));
    return doc;
  }

  async updateMbtDocument(id: string, data: Partial<InsertMbtDocument>): Promise<MbtDocument> {
    const [updated] = await db.update(mbtDocuments).set(data).where(eq(mbtDocuments.id, id)).returning();
    return updated;
  }

  async deleteMbtDocument(id: string): Promise<void> {
    await db.delete(mbtDocuments).where(eq(mbtDocuments.id, id));
  }

  // ============================================================================
  // MBT DOCUMENT FILES
  // ============================================================================
  async createMbtDocumentFile(data: InsertMbtDocumentFile): Promise<MbtDocumentFile> {
    const [file] = await db.insert(mbtDocumentFiles).values(data).returning();
    return file;
  }

  async getMbtDocumentFiles(documentId: string): Promise<MbtDocumentFile[]> {
    return db.select().from(mbtDocumentFiles)
      .where(eq(mbtDocumentFiles.documentId, documentId))
      .orderBy(mbtDocumentFiles.filename);
  }

  async getMbtDocumentFile(id: string): Promise<MbtDocumentFile | undefined> {
    const [file] = await db.select().from(mbtDocumentFiles).where(eq(mbtDocumentFiles.id, id));
    return file;
  }

  async updateMbtDocumentFile(id: string, data: Partial<InsertMbtDocumentFile>): Promise<MbtDocumentFile> {
    const [updated] = await db.update(mbtDocumentFiles).set(data).where(eq(mbtDocumentFiles.id, id)).returning();
    return updated;
  }

  async deleteMbtDocumentFile(id: string): Promise<void> {
    await pool.query('DELETE FROM mbt_document_files WHERE id = $1', [id]);
  }

  // ============================================================================
  // MBT DOCUMENT PAGES
  // ============================================================================
  async createMbtDocumentPages(pages: InsertMbtDocumentPage[]): Promise<void> {
    if (pages.length === 0) return;
    await db.insert(mbtDocumentPages).values(pages);
  }

  async getMbtDocumentPages(fileId: string): Promise<MbtDocumentPage[]> {
    return db.select().from(mbtDocumentPages)
      .where(eq(mbtDocumentPages.fileId, fileId))
      .orderBy(mbtDocumentPages.pageNumber);
  }

  async updateMbtDocumentPage(id: string, data: { findingsCache?: any; analysisHash?: string }): Promise<void> {
    await db.update(mbtDocumentPages).set(data).where(eq(mbtDocumentPages.id, id));
  }

  async deleteMbtDocumentPages(fileId: string): Promise<void> {
    await db.delete(mbtDocumentPages).where(eq(mbtDocumentPages.fileId, fileId));
  }

  // ============================================================================
  // MBT DOCUMENT ANALYSES
  // ============================================================================
  async createMbtDocumentAnalysis(data: InsertMbtDocumentAnalysis): Promise<MbtDocumentAnalysis> {
    const [analysis] = await db.insert(mbtDocumentAnalyses).values(data).returning();
    return analysis;
  }

  async getMbtDocumentAnalysis(id: string): Promise<MbtDocumentAnalysis | undefined> {
    const [analysis] = await db.select().from(mbtDocumentAnalyses).where(eq(mbtDocumentAnalyses.id, id));
    return analysis;
  }

  async getLatestMbtAnalysis(fileId: string): Promise<MbtDocumentAnalysis | undefined> {
    const [analysis] = await db.select().from(mbtDocumentAnalyses)
      .where(eq(mbtDocumentAnalyses.fileId, fileId))
      .orderBy(desc(mbtDocumentAnalyses.startedAt))
      .limit(1);
    return analysis;
  }

  async updateMbtDocumentAnalysis(id: string, data: Partial<InsertMbtDocumentAnalysis & { completedAt?: Date }>): Promise<MbtDocumentAnalysis> {
    const [updated] = await db.update(mbtDocumentAnalyses).set(data).where(eq(mbtDocumentAnalyses.id, id)).returning();
    return updated;
  }

  // ============================================================================
  // MBT SECTIONS
  // ============================================================================
  async getMbtSections(projectId: string): Promise<(MbtSection & { rules: MbtSectionRule[] })[]> {
    const sections = await db.select().from(mbtSections)
      .where(eq(mbtSections.projectId, projectId))
      .orderBy(mbtSections.order, mbtSections.createdAt);
    const rules = await db.select().from(mbtSectionRules)
      .where(inArray(mbtSectionRules.sectionId, sections.length > 0 ? sections.map(s => s.id) : ['__none__']));
    return sections.map(s => ({ ...s, rules: rules.filter(r => r.sectionId === s.id) }));
  }

  async createMbtSection(data: InsertMbtSection): Promise<MbtSection> {
    const [section] = await db.insert(mbtSections).values(data).returning();
    return section;
  }

  async updateMbtSection(id: string, data: Partial<Pick<MbtSection, 'name' | 'order'>>): Promise<MbtSection> {
    const [updated] = await db.update(mbtSections).set(data).where(eq(mbtSections.id, id)).returning();
    return updated;
  }

  async deleteMbtSection(id: string): Promise<void> {
    await db.delete(mbtSections).where(eq(mbtSections.id, id));
  }

  async createMbtSectionRule(data: InsertMbtSectionRule): Promise<MbtSectionRule> {
    const [rule] = await db.insert(mbtSectionRules).values(data).returning();
    return rule;
  }

  async updateMbtSectionRule(id: string, value: string): Promise<MbtSectionRule> {
    const [updated] = await db.update(mbtSectionRules).set({ value }).where(eq(mbtSectionRules.id, id)).returning();
    return updated;
  }

  async deleteMbtSectionRule(id: string): Promise<void> {
    await db.delete(mbtSectionRules).where(eq(mbtSectionRules.id, id));
  }

  async updateMbtFileSection(fileId: string, sectionId: string | null): Promise<MbtDocumentFile> {
    const [updated] = await db.update(mbtDocumentFiles)
      .set({ sectionId })
      .where(eq(mbtDocumentFiles.id, fileId))
      .returning();
    return updated;
  }

  async routeMbtDocumentFiles(documentId: string, projectId: string): Promise<number> {
    const sections = await this.getMbtSections(projectId);
    const allFiles = await this.getMbtDocumentFiles(documentId);
    // Only route files that are currently in "Нераспределённые" (sectionId IS NULL)
    const files = allFiles.filter(f => f.sectionId == null);
    let routed = 0;
    for (const file of files) {
      let matched: string | null = null;
      outer: for (const section of sections) {
        for (const rule of section.rules) {
          if (rule.type === 'filename') {
            const patterns = rule.value.split(/[\n,]+/).map(p => p.trim().toLowerCase()).filter(Boolean);
            const fname = file.filename.toLowerCase();
            if (patterns.some(p => fname.includes(p))) { matched = section.id; break outer; }
          } else if (rule.type === 'has_artifact') {
            if (file.analysisStatus === 'completed') {
              const keywords = rule.value && rule.value !== 'true'
                ? rule.value.split(/[\n,]+/).map(k => k.trim().toLowerCase()).filter(Boolean)
                : [];
              if (keywords.length === 0) { matched = section.id; break outer; }
              const analysis = await this.getLatestMbtAnalysis(file.id);
              if (analysis && Array.isArray(analysis.findings) && analysis.findings.length > 0) {
                const findingText = (analysis.findings as Array<{ description?: string; textFragment?: string }>)
                  .map(f => `${f.description || ''} ${f.textFragment || ''}`.toLowerCase())
                  .join(' ');
                if (keywords.some(kw => findingText.includes(kw))) { matched = section.id; break outer; }
              }
            }
          }
        }
      }
      if (matched !== file.sectionId) {
        await this.updateMbtFileSection(file.id, matched);
        routed++;
      }
    }
    return routed;
  }

  async approveMbtFile(fileId: string, approved: boolean, userId: string): Promise<MbtDocumentFile> {
    const [updated] = await db.update(mbtDocumentFiles)
      .set({ isApproved: approved })
      .where(eq(mbtDocumentFiles.id, fileId))
      .returning();
    await db.insert(mbtFileAnnotations).values({
      fileId,
      type: approved ? 'approve' : 'unapprove',
      createdBy: userId,
    });
    return updated;
  }

  // ============================================================================
  // MBT MARK BUTTONS
  // ============================================================================
  async getMbtMarkButtons(projectId: string, sectionId?: string | null): Promise<MbtMarkButton[]> {
    if (sectionId) {
      return db.select().from(mbtMarkButtons)
        .where(and(
          eq(mbtMarkButtons.projectId, projectId),
          or(isNull(mbtMarkButtons.sectionId), eq(mbtMarkButtons.sectionId, sectionId))
        ))
        .orderBy(mbtMarkButtons.order);
    }
    return db.select().from(mbtMarkButtons)
      .where(eq(mbtMarkButtons.projectId, projectId))
      .orderBy(mbtMarkButtons.order);
  }

  async createMbtMarkButton(data: InsertMbtMarkButton): Promise<MbtMarkButton> {
    const [btn] = await db.insert(mbtMarkButtons).values(data).returning();
    return btn;
  }

  async updateMbtMarkButton(id: string, data: Partial<Pick<MbtMarkButton, 'label' | 'order'>>): Promise<MbtMarkButton> {
    const [updated] = await db.update(mbtMarkButtons).set(data).where(eq(mbtMarkButtons.id, id)).returning();
    return updated;
  }

  async deleteMbtMarkButton(id: string): Promise<void> {
    await db.delete(mbtMarkButtons).where(eq(mbtMarkButtons.id, id));
  }

  // ============================================================================
  // MBT FILE ANNOTATIONS
  // ============================================================================
  async getMbtFileAnnotations(fileId: string): Promise<MbtFileAnnotation[]> {
    return db.select().from(mbtFileAnnotations)
      .where(eq(mbtFileAnnotations.fileId, fileId))
      .orderBy(mbtFileAnnotations.createdAt);
  }

  async createMbtFileAnnotation(data: InsertMbtFileAnnotation): Promise<MbtFileAnnotation> {
    const [ann] = await db.insert(mbtFileAnnotations).values(data).returning();
    return ann;
  }

  async deleteMbtFileAnnotation(id: string): Promise<void> {
    await db.delete(mbtFileAnnotations).where(eq(mbtFileAnnotations.id, id));
  }

  async getMbtReportData(params: {
    projectId: string;
    documentId?: string;
    sectionId?: string;
    fileId?: string;
  }): Promise<{
    project: { id: string; name: string };
    sections: { id: string; name: string }[];
    markButtonLabels: Record<string, string>;
    rows: Array<{
      fileId: string;
      filename: string;
      documentName: string;
      sectionId: string | null;
      sectionName: string | null;
      isApproved: boolean;
      sealCount: number;
      signatureCount: number;
      dateCount: number;
      analysisStatus: string;
      marks: Array<{ key: string; label: string; page: number | null; createdAt: string }>;
    }>;
  }> {
    const { projectId, documentId, sectionId, fileId } = params;

    const [project] = await db.select({ id: mbtProjects.id, name: mbtProjects.name })
      .from(mbtProjects).where(eq(mbtProjects.id, projectId));
    if (!project) throw new Error('Project not found');

    const sections = await db.select({ id: mbtSections.id, name: mbtSections.name, order: mbtSections.order })
      .from(mbtSections).where(eq(mbtSections.projectId, projectId)).orderBy(mbtSections.order);

    const buttons = await db.select({ key: mbtMarkButtons.key, label: mbtMarkButtons.label })
      .from(mbtMarkButtons).where(eq(mbtMarkButtons.projectId, projectId));
    const markButtonLabels: Record<string, string> = {};
    for (const b of buttons) markButtonLabels[b.key] = b.label;

    const allDocs = await db.select({ id: mbtDocuments.id, name: mbtDocuments.originalName })
      .from(mbtDocuments).where(eq(mbtDocuments.projectId, projectId));
    const filteredDocs = documentId ? allDocs.filter(d => d.id === documentId) : allDocs;
    if (filteredDocs.length === 0) return { project, sections, markButtonLabels, rows: [] };

    const docIds = filteredDocs.map(d => d.id);
    const docNameById: Record<string, string> = {};
    for (const d of filteredDocs) docNameById[d.id] = d.name;

    const filesConditions: any[] = [inArray(mbtDocumentFiles.documentId, docIds)];
    if (sectionId) filesConditions.push(eq(mbtDocumentFiles.sectionId, sectionId));
    if (fileId) filesConditions.push(eq(mbtDocumentFiles.id, fileId));
    const files = await db.select().from(mbtDocumentFiles).where(and(...filesConditions));
    if (files.length === 0) return { project, sections, markButtonLabels, rows: [] };

    const fileIds = files.map(f => f.id);

    const allAnalyses = await db.select().from(mbtDocumentAnalyses)
      .where(inArray(mbtDocumentAnalyses.fileId, fileIds))
      .orderBy(desc(mbtDocumentAnalyses.startedAt));
    const latestAnalysis: Record<string, typeof allAnalyses[0]> = {};
    for (const a of allAnalyses) {
      if (!latestAnalysis[a.fileId]) latestAnalysis[a.fileId] = a;
    }

    const allAnnotations = await db.select().from(mbtFileAnnotations)
      .where(and(inArray(mbtFileAnnotations.fileId, fileIds), eq(mbtFileAnnotations.type, 'mark')))
      .orderBy(mbtFileAnnotations.createdAt);
    const annotsByFile: Record<string, typeof allAnnotations> = {};
    for (const a of allAnnotations) {
      if (!annotsByFile[a.fileId]) annotsByFile[a.fileId] = [];
      annotsByFile[a.fileId].push(a);
    }

    const sectionNameById: Record<string, string> = {};
    for (const s of sections) sectionNameById[s.id] = s.name;
    const sectionOrder: Record<string, number> = {};
    for (const s of sections) sectionOrder[s.id] = s.order;

    const rows = files
      .sort((a, b) => {
        const oa = a.sectionId ? (sectionOrder[a.sectionId] ?? 999) : 1000;
        const ob = b.sectionId ? (sectionOrder[b.sectionId] ?? 999) : 1000;
        if (oa !== ob) return oa - ob;
        return a.filename.localeCompare(b.filename, 'ru');
      })
      .map(file => {
        const analysis = latestAnalysis[file.id];
        const findings = (analysis?.status === 'completed' ? analysis.findings : null) ?? [];
        const sealCount = findings.filter((f: any) => f.type === 'seal').length;
        const signatureCount = findings.filter((f: any) => f.type === 'signature').length;
        const dateCount = findings.filter((f: any) => f.type === 'date').length;
        const marks = (annotsByFile[file.id] ?? []).map(a => ({
          key: a.buttonKey ?? '',
          label: markButtonLabels[a.buttonKey ?? ''] ?? a.buttonKey ?? '',
          page: a.page ?? null,
          createdAt: a.createdAt.toISOString(),
        }));
        return {
          fileId: file.id,
          filename: file.filename,
          documentName: docNameById[file.documentId] ?? '',
          sectionId: file.sectionId ?? null,
          sectionName: file.sectionId ? (sectionNameById[file.sectionId] ?? null) : null,
          isApproved: file.isApproved,
          sealCount,
          signatureCount,
          dateCount,
          analysisStatus: analysis?.status ?? 'none',
          marks,
        };
      });

    return { project, sections, markButtonLabels, rows };
  }

  // ============================================================================
  // MBT ANALYSIS TEMPLATES
  // ============================================================================

  async getAnalysisTemplates(projectId?: string): Promise<MbtAnalysisTemplate[]> {
    if (projectId) {
      return db.select().from(mbtAnalysisTemplates)
        .where(or(isNull(mbtAnalysisTemplates.projectId), eq(mbtAnalysisTemplates.projectId, projectId)))
        .orderBy(desc(mbtAnalysisTemplates.isDefault), mbtAnalysisTemplates.createdAt);
    }
    return db.select().from(mbtAnalysisTemplates)
      .where(isNull(mbtAnalysisTemplates.projectId))
      .orderBy(desc(mbtAnalysisTemplates.isDefault), mbtAnalysisTemplates.createdAt);
  }

  async getAnalysisTemplate(id: string): Promise<MbtAnalysisTemplate | undefined> {
    const [t] = await db.select().from(mbtAnalysisTemplates).where(eq(mbtAnalysisTemplates.id, id));
    return t;
  }

  async createAnalysisTemplate(data: InsertMbtAnalysisTemplate): Promise<MbtAnalysisTemplate> {
    const [t] = await db.insert(mbtAnalysisTemplates).values(data).returning();
    return t;
  }

  async updateAnalysisTemplate(id: string, data: Partial<InsertMbtAnalysisTemplate>): Promise<MbtAnalysisTemplate> {
    const [t] = await db.update(mbtAnalysisTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mbtAnalysisTemplates.id, id))
      .returning();
    return t;
  }

  async deleteAnalysisTemplate(id: string): Promise<void> {
    await db.delete(mbtAnalysisTemplates).where(eq(mbtAnalysisTemplates.id, id));
  }

  // ============================================================================
  // CHECKLIST TEMPLATES
  // ============================================================================
  async getChecklistTemplates(): Promise<DocChecklistTemplate[]> {
    return db.select().from(docChecklistTemplates).orderBy(docChecklistTemplates.createdAt);
  }

  async getChecklistTemplate(id: string): Promise<DocChecklistTemplate | undefined> {
    const [t] = await db.select().from(docChecklistTemplates).where(eq(docChecklistTemplates.id, id));
    return t;
  }

  async getChecklistTemplateWithItems(id: string): Promise<{ template: DocChecklistTemplate; items: DocChecklistItem[] } | undefined> {
    const [template] = await db.select().from(docChecklistTemplates).where(eq(docChecklistTemplates.id, id));
    if (!template) return undefined;
    const items = await db.select().from(docChecklistItems)
      .where(eq(docChecklistItems.templateId, id))
      .orderBy(docChecklistItems.order);
    return { template, items };
  }

  async createChecklistTemplate(data: InsertDocChecklistTemplate): Promise<DocChecklistTemplate> {
    const [t] = await db.insert(docChecklistTemplates).values(data).returning();
    return t;
  }

  async updateChecklistTemplate(id: string, data: Partial<InsertDocChecklistTemplate>): Promise<DocChecklistTemplate> {
    const [t] = await db.update(docChecklistTemplates).set(data).where(eq(docChecklistTemplates.id, id)).returning();
    return t;
  }

  async deleteChecklistTemplate(id: string): Promise<void> {
    await db.delete(docChecklistTemplates).where(eq(docChecklistTemplates.id, id));
  }

  // ============================================================================
  // CHECKLIST ITEMS
  // ============================================================================
  async getChecklistItems(templateId: string): Promise<DocChecklistItem[]> {
    return db.select().from(docChecklistItems)
      .where(eq(docChecklistItems.templateId, templateId))
      .orderBy(docChecklistItems.order);
  }

  async createChecklistItem(data: InsertDocChecklistItem): Promise<DocChecklistItem> {
    const [item] = await db.insert(docChecklistItems).values(data).returning();
    return item;
  }

  async updateChecklistItem(id: string, data: Partial<InsertDocChecklistItem>): Promise<DocChecklistItem> {
    const [item] = await db.update(docChecklistItems).set(data).where(eq(docChecklistItems.id, id)).returning();
    return item;
  }

  async deleteChecklistItem(id: string): Promise<void> {
    await db.delete(docChecklistItems).where(eq(docChecklistItems.id, id));
  }

  // ============================================================================
  // ANALYTICS
  // ============================================================================
  async getMbtAnalytics(): Promise<{
    totalProjects: number;
    totalConclusions: number;
    projectsChecked: number;
    avgCompleteness: number;
    verifiedCount: number;
    byStatus: Record<string, number>;
    projectStats: Array<{
      projectId: string;
      projectName: string;
      district: string | null;
      latestStatus: string | null;
      latestFinalStatus: string | null;
      completenessScore: number | null;
      criticalIssues: number | null;
      nonCriticalIssues: number | null;
      isReviewed: boolean;
      checkedAt: Date | null;
    }>;
    missingItems: Array<{ itemName: string; missingCount: number }>;
    recentConclusions: Array<{
      projectId: string;
      projectName: string;
      status: string;
      finalStatus: string | null;
      completenessScore: number | null;
      isReviewed: boolean;
      createdAt: Date;
    }>;
  }> {
    const allProjects = await db.select().from(mbtProjects);
    const allConclusions = await db.select().from(docConclusions).orderBy(desc(docConclusions.createdAt));

    const totalProjects = allProjects.length;
    const totalConclusions = allConclusions.length;

    // Latest conclusion per project
    const latestByProject = new Map<string, typeof allConclusions[0]>();
    for (const c of allConclusions) {
      if (!latestByProject.has(c.projectId)) latestByProject.set(c.projectId, c);
    }

    const projectsChecked = latestByProject.size;
    const verifiedCount = [...latestByProject.values()].filter(c => c.isReviewed).length;

    const scoresArr = [...latestByProject.values()].map(c => c.completenessScore ?? 0).filter(s => s > 0);
    const avgCompleteness = scoresArr.length > 0
      ? Math.round(scoresArr.reduce((a, b) => a + b, 0) / scoresArr.length)
      : 0;

    const byStatus: Record<string, number> = {};
    for (const c of latestByProject.values()) {
      const st = c.finalStatus ?? c.status;
      byStatus[st] = (byStatus[st] ?? 0) + 1;
    }

    const projectStats = allProjects.map(p => {
      const c = latestByProject.get(p.id);
      return {
        projectId: p.id,
        projectName: p.name,
        district: p.district,
        latestStatus: c ? c.status : null,
        latestFinalStatus: c ? c.finalStatus : null,
        completenessScore: c ? c.completenessScore : null,
        criticalIssues: c ? c.criticalIssues : null,
        nonCriticalIssues: c ? c.nonCriticalIssues : null,
        isReviewed: c ? c.isReviewed : false,
        checkedAt: c ? c.createdAt : null,
      };
    }).sort((a, b) => {
      if (a.criticalIssues !== null && b.criticalIssues !== null) return b.criticalIssues - a.criticalIssues;
      if (a.criticalIssues !== null) return -1;
      if (b.criticalIssues !== null) return 1;
      return 0;
    });

    // Most commonly missing required items across all latest conclusions
    const missingMap = new Map<string, number>();
    for (const c of latestByProject.values()) {
      const result = (c.completenessResult ?? []) as Array<{ itemName: string; status: string; isRequired: boolean }>;
      const overrides = (c.manualOverrides ?? []) as Array<{ itemId: string; status: string }>;
      for (const item of result) {
        const ov = overrides.find((o: any) => o.itemId === (item as any).itemId);
        const effectiveStatus = ov?.status ?? item.status;
        if (effectiveStatus === 'missing') {
          missingMap.set(item.itemName, (missingMap.get(item.itemName) ?? 0) + 1);
        }
      }
    }
    const missingItems = [...missingMap.entries()]
      .map(([itemName, missingCount]) => ({ itemName, missingCount }))
      .sort((a, b) => b.missingCount - a.missingCount)
      .slice(0, 10);

    // Recent conclusions (last 20)
    const projectNameMap = new Map(allProjects.map(p => [p.id, p.name]));
    const recentConclusions = allConclusions.slice(0, 20).map(c => ({
      projectId: c.projectId,
      projectName: projectNameMap.get(c.projectId) ?? '—',
      status: c.status,
      finalStatus: c.finalStatus,
      completenessScore: c.completenessScore,
      isReviewed: c.isReviewed,
      createdAt: c.createdAt,
    }));

    return { totalProjects, totalConclusions, projectsChecked, avgCompleteness, verifiedCount, byStatus, projectStats, missingItems, recentConclusions };
  }

  // ============================================================================
  // CONCLUSIONS
  // ============================================================================
  async getLatestConclusion(projectId: string): Promise<DocConclusion | undefined> {
    const [c] = await db.select().from(docConclusions)
      .where(eq(docConclusions.projectId, projectId))
      .orderBy(desc(docConclusions.createdAt))
      .limit(1);
    return c;
  }

  async getConclusionHistory(projectId: string): Promise<DocConclusion[]> {
    return db.select().from(docConclusions)
      .where(eq(docConclusions.projectId, projectId))
      .orderBy(desc(docConclusions.createdAt));
  }

  async getConclusion(id: string): Promise<DocConclusion | undefined> {
    const [c] = await db.select().from(docConclusions).where(eq(docConclusions.id, id));
    return c;
  }

  async createConclusion(data: InsertDocConclusion): Promise<DocConclusion> {
    const [c] = await db.insert(docConclusions).values(data).returning();
    return c;
  }

  async updateConclusion(id: string, data: Partial<{
    manualOverrides: any;
    reviewerNote: string | null;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    finalStatus: string | null;
    isReviewed: boolean;
  }>): Promise<DocConclusion> {
    const [c] = await db.update(docConclusions).set(data).where(eq(docConclusions.id, id)).returning();
    return c;
  }

  // ============================================================================
  // DOC FOLDERS
  // ============================================================================
  async getFolders(projectId: string): Promise<DocFolder[]> {
    return db.select().from(docFolders)
      .where(eq(docFolders.projectId, projectId))
      .orderBy(asc(docFolders.order), asc(docFolders.name));
  }

  async createFolder(data: InsertDocFolder): Promise<DocFolder> {
    const [f] = await db.insert(docFolders).values(data).returning();
    return f;
  }

  async updateFolder(id: string, data: Partial<Pick<DocFolder, 'name' | 'parentId' | 'color' | 'order'>>): Promise<DocFolder> {
    const [f] = await db.update(docFolders).set(data).where(eq(docFolders.id, id)).returning();
    return f;
  }

  async deleteFolder(id: string): Promise<void> {
    // Unassign files from this folder before deleting
    await db.update(mbtDocumentFiles).set({ folderId: null }).where(eq(mbtDocumentFiles.folderId, id));
    // Reparent child folders to grandparent
    const [folder] = await db.select().from(docFolders).where(eq(docFolders.id, id));
    if (folder) {
      await db.update(docFolders).set({ parentId: folder.parentId ?? null })
        .where(eq(docFolders.parentId, id));
    }
    await db.delete(docFolders).where(eq(docFolders.id, id));
  }

  async assignFileToFolder(fileId: string, folderId: string | null): Promise<void> {
    await db.update(mbtDocumentFiles).set({ folderId }).where(eq(mbtDocumentFiles.id, fileId));
  }

  // ============================================================================
  // DOC FILE RELATIONS
  // ============================================================================
  async getFileRelations(fileId: string): Promise<(DocFileRelation & { relatedFileName: string })[]> {
    const rows = await db.select({
      id: docFileRelations.id,
      fileId: docFileRelations.fileId,
      relatedFileId: docFileRelations.relatedFileId,
      relationType: docFileRelations.relationType,
      note: docFileRelations.note,
      createdAt: docFileRelations.createdAt,
      createdBy: docFileRelations.createdBy,
      relatedFileName: mbtDocumentFiles.filename,
    })
      .from(docFileRelations)
      .innerJoin(mbtDocumentFiles, eq(docFileRelations.relatedFileId, mbtDocumentFiles.id))
      .where(eq(docFileRelations.fileId, fileId))
      .orderBy(desc(docFileRelations.createdAt));
    return rows;
  }

  async createFileRelation(data: InsertDocFileRelation): Promise<DocFileRelation> {
    const [r] = await db.insert(docFileRelations).values(data).returning();
    return r;
  }

  async deleteFileRelation(id: string): Promise<void> {
    await db.delete(docFileRelations).where(eq(docFileRelations.id, id));
  }

  // ============================================================================
  // MBT FILE MARKS (toggle)
  // ============================================================================
  async toggleMbtFileMark(fileId: string, buttonKey: string, userId: string, page: number): Promise<{ added: boolean; annotation: MbtFileAnnotation | null }> {
    const existing = await db.select().from(mbtFileAnnotations)
      .where(and(
        eq(mbtFileAnnotations.fileId, fileId),
        eq(mbtFileAnnotations.type, 'mark'),
        eq(mbtFileAnnotations.buttonKey, buttonKey),
        eq(mbtFileAnnotations.page, page)
      ))
      .limit(1);
    if (existing.length > 0) {
      await db.delete(mbtFileAnnotations).where(eq(mbtFileAnnotations.id, existing[0].id));
      return { added: false, annotation: null };
    }
    const [ann] = await db.insert(mbtFileAnnotations).values({
      fileId, type: 'mark', buttonKey, page, createdBy: userId,
    }).returning();
    return { added: true, annotation: ann };
  }

  // ============================================================================
  // ACTIVITY LOG
  // ============================================================================
  async logActivity(data: {
    projectId: string;
    userId?: string | null;
    action: MbtActivityAction;
    entityType?: string;
    entityId?: string;
    entityLabel?: string;
    meta?: Record<string, any>;
  }): Promise<void> {
    try {
      await db.insert(mbtActivityLog).values({
        projectId: data.projectId,
        userId: data.userId ?? null,
        action: data.action,
        entityType: data.entityType ?? null,
        entityId: data.entityId ?? null,
        entityLabel: data.entityLabel ?? null,
        meta: data.meta ?? null,
      } as any);
    } catch (e) {
      console.error('logActivity failed:', e);
    }
  }

  async getActivityLog(projectId: string, limit = 100): Promise<(MbtActivityLogEntry & { userEmail?: string | null })[]> {
    const rows = await db
      .select({
        id: mbtActivityLog.id,
        projectId: mbtActivityLog.projectId,
        userId: mbtActivityLog.userId,
        action: mbtActivityLog.action,
        entityType: mbtActivityLog.entityType,
        entityId: mbtActivityLog.entityId,
        entityLabel: mbtActivityLog.entityLabel,
        meta: mbtActivityLog.meta,
        createdAt: mbtActivityLog.createdAt,
        userEmail: users.email,
      })
      .from(mbtActivityLog)
      .leftJoin(users, eq(mbtActivityLog.userId, users.id))
      .where(eq(mbtActivityLog.projectId, projectId))
      .orderBy(desc(mbtActivityLog.createdAt))
      .limit(limit);
    return rows;
  }
  // ============================================================================
  // PARSING TEMPLATES
  // ============================================================================

  async getParsingTemplates(projectId: string): Promise<ParsingTemplate[]> {
    return db.select().from(parsingTemplates)
      .where(eq(parsingTemplates.projectId, projectId))
      .orderBy(desc(parsingTemplates.createdAt));
  }

  async getParsingTemplate(id: string): Promise<ParsingTemplate | undefined> {
    const [t] = await db.select().from(parsingTemplates).where(eq(parsingTemplates.id, id));
    return t;
  }

  async createParsingTemplate(data: InsertParsingTemplate): Promise<ParsingTemplate> {
    const [t] = await db.insert(parsingTemplates).values(data).returning();
    return t;
  }

  async updateParsingTemplate(id: string, data: Partial<InsertParsingTemplate>): Promise<ParsingTemplate | undefined> {
    const [t] = await db.update(parsingTemplates)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(parsingTemplates.id, id))
      .returning();
    return t;
  }

  async deleteParsingTemplate(id: string): Promise<void> {
    await db.delete(parsingTemplates).where(eq(parsingTemplates.id, id));
  }

  // ============================================================================
  // GI ACTS MODULE
  // ============================================================================

  async getGiProjects(userId: string): Promise<GiProject[]> {
    return db.select().from(giProjects)
      .where(eq(giProjects.userId, userId))
      .orderBy(desc(giProjects.createdAt));
  }

  async getGiProject(id: string): Promise<GiProject | undefined> {
    const [p] = await db.select().from(giProjects).where(eq(giProjects.id, id));
    return p;
  }

  async createGiProject(data: InsertGiProject): Promise<GiProject> {
    const [p] = await db.insert(giProjects).values(data).returning();
    return p;
  }

  async updateGiProject(id: string, data: Partial<InsertGiProject>): Promise<GiProject | undefined> {
    const [p] = await db.update(giProjects)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(giProjects.id, id))
      .returning();
    return p;
  }

  async deleteGiProject(id: string): Promise<void> {
    await db.delete(giProjects).where(eq(giProjects.id, id));
  }

  async getGiActFiles(projectId: string): Promise<GiActFile[]> {
    return db.select().from(giActFiles)
      .where(eq(giActFiles.projectId, projectId))
      .orderBy(desc(giActFiles.createdAt));
  }

  async getGiActFile(id: string): Promise<GiActFile | undefined> {
    const [f] = await db.select().from(giActFiles).where(eq(giActFiles.id, id));
    return f;
  }

  async createGiActFile(data: InsertGiActFile): Promise<GiActFile> {
    const [f] = await db.insert(giActFiles).values(data).returning();
    return f;
  }

  async updateGiActFile(id: string, data: Partial<InsertGiActFile>): Promise<GiActFile | undefined> {
    const [f] = await db.update(giActFiles)
      .set(data)
      .where(eq(giActFiles.id, id))
      .returning();
    return f;
  }

  async deleteGiActFile(id: string): Promise<void> {
    await db.delete(giActFiles).where(eq(giActFiles.id, id));
  }

  async getGiActFields(fileId: string): Promise<GiActField[]> {
    return db.select().from(giActFields)
      .where(eq(giActFields.fileId, fileId))
      .orderBy(asc(giActFields.fieldKey));
  }

  async getGiActField(id: string): Promise<GiActField | undefined> {
    const [f] = await db.select().from(giActFields).where(eq(giActFields.id, id));
    return f;
  }

  async upsertGiActFields(fileId: string, fields: Array<{
    fieldKey: string; fieldValue?: string | null;
    confidence?: string | null; rawOcrText?: string | null;
  }>): Promise<GiActField[]> {
    await db.delete(giActFields).where(eq(giActFields.fileId, fileId));
    if (fields.length === 0) return [];
    return db.insert(giActFields).values(
      fields.map(f => ({ ...f, fileId }))
    ).returning();
  }

  async updateGiActField(id: string, data: {
    fieldValue?: string; isVerified?: boolean; verifiedBy?: string;
  }): Promise<GiActField | undefined> {
    const [f] = await db.update(giActFields)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(giActFields.id, id))
      .returning();
    return f;
  }
}

export const storage = new DatabaseStorage();
