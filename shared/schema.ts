import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================================
// ROLES TABLE
// ============================================================================
export const roles = pgTable("roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique().$type<"admin" | "user">(),
  permissions: jsonb("permissions").$type<string[]>().default(sql`'[]'::jsonb`),
  description: text("description"),
});

export const insertRoleSchema = createInsertSchema(roles).omit({ id: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof roles.$inferSelect;

// ============================================================================
// LEGAL ENTITIES TABLE
// ============================================================================
export const LEGAL_ENTITY_TYPES = ['holding', 'subsidiary'] as const;
export type LegalEntityType = typeof LEGAL_ENTITY_TYPES[number];

export const legalEntities = pgTable("legal_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  shortName: text("short_name"),
  inn: text("inn"),
  type: text("type").notNull().$type<LegalEntityType>(),
  parentId: varchar("parent_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
}, (table) => ({
  parentIdIdx: index("legal_entities_parent_id_idx").on(table.parentId),
  typeIdx: index("legal_entities_type_idx").on(table.type),
}));

export const insertLegalEntitySchema = createInsertSchema(legalEntities).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLegalEntity = z.infer<typeof insertLegalEntitySchema>;
export type LegalEntity = typeof legalEntities.$inferSelect;

// ============================================================================
// USERS TABLE
// ============================================================================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  roleId: varchar("role_id").notNull().references(() => roles.id),
  gptConsentAccepted: boolean("gpt_consent_accepted").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
  isActive: boolean("is_active").notNull().default(true),
  isMemo: boolean("is_memo").notNull().default(false),
  isCss: boolean("is_css").notNull().default(false),
  position: text("position"),
  phone: text("phone"),
  mobilePhone: text("mobile_phone"),
  dismissedAt: timestamp("dismissed_at"),
  avatarUrl: text("avatar_url"),
  legalEntityId: varchar("legal_entity_id").references(() => legalEntities.id, { onDelete: 'set null' }),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
});

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
  lastLoginAt: true,
}).extend({
  metadata: z.record(z.any()).optional(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ============================================================================
// EXPRESS SESSIONS TABLE
// ============================================================================
export const sessions = pgTable("sessions", {
  sid: varchar("sid").primaryKey(),
  sess: jsonb("sess").notNull(),
  expire: timestamp("expire").notNull(),
}, (table) => ({
  expireIdx: index("sessions_expire_idx").on(table.expire),
}));

// ============================================================================
// USER SESSIONS TABLE
// ============================================================================
export const userSessions = pgTable("user_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text("token").notNull().unique(),
  refreshToken: text("refresh_token").unique(),
  expiresAt: timestamp("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("user_sessions_user_id_idx").on(table.userId),
  expiresAtIdx: index("user_sessions_expires_at_idx").on(table.expiresAt),
}));

export const insertUserSessionSchema = createInsertSchema(userSessions).omit({ id: true, createdAt: true });
export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;

// ============================================================================
// SYSTEM CONFIGS TABLE (for Ollama/LLM settings)
// ============================================================================
export const systemConfigs = pgTable("system_configs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }),
  configKey: text("config_key").notNull(),
  configValue: jsonb("config_value").notNull(),
  isGlobal: boolean("is_global").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
}, (table) => ({
  userIdIdx: index("system_configs_user_id_idx").on(table.userId),
  configKeyIdx: index("system_configs_config_key_idx").on(table.configKey),
}));

export const insertSystemConfigSchema = createInsertSchema(systemConfigs).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSystemConfig = z.infer<typeof insertSystemConfigSchema>;
export type SystemConfig = typeof systemConfigs.$inferSelect;

// ============================================================================
// MODULE PERMISSIONS
// ============================================================================
export const MODULE_IDS = {
  MBT: 'mbt',
} as const;

export type ModuleId = typeof MODULE_IDS[keyof typeof MODULE_IDS];

export const userModulePermissions = pgTable("user_module_permissions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  moduleId: text("module_id").notNull(),
  hasAccess: boolean("has_access").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  grantedBy: varchar("granted_by").references(() => users.id, { onDelete: 'set null' }),
  metadata: jsonb("metadata").$type<Record<string, any>>().default(sql`'{}'::jsonb`),
}, (table) => ({
  userIdIdx: index("user_module_permissions_user_id_idx").on(table.userId),
  moduleIdIdx: index("user_module_permissions_module_id_idx").on(table.moduleId),
  userModuleIdx: index("user_module_permissions_user_module_idx").on(table.userId, table.moduleId),
}));

