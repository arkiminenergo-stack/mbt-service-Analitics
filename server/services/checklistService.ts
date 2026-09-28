import { db } from '../db';
import { eq, inArray } from 'drizzle-orm';
import {
  mbtDocuments, mbtDocumentFiles, mbtDocumentPages,
  docChecklistTemplates, docChecklistItems, docConclusions,
} from '@shared/schema';
import type {
  DocChecklistTemplate, DocChecklistItem,
  CompletenessResultItem, CrossCheckResultItem,
} from '@shared/schema';

// ============================================================================
// COMPLETENESS CHECK
// ============================================================================

function matchesItem(item: DocChecklistItem, filename: string, textContent: string): boolean {
  const rules = (item.matchRules ?? []) as Array<{ type: string; value: string }>;
  if (rules.length === 0) return false;
  for (const rule of rules) {
    const val = rule.value.toLowerCase();
    if (rule.type === 'filename') {
      if (filename.toLowerCase().includes(val)) return true;
    } else if (rule.type === 'keyword') {
      if (textContent.toLowerCase().includes(val)) return true;
    } else if (rule.type === 'filetype') {
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      if (ext === val || filename.toLowerCase().endsWith(`.${val}`)) return true;
    }
  }
  return false;
}

export async function checkCompleteness(
  projectId: string,
  templateId: string,
): Promise<CompletenessResultItem[]> {
  const items = await db.select()
    .from(docChecklistItems)
    .where(eq(docChecklistItems.templateId, templateId))
    .orderBy(docChecklistItems.order);

  const docs = await db.select({ id: mbtDocuments.id })
    .from(mbtDocuments)
    .where(eq(mbtDocuments.projectId, projectId));
  if (docs.length === 0) return items.map(i => ({
    itemId: i.id, itemName: i.name, isRequired: i.isRequired,
    status: 'missing' as const, alternativeGroupId: i.alternativeGroupId ?? undefined,
  }));

  const docIds = docs.map(d => d.id);
  const files = await db.select({ id: mbtDocumentFiles.id, filename: mbtDocumentFiles.filename })
    .from(mbtDocumentFiles)
    .where(inArray(mbtDocumentFiles.documentId, docIds));
  const fileIds = files.map(f => f.id);

  const pages = fileIds.length > 0
    ? await db.select({ fileId: mbtDocumentPages.fileId, textContent: mbtDocumentPages.textContent })
        .from(mbtDocumentPages)
        .where(inArray(mbtDocumentPages.fileId, fileIds))
    : [];

  const pagesByFile: Record<string, string[]> = {};
  for (const p of pages) {
    if (!pagesByFile[p.fileId]) pagesByFile[p.fileId] = [];
    pagesByFile[p.fileId].push(p.textContent);
  }

  const filesCombined = files.map(f => ({
    id: f.id,
    filename: f.filename,
    text: (pagesByFile[f.id] ?? []).join(' '),
  }));

  const results: CompletenessResultItem[] = [];

  for (const item of items) {
    const matched = filesCombined.find(f => matchesItem(item, f.filename, f.text));
    if (matched) {
      results.push({
        itemId: item.id,
        itemName: item.name,
        isRequired: item.isRequired,
        status: 'found',
        matchedFileId: matched.id,
        matchedFileName: matched.filename,
        alternativeGroupId: item.alternativeGroupId ?? undefined,
      });
    } else {
      results.push({
        itemId: item.id,
        itemName: item.name,
        isRequired: item.isRequired,
        status: 'missing',
        alternativeGroupId: item.alternativeGroupId ?? undefined,
      });
    }
  }

  // Resolve alternative groups: if any item in a group is found, mark missing ones as alternative_found
  const groupStatus: Record<string, 'found' | 'missing'> = {};
  for (const r of results) {
    if (r.alternativeGroupId) {
      const cur = groupStatus[r.alternativeGroupId];
      if (!cur || r.status === 'found') groupStatus[r.alternativeGroupId] = r.status;
    }
  }
  for (const r of results) {
    if (r.alternativeGroupId && groupStatus[r.alternativeGroupId] === 'found' && r.status === 'missing') {
      r.status = 'alternative_found';
    }
  }

  return results;
}

// ============================================================================
// CROSS-DOCUMENT CHECK
// ============================================================================

const INN_REGEX = /(?:ИНН|инн)[:\s]*(\d{10}|\d{12})/g;
const KPP_REGEX = /(?:КПП|кпп)[:\s]*(\d{9})/g;
const OGRN_REGEX = /(?:ОГРН|огрн)[:\s]*(\d{13}|\d{15})/g;
const AMOUNT_REGEX = /(\d[\d\s]{2,14}\d)[,.]?\d{0,2}\s*(?:руб|рублей|₽)/g;
const CASE_NUM_REGEX = /[АA]\d{2}-\d+\/\d{4}/g;
const ADDR_REGEX = /(?:г\.|ул\.|пр\.|д\.|кв\.|обл\.|р-н)[\s\w]+/g;