export const insertUserModulePermissionSchema = createInsertSchema(userModulePermissions).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUserModulePermission = z.infer<typeof insertUserModulePermissionSchema>;
export type UserModulePermission = typeof userModulePermissions.$inferSelect;

// ============================================================================
// MBT (МЕЖБЮДЖЕТНЫЕ ТРАНСФЕРТЫ) PROJECTS
// ============================================================================

export const MBT_FINANCING_METHODS = ['imbt', 'subsidy'] as const;
export const MBT_ACTIVITIES = ['1', '2', '3'] as const;
export const MBT_STATUSES = ['verified', 'sent_to_mef', 'not_agreed'] as const;

export const MBT_FINANCING_LABELS: Record<string, string> = {
  imbt: 'ИМБТ',
  subsidy: 'Субсидия',
};

export const MBT_ACTIVITIES_LABELS: Record<string, string> = {
  '1': 'Мероприятие 1',
  '2': 'Мероприятие 2',
  '3': 'Мероприятие 3',
};

export const MBT_STATUS_LABELS: Record<string, string> = {
  verified: 'Проверено',
  sent_to_mef: 'Направлено в МЭФ',
  not_agreed: 'Не согласовано',
};

export const mbtProjects = pgTable("mbt_projects", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  district: text("district"),
  year: integer("year"),
  amountMln: text("amount_mln"),
  financingMethod: text("financing_method").$type<typeof MBT_FINANCING_METHODS[number]>(),
  activities: text("activities").$type<typeof MBT_ACTIVITIES[number]>(),
  status: text("status").$type<typeof MBT_STATUSES[number]>(),
  section: text("section"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("mbt_projects_user_id_idx").on(table.userId),
  createdAtIdx: index("mbt_projects_created_at_idx").on(table.createdAt),
}));

export const insertMbtProjectSchema = createInsertSchema(mbtProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  district: z.string().optional(),
  year: z.number().optional(),
  amountMln: z.string().optional(),
  financingMethod: z.enum(MBT_FINANCING_METHODS).optional(),
  activities: z.enum(MBT_ACTIVITIES).optional(),
  status: z.enum(MBT_STATUSES).optional(),
  section: z.string().optional(),
});

export type InsertMbtProject = z.infer<typeof insertMbtProjectSchema>;
export type MbtProject = typeof mbtProjects.$inferSelect;

// ============================================================================
// MBT DOCUMENTS TABLE (ZIP archives)
// ============================================================================
export const mbtDocuments = pgTable("mbt_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => mbtProjects.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text("filename").notNull(),
  originalName: text("original_name").notNull(),
  filePath: text("file_path").notNull(),
  fileSize: text("file_size").notNull(),
  status: text("status").notNull().default('uploaded').$type<"uploaded" | "extracting" | "ready" | "error">(),
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("mbt_documents_project_id_idx").on(table.projectId),
}));

export const insertMbtDocumentSchema = createInsertSchema(mbtDocuments).omit({ id: true, uploadedAt: true });
export type InsertMbtDocument = z.infer<typeof insertMbtDocumentSchema>;
export type MbtDocument = typeof mbtDocuments.$inferSelect;

// ============================================================================
// MBT SECTIONS TABLE (project-level section templates)
// ============================================================================
export const mbtSections = pgTable("mbt_sections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => mbtProjects.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("mbt_sections_project_id_idx").on(table.projectId),
}));

export const insertMbtSectionSchema = createInsertSchema(mbtSections).omit({ id: true, createdAt: true });
export type InsertMbtSection = z.infer<typeof insertMbtSectionSchema>;
export type MbtSection = typeof mbtSections.$inferSelect;

// ============================================================================
// MBT SECTION RULES TABLE (routing rules per section)
// ============================================================================
export const mbtSectionRules = pgTable("mbt_section_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  sectionId: varchar("section_id").notNull().references(() => mbtSections.id, { onDelete: 'cascade' }),
  type: text("type").notNull().$type<"filename" | "keyword" | "has_artifact">(),
  value: text("value").notNull(),
});

export const insertMbtSectionRuleSchema = createInsertSchema(mbtSectionRules).omit({ id: true });
export type InsertMbtSectionRule = z.infer<typeof insertMbtSectionRuleSchema>;
export type MbtSectionRule = typeof mbtSectionRules.$inferSelect;

// ============================================================================
// MBT MARK BUTTONS TABLE (configurable mark buttons per project/section)
// ============================================================================
export const mbtMarkButtons = pgTable("mbt_mark_buttons", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => mbtProjects.id, { onDelete: 'cascade' }),
  sectionId: varchar("section_id"),
  key: text("key").notNull(),
  label: text("label").notNull(),
  order: integer("order").notNull().default(0),
}, (table) => ({
  projectIdIdx: index("mbt_mark_buttons_project_id_idx").on(table.projectId),
}));

export const insertMbtMarkButtonSchema = createInsertSchema(mbtMarkButtons).omit({ id: true });
export type InsertMbtMarkButton = z.infer<typeof insertMbtMarkButtonSchema>;
export type MbtMarkButton = typeof mbtMarkButtons.$inferSelect;

// ============================================================================
// DOC FOLDERS TABLE (user-managed folder hierarchy per project)
// ============================================================================
export const docFolders = pgTable("doc_folders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => mbtProjects.id, { onDelete: 'cascade' }),
  parentId: varchar("parent_id"),
  name: text("name").notNull(),
  color: text("color").default('#6b7280'),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("doc_folders_project_id_idx").on(table.projectId),
  parentIdIdx: index("doc_folders_parent_id_idx").on(table.parentId),
}));

export const insertDocFolderSchema = createInsertSchema(docFolders).omit({ id: true, createdAt: true });
export type InsertDocFolder = z.infer<typeof insertDocFolderSchema>;
export type DocFolder = typeof docFolders.$inferSelect;

// ============================================================================
// MBT DOCUMENT FILES TABLE (files inside ZIP)
// ============================================================================
export const mbtDocumentFiles = pgTable("mbt_document_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  documentId: varchar("document_id").notNull().references(() => mbtDocuments.id, { onDelete: 'cascade' }),
  sectionId: varchar("section_id").references(() => mbtSections.id, { onDelete: 'set null' }),
  folderId: varchar("folder_id"),
  filename: text("filename").notNull(),
  fileType: text("file_type").notNull().$type<"pdf" | "docx" | "xlsx" | "other">(),
  filePath: text("file_path").notNull(),
  pdfPath: text("pdf_path"),
  fileSize: text("file_size").notNull(),
  extractionStatus: text("extraction_status").notNull().default('pending').$type<"pending" | "processing" | "completed" | "error">(),
  analysisStatus: text("analysis_status").notNull().default('none').$type<"none" | "processing" | "completed" | "error">(),
  pageCount: integer("page_count").default(0),
  isApproved: boolean("is_approved").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  documentIdIdx: index("mbt_doc_files_document_id_idx").on(table.documentId),
}));

export const insertMbtDocumentFileSchema = createInsertSchema(mbtDocumentFiles).omit({ id: true, createdAt: true });
export type InsertMbtDocumentFile = z.infer<typeof insertMbtDocumentFileSchema>;
export type MbtDocumentFile = typeof mbtDocumentFiles.$inferSelect;

// ============================================================================
// MBT DOCUMENT PAGES TABLE (extracted text per page)
// ============================================================================
export const mbtDocumentPages = pgTable("mbt_document_pages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => mbtDocumentFiles.id, { onDelete: 'cascade' }),
  pageNumber: integer("page_number").notNull(),
  textContent: text("text_content").notNull(),
  findingsCache: jsonb("findings_cache"),
  analysisHash: varchar("analysis_hash"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  fileIdIdx: index("mbt_doc_pages_file_id_idx").on(table.fileId),
  filePageIdx: index("mbt_doc_pages_file_page_idx").on(table.fileId, table.pageNumber),
}));

export const insertMbtDocumentPageSchema = createInsertSchema(mbtDocumentPages).omit({ id: true, createdAt: true });
export type InsertMbtDocumentPage = z.infer<typeof insertMbtDocumentPageSchema>;
export type MbtDocumentPage = typeof mbtDocumentPages.$inferSelect;

// ============================================================================
// MBT ANALYSIS TEMPLATES TABLE (configurable analysis templates)
// ============================================================================

export interface AnalysisParameter {
  key: string;
  label: string;
  color: string;
  enabled: boolean;
  promptText?: string;
}