function extractField(text: string, regex: RegExp): string[] {
  const result: string[] = [];
  let m;
  const r = new RegExp(regex.source, regex.flags);
  while ((m = r.exec(text)) !== null) {
    const val = (m[1] || m[0]).replace(/\s/g, '');
    if (val && !result.includes(val)) result.push(val);
  }
  return result;
}

const CROSS_FIELDS: Array<{ key: string; label: string; regex: RegExp }> = [
  { key: 'inn', label: 'ИНН', regex: INN_REGEX },
  { key: 'kpp', label: 'КПП', regex: KPP_REGEX },
  { key: 'ogrn', label: 'ОГРН', regex: OGRN_REGEX },
  { key: 'case_number', label: 'Номер дела', regex: CASE_NUM_REGEX },
];

export async function crossCheckDocuments(projectId: string): Promise<CrossCheckResultItem[]> {
  const docs = await db.select({ id: mbtDocuments.id })
    .from(mbtDocuments)
    .where(eq(mbtDocuments.projectId, projectId));
  if (docs.length === 0) return [];

  const docIds = docs.map(d => d.id);
  const files = await db.select({ id: mbtDocumentFiles.id, filename: mbtDocumentFiles.filename })
    .from(mbtDocumentFiles)
    .where(inArray(mbtDocumentFiles.documentId, docIds));
  if (files.length < 2) return [];

  const fileIds = files.map(f => f.id);
  const pages = await db.select({ fileId: mbtDocumentPages.fileId, textContent: mbtDocumentPages.textContent })
    .from(mbtDocumentPages)
    .where(inArray(mbtDocumentPages.fileId, fileIds));

  const textByFile: Record<string, string> = {};
  for (const p of pages) {
    textByFile[p.fileId] = (textByFile[p.fileId] ?? '') + ' ' + p.textContent;
  }
  const fileNameById: Record<string, string> = {};
  for (const f of files) fileNameById[f.id] = f.filename;

  const results: CrossCheckResultItem[] = [];

  for (const field of CROSS_FIELDS) {
    const fileValues: Array<{ fileId: string; fileName: string; value: string }> = [];
    const allValues = new Set<string>();

    for (const f of files) {
      const text = textByFile[f.id] ?? '';
      const vals = extractField(text, field.regex);
      for (const v of vals) {
        allValues.add(v);
        if (!fileValues.find(fv => fv.fileId === f.id && fv.value === v)) {
          fileValues.push({ fileId: f.id, fileName: f.filename, value: v });
        }
      }
    }

    if (fileValues.length === 0) continue;

    const uniqueVals = [...new Set(fileValues.map(fv => fv.value))];
    const status: 'match' | 'mismatch' = uniqueVals.length <= 1 ? 'match' : 'mismatch';

    results.push({
      field: field.key,
      fieldLabel: field.label,
      status,
      values: fileValues,
    });
  }

  return results;
}

// ============================================================================
// GENERATE CONCLUSION
// ============================================================================

export function buildConclusion(
  completeness: CompletenessResultItem[],
  crossCheck: CrossCheckResultItem[],
): {
  status: 'approved' | 'revision' | 'rejected';
  completenessScore: number;
  criticalIssues: number;
  nonCriticalIssues: number;
} {
  const required = completeness.filter(i => i.isRequired);
  const missingRequired = completeness.filter(i => i.isRequired && i.status === 'missing');
  const missingOptional = completeness.filter(i => !i.isRequired && i.status === 'missing');
  const mismatches = crossCheck.filter(c => c.status === 'mismatch');

  const completenessScore = required.length > 0
    ? Math.round(((required.length - missingRequired.length) / required.length) * 100)
    : 100;

  const criticalIssues = missingRequired.length + mismatches.length;
  const nonCriticalIssues = missingOptional.length;

  let status: 'approved' | 'revision' | 'rejected';
  if (criticalIssues === 0 && completenessScore >= 95) {
    status = 'approved';
  } else if (missingRequired.length === 0 && mismatches.length === 0) {
    status = 'revision';
  } else {
    status = criticalIssues >= 3 ? 'rejected' : 'revision';
  }

  return { status, completenessScore, criticalIssues, nonCriticalIssues };
}

// ============================================================================
// BUILT-IN TEMPLATES (seed on first use)
// ============================================================================