export const DEFAULT_ANALYSIS_PARAMETERS: AnalysisParameter[] = [
  { key: 'date', label: 'Дата', color: '#22c55e', enabled: true },
  { key: 'signature', label: 'Подпись', color: '#3b82f6', enabled: true },
  { key: 'seal', label: 'Печать', color: '#ef4444', enabled: true },
];

export const mbtAnalysisTemplates = pgTable("mbt_analysis_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").references(() => mbtProjects.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  parameters: jsonb("parameters").$type<AnalysisParameter[]>().notNull().default(sql`'[]'::jsonb`),
  isDefault: boolean("is_default").notNull().default(false),
  roleText: text("role_text"),
  additionalInstructions: text("additional_instructions"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  projectIdIdx: index("mbt_analysis_templates_project_id_idx").on(table.projectId),
}));

export const insertMbtAnalysisTemplateSchema = createInsertSchema(mbtAnalysisTemplates).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMbtAnalysisTemplate = z.infer<typeof insertMbtAnalysisTemplateSchema>;
export type MbtAnalysisTemplate = typeof mbtAnalysisTemplates.$inferSelect;

// ============================================================================
// MBT DOCUMENT ANALYSES TABLE (AI analysis results)
// ============================================================================
export const MBT_FINDING_TYPES = ['seal', 'signature', 'date'] as const;
export const MBT_FINDING_LABELS: Record<string, string> = {
  seal: 'Печать',
  signature: 'Подпись',
  date: 'Дата',
};
export const MBT_FINDING_COLORS: Record<string, string> = {
  seal: '#ef4444',
  signature: '#3b82f6',
  date: '#22c55e',
};

export const mbtDocumentAnalyses = pgTable("mbt_document_analyses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => mbtDocumentFiles.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text("status").notNull().default('pending').$type<"pending" | "processing" | "completed" | "error">(),
  model: text("model"),
  templateId: varchar("template_id").references(() => mbtAnalysisTemplates.id, { onDelete: 'set null' }),
  findings: jsonb("findings").$type<Array<{
    type: string;
    textFragment: string;
    page: number;
    description: string;
  }>>().default(sql`'[]'::jsonb`),
  findingsCount: integer("findings_count").default(0),
  errorMessage: text("error_message"),
  progress: integer("progress").default(0),
  progressStage: text("progress_stage"),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
}, (table) => ({
  fileIdIdx: index("mbt_doc_analyses_file_id_idx").on(table.fileId),
}));

export const insertMbtDocumentAnalysisSchema = createInsertSchema(mbtDocumentAnalyses).omit({ id: true, startedAt: true, completedAt: true });
export type InsertMbtDocumentAnalysis = z.infer<typeof insertMbtDocumentAnalysisSchema>;
export type MbtDocumentAnalysis = typeof mbtDocumentAnalyses.$inferSelect;

// ============================================================================
// CHECKLIST TEMPLATES TABLE (document package templates)
// ============================================================================
export const CHECKLIST_CASE_TYPES = ['subsidy', 'contract', 'litigation', 'audit', 'custom'] as const;
export type ChecklistCaseType = typeof CHECKLIST_CASE_TYPES[number];

export const CHECKLIST_CASE_TYPE_LABELS: Record<string, string> = {
  subsidy: 'Субсидия / Грант',
  contract: 'Договорной пакет',
  litigation: 'Судебное дело',
  audit: 'Аудиторская проверка',
  custom: 'Пользовательский',
};

export const docChecklistTemplates = pgTable("doc_checklist_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  caseType: text("case_type").notNull().$type<ChecklistCaseType>().default('custom'),
  isBuiltin: boolean("is_builtin").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
});

export const insertDocChecklistTemplateSchema = createInsertSchema(docChecklistTemplates).omit({ id: true, createdAt: true });
export type InsertDocChecklistTemplate = z.infer<typeof insertDocChecklistTemplateSchema>;
export type DocChecklistTemplate = typeof docChecklistTemplates.$inferSelect;

// ============================================================================
// CHECKLIST ITEMS TABLE (required documents within a template)
// ============================================================================
export interface ChecklistMatchRule {
  type: 'filename' | 'keyword' | 'filetype';
  value: string;
}

export const docChecklistItems = pgTable("doc_checklist_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateId: varchar("template_id").notNull().references(() => docChecklistTemplates.id, { onDelete: 'cascade' }),
  name: text("name").notNull(),
  description: text("description"),
  isRequired: boolean("is_required").notNull().default(true),
  matchRules: jsonb("match_rules").$type<ChecklistMatchRule[]>().default(sql`'[]'::jsonb`),
  alternativeGroupId: text("alternative_group_id"),
  order: integer("order").notNull().default(0),
}, (table) => ({
  templateIdIdx: index("doc_checklist_items_template_id_idx").on(table.templateId),
}));

export const insertDocChecklistItemSchema = createInsertSchema(docChecklistItems).omit({ id: true });
export type InsertDocChecklistItem = z.infer<typeof insertDocChecklistItemSchema>;
export type DocChecklistItem = typeof docChecklistItems.$inferSelect;

// ============================================================================
// DOC CONCLUSIONS TABLE (verification results per project)
// ============================================================================
export interface CompletenessResultItem {
  itemId: string;
  itemName: string;
  isRequired: boolean;
  status: 'found' | 'missing' | 'alternative_found';
  matchedFileId?: string;
  matchedFileName?: string;
  alternativeGroupId?: string;
}

export interface ManualOverride {
  itemId: string;
  status: 'found' | 'missing' | 'not_applicable';
  note?: string;
  fileId?: string;
  fileName?: string;
}

export interface CrossCheckResultItem {
  field: string;
  fieldLabel: string;
  status: 'match' | 'mismatch' | 'missing';
  values: Array<{ fileId: string; fileName: string; value: string }>;
}

export const DOC_CONCLUSION_STATUSES = ['approved', 'revision', 'rejected', 'pending'] as const;
export const DOC_CONCLUSION_STATUS_LABELS: Record<string, string> = {
  approved: 'Одобрено',
  revision: 'Требует доработки',
  rejected: 'Отказано',
  pending: 'На рассмотрении',
};

export const docConclusions = pgTable("doc_conclusions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => mbtProjects.id, { onDelete: 'cascade' }),
  checklistTemplateId: varchar("checklist_template_id").references(() => docChecklistTemplates.id, { onDelete: 'set null' }),
  status: text("status").notNull().default('pending').$type<typeof DOC_CONCLUSION_STATUSES[number]>(),
  completenessScore: integer("completeness_score").default(0),
  completenessResult: jsonb("completeness_result").$type<CompletenessResultItem[]>().default(sql`'[]'::jsonb`),
  crossCheckResult: jsonb("cross_check_result").$type<CrossCheckResultItem[]>().default(sql`'[]'::jsonb`),
  criticalIssues: integer("critical_issues").default(0),
  nonCriticalIssues: integer("non_critical_issues").default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
  // Reviewer / manual verification fields
  manualOverrides: jsonb("manual_overrides").$type<ManualOverride[]>().default(sql`'[]'::jsonb`),
  reviewerNote: text("reviewer_note"),
  reviewedBy: varchar("reviewed_by").references(() => users.id, { onDelete: 'set null' }),
  reviewedAt: timestamp("reviewed_at"),
  finalStatus: text("final_status").$type<typeof DOC_CONCLUSION_STATUSES[number]>(),
  isReviewed: boolean("is_reviewed").notNull().default(false),
}, (table) => ({
  projectIdIdx: index("doc_conclusions_project_id_idx").on(table.projectId),
}));

export const insertDocConclusionSchema = createInsertSchema(docConclusions).omit({ id: true, createdAt: true });
export type InsertDocConclusion = z.infer<typeof insertDocConclusionSchema>;
export type DocConclusion = typeof docConclusions.$inferSelect;

// ============================================================================
// MBT FILE ANNOTATIONS TABLE (marks, approvals, history)
// ============================================================================
export const mbtFileAnnotations = pgTable("mbt_file_annotations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => mbtDocumentFiles.id, { onDelete: 'cascade' }),
  type: text("type").notNull().$type<"mark" | "approve" | "unapprove">(),
  buttonKey: text("button_key"),
  page: integer("page"),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  note: text("note"),
}, (table) => ({
  fileIdIdx: index("mbt_file_annotations_file_id_idx").on(table.fileId),
}));

export const insertMbtFileAnnotationSchema = createInsertSchema(mbtFileAnnotations).omit({ id: true, createdAt: true });
export type InsertMbtFileAnnotation = z.infer<typeof insertMbtFileAnnotationSchema>;
export type MbtFileAnnotation = typeof mbtFileAnnotations.$inferSelect;