const BUILTIN_TEMPLATES: Array<{
  name: string;
  description: string;
  caseType: string;
  items: Array<{
    name: string;
    description?: string;
    isRequired: boolean;
    matchRules: Array<{ type: string; value: string }>;
    order: number;
    alternativeGroupId?: string;
  }>;
}> = [
  {
    name: 'Субсидия на капитальный ремонт',
    description: 'Комплект документов для получения субсидии на капитальный ремонт объектов инфраструктуры',
    caseType: 'subsidy',
    items: [
      { name: 'Заявление на субсидию', isRequired: true, matchRules: [{ type: 'keyword', value: 'заявление' }, { type: 'filename', value: 'заявл' }], order: 1 },
      { name: 'Сметный расчёт', isRequired: true, matchRules: [{ type: 'keyword', value: 'сметный расчёт' }, { type: 'keyword', value: 'смет' }, { type: 'filename', value: 'смет' }], order: 2 },
      { name: 'Выписка ЕГРН', isRequired: false, matchRules: [{ type: 'keyword', value: 'егрн' }, { type: 'keyword', value: 'выписка из единого' }, { type: 'filename', value: 'егрн' }], order: 3, alternativeGroupId: 'ownership' },
      { name: 'Договор аренды / пользования', isRequired: false, matchRules: [{ type: 'keyword', value: 'договор аренды' }, { type: 'keyword', value: 'договор пользования' }, { type: 'filename', value: 'аренд' }], order: 4, alternativeGroupId: 'ownership' },
      { name: 'Решение комиссии / штаба', isRequired: true, matchRules: [{ type: 'keyword', value: 'решение' }, { type: 'keyword', value: 'штаб' }, { type: 'filename', value: 'решен' }], order: 5 },
      { name: 'Акт обследования объекта', isRequired: false, matchRules: [{ type: 'keyword', value: 'акт обследования' }, { type: 'keyword', value: 'акт осмотра' }, { type: 'filename', value: 'акт' }], order: 6 },
    ],
  },
  {
    name: 'Арбитражное дело',
    description: 'Комплект документов для арбитражного производства',
    caseType: 'litigation',
    items: [
      { name: 'Досудебная претензия', isRequired: true, matchRules: [{ type: 'keyword', value: 'претензия' }, { type: 'filename', value: 'претензи' }], order: 1 },
      { name: 'Исковое заявление', isRequired: true, matchRules: [{ type: 'keyword', value: 'исковое заявление' }, { type: 'filename', value: 'иск' }], order: 2 },
      { name: 'Решение суда первой инстанции', isRequired: false, matchRules: [{ type: 'keyword', value: 'решение арбитражного' }, { type: 'keyword', value: 'решение суда' }, { type: 'filename', value: 'решени' }], order: 3 },
      { name: 'Апелляционная жалоба', isRequired: false, matchRules: [{ type: 'keyword', value: 'апелляционная жалоба' }, { type: 'filename', value: 'апелля' }], order: 4 },
      { name: 'Постановление апелляционной инстанции', isRequired: false, matchRules: [{ type: 'keyword', value: 'постановление' }, { type: 'keyword', value: 'апелляционного' }, { type: 'filename', value: 'постановлени' }], order: 5 },
      { name: 'Документы об оплате госпошлины', isRequired: true, matchRules: [{ type: 'keyword', value: 'госпошлина' }, { type: 'keyword', value: 'платёжное поручение' }, { type: 'filename', value: 'пошлин' }], order: 6 },
    ],
  },
  {
    name: 'Договорной пакет',
    description: 'Базовый комплект документов для договорных отношений',
    caseType: 'contract',
    items: [
      { name: 'Договор', isRequired: true, matchRules: [{ type: 'keyword', value: 'договор' }, { type: 'filename', value: 'договор' }], order: 1 },
      { name: 'Приложение к договору', isRequired: false, matchRules: [{ type: 'keyword', value: 'приложение' }, { type: 'filename', value: 'приложен' }], order: 2 },
      { name: 'Счёт на оплату', isRequired: false, matchRules: [{ type: 'keyword', value: 'счёт на оплату' }, { type: 'keyword', value: 'счет на оплату' }, { type: 'filename', value: 'счет' }], order: 3 },
      { name: 'Акт выполненных работ', isRequired: false, matchRules: [{ type: 'keyword', value: 'акт выполненных' }, { type: 'keyword', value: 'акт приёмки' }, { type: 'filename', value: 'акт' }], order: 4 },
      { name: 'Счёт-фактура', isRequired: false, matchRules: [{ type: 'keyword', value: 'счёт-фактура' }, { type: 'keyword', value: 'счет-фактура' }, { type: 'filename', value: 'фактур' }], order: 5 },
    ],
  },
];

export async function seedBuiltinTemplates(): Promise<void> {
  const existing = await db.select({ id: docChecklistTemplates.id })
    .from(docChecklistTemplates)
    .where(eq(docChecklistTemplates.isBuiltin, true));
  if (existing.length > 0) return;

  for (const tpl of BUILTIN_TEMPLATES) {
    const [created] = await db.insert(docChecklistTemplates).values({
      name: tpl.name,
      description: tpl.description,
      caseType: tpl.caseType as any,
      isBuiltin: true,
    }).returning();

    for (const item of tpl.items) {
      await db.insert(docChecklistItems).values({
        templateId: created.id,
        name: item.name,
        description: item.description,
        isRequired: item.isRequired,
        matchRules: item.matchRules as any,
        order: item.order,
        alternativeGroupId: item.alternativeGroupId,
      });
    }
  }
}