// ============================================================================
// DOC FILE RELATIONS TABLE (links between files within a project)
// ============================================================================
export const DOC_RELATION_TYPES = ['supports', 'contradicts', 'duplicate', 'reference', 'attachment'] as const;
export type DocRelationType = typeof DOC_RELATION_TYPES[number];
export const DOC_RELATION_TYPE_LABELS: Record<DocRelationType, string> = {
  supports: 'Подтверждает',
  contradicts: 'Противоречит',
  duplicate: 'Дубликат',
  reference: 'Ссылается',
  attachment: 'Приложение',
};

export const docFileRelations = pgTable("doc_file_relations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId: varchar("file_id").notNull().references(() => mbtDocumentFiles.id, { onDelete: 'cascade' }),
  relatedFileId: varchar("related_file_id").notNull().references(() => mbtDocumentFiles.id, { onDelete: 'cascade' }),
  relationType: text("relation_type").notNull().$type<DocRelationType>(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  createdBy: varchar("created_by").references(() => users.id, { onDelete: 'set null' }),
}, (table) => ({
  fileIdIdx: index("doc_file_relations_file_id_idx").on(table.fileId),
  relatedFileIdIdx: index("doc_file_relations_related_file_id_idx").on(table.relatedFileId),
}));

export const insertDocFileRelationSchema = createInsertSchema(docFileRelations).omit({ id: true, createdAt: true });
export type InsertDocFileRelation = z.infer<typeof insertDocFileRelationSchema>;
export type DocFileRelation = typeof docFileRelations.$inferSelect;

// ============================================================================
// MBT ACTIVITY LOG TABLE
// ============================================================================
export const MBT_ACTIVITY_ACTIONS = [
  'check_run', 'conclusion_signed', 'conclusion_unsigned',
  'file_approved', 'file_rejected', 'document_uploaded',
  'override_set', 'reviewer_note_updated',
] as const;
export type MbtActivityAction = typeof MBT_ACTIVITY_ACTIONS[number];

export const MBT_ACTIVITY_ACTION_LABELS: Record<MbtActivityAction, string> = {
  check_run: 'Проверка запущена',
  conclusion_signed: 'Заключение подписано',
  conclusion_unsigned: 'Подпись снята',
  file_approved: 'Файл принят',
  file_rejected: 'Файл отклонён',
  document_uploaded: 'Документ загружен',
  override_set: 'Позиция переопределена вручную',
  reviewer_note_updated: 'Примечание рецензента обновлено',
};

export const mbtActivityLog = pgTable("mbt_activity_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId: varchar("project_id").notNull().references(() => mbtProjects.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").references(() => users.id, { onDelete: 'set null' }),
  action: text("action").notNull().$type<MbtActivityAction>(),
  entityType: text("entity_type"),
  entityId: varchar("entity_id"),
  entityLabel: text("entity_label"),
  meta: jsonb("meta").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("mbt_activity_log_project_id_idx").on(table.projectId),
  createdAtIdx: index("mbt_activity_log_created_at_idx").on(table.createdAt),
}));

export type MbtActivityLogEntry = typeof mbtActivityLog.$inferSelect;

// ============================================================================
// PARSING TEMPLATES TABLE
// ============================================================================

export type ParsingColumn = {
  id:           string;
  name:         string;
  color:        string;
  isNumeric:    boolean;
  previewValue: string;
};

export type ParsingMapping = {
  columnId:      string;
  spanText:      string;
  contextBefore: string;
  contextAfter:  string;
};

export const parsingTemplates = pgTable("parsing_templates", {
  id:           varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId:    varchar("project_id").notNull().references(() => mbtProjects.id, { onDelete: 'cascade' }),
  name:         text("name").notNull(),
  sourceFileId: varchar("source_file_id"),
  sourcePage:   integer("source_page").default(1),
  columns:      jsonb("columns").$type<ParsingColumn[]>().notNull().default(sql`'[]'::jsonb`),
  mappings:     jsonb("mappings").$type<ParsingMapping[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("parsing_templates_project_id_idx").on(table.projectId),
}));

export const insertParsingTemplateSchema = createInsertSchema(parsingTemplates).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertParsingTemplate = z.infer<typeof insertParsingTemplateSchema>;
export type ParsingTemplate = typeof parsingTemplates.$inferSelect;

// ============================================================================
// GI ACTS MODULE (Акты гидроиспытаний)
// ============================================================================

export const GI_PROJECT_STATUSES = ['active', 'archived'] as const;

export const GI_FIELD_KEYS = [
  'act_number',
  'act_date',
  'test_date',
  'heat_source',
  'pipeline_sections',
  'test_pressure',
  'pressure_duration',
  'pressure_drop',
  'makeup_water',
  'defects',
  'conclusions',
  'has_gku_signature',
] as const;

export type GiFieldKey = typeof GI_FIELD_KEYS[number];

export const GI_FIELD_LABELS: Record<GiFieldKey, string> = {
  act_number:          'Номер акта',
  act_date:            'Дата акта',
  test_date:           'Дата гидравлического испытания',
  heat_source:         'Наименование теплоисточника',
  pipeline_sections:   'Участки тепловых сетей',
  test_pressure:       'Пробное давление',
  pressure_duration:   'Время под давлением',
  pressure_drop:       'Снижение давления',
  makeup_water:        'Расход подпиточной воды',
  defects:             'Описание дефектов',
  conclusions:         'Выводы и заключения комиссии',
  has_gku_signature:   'Подпись ГКУ МО МОС АВС',
};

export const GI_FILE_STATUSES = ['pending', 'processing', 'done', 'error', 'needs_review'] as const;
export type GiFileStatus = typeof GI_FILE_STATUSES[number];

export const GI_FILE_STATUS_LABELS: Record<GiFileStatus, string> = {
  pending:      'Ожидает',
  processing:   'Обрабатывается',
  done:         'Готово',
  error:        'Ошибка',
  needs_review: 'Требует проверки',
};

export const giProjects = pgTable("gi_projects", {
  id:             varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId:         varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:           text("name").notNull(),
  address:        text("address"),
  year:           integer("year"),
  status:         text("status").notNull().default('active').$type<typeof GI_PROJECT_STATUSES[number]>(),
  renameTemplate: text("rename_template").default('{act_date}_{heat_source}'),
  createdAt:      timestamp("created_at").notNull().defaultNow(),
  updatedAt:      timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index("gi_projects_user_id_idx").on(table.userId),
}));

export const insertGiProjectSchema = createInsertSchema(giProjects).omit({
  id: true, createdAt: true, updatedAt: true,
}).extend({
  address: z.string().optional(),
  year: z.number().optional(),
  status: z.enum(GI_PROJECT_STATUSES).optional(),
  renameTemplate: z.string().optional(),
});
export type InsertGiProject = z.infer<typeof insertGiProjectSchema>;
export type GiProject = typeof giProjects.$inferSelect;

export const giActFiles = pgTable("gi_act_files", {
  id:               varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  projectId:        varchar("project_id").notNull().references(() => giProjects.id, { onDelete: 'cascade' }),
  userId:           varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  originalFilename: text("original_filename").notNull(),
  renamedFilename:  text("renamed_filename"),
  filePath:         text("file_path").notNull(),
  pdfPath:          text("pdf_path"),
  status:           text("status").notNull().default('pending').$type<GiFileStatus>(),
  pageCount:        integer("page_count").default(0),
  confidenceAvg:    text("confidence_avg"),
  errorMessage:     text("error_message"),
  processedAt:      timestamp("processed_at"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  projectIdIdx: index("gi_act_files_project_id_idx").on(table.projectId),
}));

export const insertGiActFileSchema = createInsertSchema(giActFiles).omit({
  id: true, createdAt: true,
});
export type InsertGiActFile = z.infer<typeof insertGiActFileSchema>;
export type GiActFile = typeof giActFiles.$inferSelect;

export const giActFields = pgTable("gi_act_fields", {
  id:          varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fileId:      varchar("file_id").notNull().references(() => giActFiles.id, { onDelete: 'cascade' }),
  fieldKey:    text("field_key").notNull(),
  fieldValue:  text("field_value"),
  confidence:  text("confidence"),
  rawOcrText:  text("raw_ocr_text"),
  isVerified:  boolean("is_verified").notNull().default(false),
  verifiedBy:  varchar("verified_by").references(() => users.id, { onDelete: 'set null' }),
  updatedAt:   timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  fileIdIdx: index("gi_act_fields_file_id_idx").on(table.fileId),
}));

export const insertGiActFieldSchema = createInsertSchema(giActFields).omit({ id: true, updatedAt: true });
export type InsertGiActField = z.infer<typeof insertGiActFieldSchema>;
export type GiActField = typeof giActFields.$inferSelect;
