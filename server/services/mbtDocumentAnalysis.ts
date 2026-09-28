import { storage } from '../storage';
import { callLLM, getOllamaConfig, extractTextFromFile } from './llmExtraction';
import { extractByPattern, PATTERN_SUPPORTED_TYPES } from './patternExtraction';
import { log } from '../logger';
import { createHash } from 'crypto';
import type { MbtDocumentFile, MbtDocumentPage } from '@shared/schema';
import AdmZip from 'adm-zip';
import * as fs from 'fs';
import * as path from 'path';
import iconv from 'iconv-lite';

export interface MbtFinding {
  type: string;
  textFragment: string;
  page: number;
  description: string;
}

export interface MbtTemplateParameter {
  key: string;
  label: string;
  color: string;
  enabled: boolean;
}

const PAGE_BATCH_SIZE = 3; // Number of pages per LLM call

// Type-map cache: Record<typeName, MbtFinding[]> stored in findingsCache jsonb column.
// A type is cached for a page when its key exists in the map (array may be empty = no findings).
function getTypeCache(page: MbtDocumentPage): Record<string, MbtFinding[]> | null {
  const raw = page.findingsCache;
  if (!raw || Array.isArray(raw)) return null; // old flat-array format → ignore
  return raw as Record<string, MbtFinding[]>;
}

function isTypeCached(cache: Record<string, MbtFinding[]> | null, type: string): boolean {
  return cache !== null && type in cache;
}

function buildBatchUserPrompt(pages: Array<{ pageNumber: number; text: string }>, parameters?: MbtTemplateParameter[]): string {
  const enabledParams = parameters?.filter(p => p.enabled) ?? [];
  const typeList = enabledParams.length > 0
    ? enabledParams.map(p => `"${p.key}"`).join(' | ')
    : '"seal" | "signature" | "date"';

  const pageBlocks = pages.map(p =>
    `ТЕКСТ СТРАНИЦЫ ${p.pageNumber}:\n---\n${p.text}\n---`
  ).join('\n\n');

  return `Проанализируй текст ${pages.length > 1 ? `страниц ${pages.map(p => p.pageNumber).join(', ')}` : `страницы ${pages[0].pageNumber}`}. Извлеки все артефакты.

Формат ответа — JSON-массив:
[
  {"type": ${typeList}, "textFragment": "точная цитата 5-80 символов", "page": <НОМЕР СТРАНИЦЫ>, "description": "пояснение"}
]

ВАЖНО: поле "page" должно содержать точный номер страницы, откуда взят артефакт.

Напоминание:
- textFragment = ТОЧНАЯ цитата из текста ниже.
- Не выдумывать — только то, что есть в тексте.

${pageBlocks}`;
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    cleaned = cleaned.substring(firstBracket, lastBracket + 1);
  }
  return cleaned;
}

function parseFindings(raw: string, validTypes?: string[]): MbtFinding[] {
  const cleaned = cleanJsonResponse(raw);
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    const allowedTypes = validTypes && validTypes.length > 0 ? validTypes : ['seal', 'signature', 'date'];
    return parsed
      .filter((f: any) =>
        f && typeof f === 'object' &&
        typeof f.type === 'string' && allowedTypes.includes(f.type) &&
        typeof f.textFragment === 'string' && f.textFragment.length > 0 &&
        typeof f.page === 'number'
      )
      .map((f: any) => ({
        type: f.type as string,
        textFragment: f.textFragment.trim(),
        page: f.page,
        description: (f.description || '').trim(),
      }));
  } catch (e) {
    log.error('[MBT Analysis] Failed to parse LLM JSON response', { error: e, raw: cleaned.substring(0, 500) });
    return [];
  }
}

function buildDynamicSystemPrompt(parameters: MbtTemplateParameter[]): string {
  const enabledParams = parameters.filter(p => p.enabled);
  if (enabledParams.length === 0) return SYSTEM_PROMPT;

  const paramList = enabledParams.map(p => `- type: "${p.key}" — ${p.label}`).join('\n');
  const typeList = enabledParams.map(p => `"${p.key}"`).join(' | ');

  return `${SYSTEM_PROMPT}

══════════════════════════════════════
ДОПОЛНИТЕЛЬНЫЕ ПАРАМЕТРЫ ПОИСКА
══════════════════════════════════════
Помимо стандартных артефактов, извлекай следующие типы:
${paramList}

Допустимые значения поля "type": ${typeList}
Для каждого найденного артефакта укажи точную цитату (textFragment) и краткое описание (description).`;
}

function buildDynamicUserPrompt(pageNumber: number, text: string, parameters: MbtTemplateParameter[]): string {
  const enabledParams = parameters.filter(p => p.enabled);
  const typeList = enabledParams.length > 0
    ? enabledParams.map(p => `"${p.key}"`).join(' | ')
    : '"seal" | "signature" | "date"';

  return `Проанализируй текст страницы ${pageNumber}. Извлеки все артефакты.

Формат ответа — JSON-массив:
[
  {"type": ${typeList}, "textFragment": "точная цитата 5-80 символов", "page": ${pageNumber}, "description": "пояснение"}
]

Напоминание:
- textFragment = ТОЧНАЯ цитата из текста ниже.
- Не выдумывать — только то, что есть в тексте.

ТЕКСТ СТРАНИЦЫ ${pageNumber}:
---
${text}
---`;
}

const SYSTEM_PROMPT = `Ты — специалист по анализу официальных, финансовых и юридических документов (РФ).
Твоя задача — сканировать предоставленный текст (извлечённый из PDF/DOC/сканов после OCR) и извлекать все значимые артефакты, относящиеся к датам, подписям и печатям.

КРИТИЧЕСКОЕ ПРАВИЛО: Если в тексте есть явное указание на артефакт — обязан зафиксировать. Если артефакт отсутствует в тексте — не выдумывай.

══════════════════════════════════════
1. ДАТЫ (type: "date")
══════════════════════════════════════
Искать форматы:
- ДД.ММ.ГГГГ, ДД.ММ.ГГ: "01.09.2011", "31.12.2025", "02.03.26"
- Словесные: "14 апреля 2026 г.", "1 января 2025 года"
- С предлогом: "от 01.01.2025", "по состоянию на 02.03.2026", "за период январь-февраль 2025"
- Номер + дата: "№ 123 от 01.01.2025", "вх. № 456 от 14.04.2026"
- Шаблоны: "«__» ________ 20__ г.", "от «___» __________ 202_ г."
- Из судебных решений: дата вынесения решения, дата вступления в силу
- Период: "с 01.01.2025 по 31.12.2025"
description: краткое пояснение (например: "дата документа", "дата подписания", "период действия")
ВАЖНО: прочерк рядом с "20__", "г.", "года", названием месяца — это ДАТА, не подпись!

══════════════════════════════════════
2. ПОДПИСИ (type: "signature")
══════════════════════════════════════
Ловить маркеры — ТОЛЬКО при наличии должности или ФИО рядом:
- Должность + ФИО: "Директор В.В. Коновалов", "Главный бухгалтер О.А. Сотник", "Заместитель главы Гогина Ольга Валентиновна"
- Блоки утверждения: "УТВЕРЖДАЮ" / "СОГЛАСОВАНО" + должность
- Должность + прочерк: "Генеральный директор ________", "Руководитель _____________"
- Шаблон с расшифровкой: "(подпись) (ФИО)", "Подпись /___/ Расшифровка"
- Доверенность: "по доверенности № ...", "действующий на основании доверенности"
- Электронная подпись: "Подписан электронной подписью", "СВЕДЕНИЯ О СЕРТИФИКАТЕ ЭП", серийный номер, кем выдан, ФИО владельца
description: должность и ФИО (если известно), или "ФИО не указано" если только должность/прочерк
ВАЖНО: голый прочерк "________" БЕЗ должности или ФИО рядом — НЕ подпись, не включать!

══════════════════════════════════════
3. ПЕЧАТИ (type: "seal")
══════════════════════════════════════
Искать явные маркеры:
- "М.П.", "Место печати", "М. П."
- "гербовая печать", "круглая печать", "печать организации", "оттиск печати"
- "заверено печатью", "скреплено печатью"
- "УТВЕРЖДАЮ" / "Главный бухгалтер М.П." (блоки, традиционно сопровождаемые печатью)
- Электронная подпись как аналог печати: если в тексте есть "Документ подписан электронной подписью" — фиксировать ТАКЖЕ как seal с description "ЭП как аналог печати"
description: тип печати или "место печати" / "ЭП как аналог печати"

══════════════════════════════════════
ПРАВИЛА РАЗЛИЧЕНИЯ
══════════════════════════════════════
- "__________ 20__ г." → date (шаблон даты)
- "«__» ________ 20__ г." → date (шаблон даты)
- "Директор ________" → signature (должность + прочерк; description: "Директор, ФИО не указано")
- Голый "________" без контекста → НЕ включать
- "Подписан ЭП" → signature + seal (два отдельных объекта!)
- Если ФИО есть рядом с должностью → включить в description

textFragment: ТОЧНАЯ цитата из текста (5–80 символов).
Ответ: ТОЛЬКО валидный JSON-массив, без дополнительного текста.`;

function buildUserPrompt(pageNumber: number, text: string): string {
  return `Проанализируй текст страницы ${pageNumber}. Извлеки все артефакты: даты, подписи, печати.

Формат ответа — JSON-массив:
[
  {"type": "seal"|"signature"|"date", "textFragment": "точная цитата 5-80 символов", "page": ${pageNumber}, "description": "пояснение"}
]

Напоминание:
- textFragment = ТОЧНАЯ цитата из текста ниже.
- Прочерк + "20__" / "г." / месяц = date. Прочерк + должность = signature. Голый прочерк = пропустить.
- "Подписан ЭП" → два объекта: signature + seal.
- Если подпись найдена, но ФИО нет → description: "должность, ФИО не указано".
- Не выдумывать — только то, что есть в тексте.

ТЕКСТ СТРАНИЦЫ ${pageNumber}:
---
${text}
---`;
}

export async function extractTextFromPdf(
  filePath: string,
  opts: { useOcr?: boolean } = {}
): Promise<{ pages: Array<{ pageNumber: number; text: string }>; searchablePdfPath?: string }> {
  try {
    const result = await extractTextFromFile(filePath, { useOcr: opts.useOcr ?? false });
    const searchablePdfPath = result.searchablePdfPath;

    if (!result.text) {
      return { pages: [], searchablePdfPath };
    }

    const pageMarkerRegex = /\n?---\s*Page\s+(\d+)\s*---\n?/i;
    const parts = result.text.split(pageMarkerRegex);

    if (parts.length > 1) {
      const pages: Array<{ pageNumber: number; text: string }> = [];
      for (let i = 1; i < parts.length; i += 2) {
        const pageNum = parseInt(parts[i], 10);
        const text = (parts[i + 1] || '').trim();
        if (text.length > 0) {
          pages.push({ pageNumber: pageNum, text });
        }
      }
      if (pages.length > 0) {
        log.info('[MBT Analysis] Extracted pages via markers', { count: pages.length });
        return { pages, searchablePdfPath };
      }
    }

    const ffPages = result.text.split(/\f/);
    if (ffPages.length > 1) {
      const pages = ffPages
        .map((text, i) => ({ pageNumber: i + 1, text: text.trim() }))
        .filter(p => p.text.length > 0);
      if (pages.length > 1) {
        log.info('[MBT Analysis] Extracted pages via form-feed', { count: pages.length });
        return { pages, searchablePdfPath };
      }
    }

    const fullText = result.text.trim();
    if (fullText.length > 0) {
      const avgPageChars = 2000;
      if (fullText.length > avgPageChars * 1.5) {
        const estimatedPages = Math.max(1, Math.round(fullText.length / avgPageChars));
        const chunkSize = Math.ceil(fullText.length / estimatedPages);
        const pages: Array<{ pageNumber: number; text: string }> = [];
        for (let i = 0; i < estimatedPages; i++) {
          let start = i * chunkSize;
          let end = Math.min((i + 1) * chunkSize, fullText.length);
          if (i > 0) {
            const newlinePos = fullText.indexOf('\n', start);
            if (newlinePos !== -1 && newlinePos - start < 200) start = newlinePos + 1;
          }
          if (end < fullText.length) {
            const newlinePos = fullText.lastIndexOf('\n', end);
            if (newlinePos > start) end = newlinePos;
          }
          const text = fullText.substring(start, end).trim();
          if (text.length > 0) pages.push({ pageNumber: i + 1, text });
        }
        log.info('[MBT Analysis] Split single text block into estimated pages', { count: pages.length });
        return { pages, searchablePdfPath };
      }
      return { pages: [{ pageNumber: 1, text: fullText }], searchablePdfPath };
    }

    return { pages: [], searchablePdfPath };
  } catch (error) {
    log.error('[MBT Analysis] Text extraction failed', { error, filePath });
    return { pages: [] };
  }
}

export interface MbtAnalysisOptions {
  findDates?: boolean;
  findSignatures?: boolean;
  findSeals?: boolean;
  useOcr?: boolean;
  systemPrompt?: string;
  parameters?: MbtTemplateParameter[];
  templateId?: string;
}

export async function analyzeMbtDocument(
  fileId: string,
  userId: string,
  options: MbtAnalysisOptions = {}
): Promise<void> {
  const {
    findDates = true,
    findSignatures = true,
    findSeals = true,
    useOcr = false,
    systemPrompt: customSystemPrompt,
    parameters: customParameters,
    templateId,
  } = options;

  const file = await storage.getMbtDocumentFile(fileId);
  if (!file) throw new Error('File not found');

  const config = await getOllamaConfig();
  const modelName = config.aiProvider === 'openai' ? config.openaiModel : config.model;

  const analysis = await storage.createMbtDocumentAnalysis({
    fileId,
    userId,
    status: 'processing',
    model: modelName,
    templateId: templateId || null,
    findings: [],
    findingsCount: 0,
    progress: 0,
    progressStage: 'Инициализация...',
  });

  await storage.updateMbtDocumentFile(fileId, { analysisStatus: 'processing' });

  const setProgress = (progress: number, progressStage: string) =>
    storage.updateMbtDocumentAnalysis(analysis.id, { progress, progressStage }).catch(() => {});

  const hasCustomParams = customParameters && customParameters.length > 0;
  const effectiveSystemPrompt = customSystemPrompt
    ? (hasCustomParams ? buildDynamicSystemPrompt(customParameters!) : customSystemPrompt)
    : (hasCustomParams ? buildDynamicSystemPrompt(customParameters!) : SYSTEM_PROMPT);

  const enabledTypes = hasCustomParams
    ? customParameters!.filter(p => p.enabled).map(p => p.key)
    : [
        ...(findDates ? ['date'] : []),
        ...(findSignatures ? ['signature'] : []),
        ...(findSeals ? ['seal'] : []),
      ];

  try {
    let pages = await storage.getMbtDocumentPages(fileId);

    // Force re-extraction for scanned PDFs that were analysed before searchable PDF support.
    // Condition: pages exist (extraction ran), but pdfPath is null (searchable PDF was never
    // generated), and the original file is a PDF (not a converted DOCX/XLSX).
    // Re-extraction will run OCR → generate searchable PDF → update pdfPath.
    if (pages.length > 0 && !file.pdfPath && file.fileType === 'pdf') {
      log.info('[MBT Analysis] Forcing re-extraction: scanned PDF has no searchable version', { fileId });
      await storage.deleteMbtDocumentPages(fileId);
      await storage.updateMbtDocumentFile(fileId, { extractionStatus: 'pending' });
      pages = [];
    }

    if (pages.length === 0) {
      const pdfPath = file.pdfPath || file.filePath;
      await storage.updateMbtDocumentFile(fileId, { extractionStatus: 'processing' });
      await setProgress(10, 'Извлечение текста...');

      let extracted = await extractTextFromPdf(pdfPath, { useOcr });

      // Auto-fallback: if no text extracted and OCR wasn't already enabled, retry with OCR
      if (extracted.pages.length === 0 && !useOcr) {
        await setProgress(15, 'Документ-скан, запуск OCR...');
        log.info('[MBT Analysis] Text extraction empty, retrying with OCR', { fileId });
        extracted = await extractTextFromPdf(pdfPath, { useOcr: true });
      }

      if (extracted.pages.length === 0) {
        await storage.updateMbtDocumentFile(fileId, { extractionStatus: 'error' });
        throw new Error('Не удалось извлечь текст из документа даже с OCR. Возможно, документ повреждён или качество скана слишком низкое.');
      }

      // If OCR generated a searchable PDF (image + invisible text layer), update pdfPath so
      // the viewer serves it instead of the original scan — this enables text highlighting.
      if (extracted.searchablePdfPath) {
        log.info('[MBT Analysis] Storing searchable PDF path for viewer', {
          fileId,
          searchablePdfPath: extracted.searchablePdfPath,
        });
        await storage.updateMbtDocumentFile(fileId, { pdfPath: extracted.searchablePdfPath });
      }

      await storage.createMbtDocumentPages(
        extracted.pages.map(p => ({
          fileId,
          pageNumber: p.pageNumber,
          textContent: p.text,
        }))
      );

      await storage.updateMbtDocumentFile(fileId, {
        extractionStatus: 'completed',
        pageCount: extracted.pages.length,
      });

      pages = await storage.getMbtDocumentPages(fileId);
    }

    await setProgress(30, 'Поиск по шаблонам...');

    const allFindings: MbtFinding[] = [];

    // Determine which types need LLM (not covered by regex)
    const llmTypes = enabledTypes.filter(t => !PATTERN_SUPPORTED_TYPES.has(t));
    const patternTypes = enabledTypes.filter(t => PATTERN_SUPPORTED_TYPES.has(t));

    // Per-page processing: check type-level cache, apply regex, queue pages for LLM
    const pagesNeedingLlm: typeof pages = [];

    let cacheHits = 0;
    let regexHits = 0;

    for (const page of pages) {
      if (page.textContent.length < 10) continue;

      const typeCache = getTypeCache(page);
      const updatedCache: Record<string, MbtFinding[]> = typeCache ? { ...typeCache } : {};
      let pageUpdated = false;

      // --- Regex layer: extract pattern-based types (date, seal) ---
      for (const type of patternTypes) {
        if (isTypeCached(typeCache, type)) {
          allFindings.push(...(typeCache![type] || []));
          cacheHits++;
        } else {
          const found = extractByPattern(page.textContent, type, page.pageNumber);
          updatedCache[type] = found;
          allFindings.push(...found);
          pageUpdated = true;
          regexHits++;
        }
      }

      // --- LLM layer: check which LLM types are already cached ---
      const uncachedLlmTypes = llmTypes.filter(t => !isTypeCached(typeCache, t));

      if (uncachedLlmTypes.length === 0) {
        // All LLM types also cached — pull from cache
        for (const type of llmTypes) {
          allFindings.push(...(typeCache![type] || []));
          cacheHits++;
        }
      } else {
        // This page needs LLM for at least one type
        pagesNeedingLlm.push(page);
      }

      if (pageUpdated) {
        await storage.updateMbtDocumentPage(page.id, { findingsCache: updatedCache });
      }
    }

    log.info('[MBT Analysis] Cache/regex stats', {
      cacheHits,
      regexHits,
      llmPages: pagesNeedingLlm.length,
    });

    // --- LLM batching: only pages that still need LLM types ---
    if (llmTypes.length > 0 && pagesNeedingLlm.length > 0) {
      const totalBatches = Math.ceil(pagesNeedingLlm.length / PAGE_BATCH_SIZE);
      await setProgress(45, `ИИ-анализ (0/${totalBatches})...`);

      const llmSystemPrompt = customSystemPrompt || (hasCustomParams
        ? buildDynamicSystemPrompt(customParameters!)
        : SYSTEM_PROMPT);

      for (let bi = 0; bi < pagesNeedingLlm.length; bi += PAGE_BATCH_SIZE) {
        const batch = pagesNeedingLlm.slice(bi, bi + PAGE_BATCH_SIZE);
        const batchNum = Math.floor(bi / PAGE_BATCH_SIZE) + 1;

        if (bi > 0) await new Promise(r => setTimeout(r, 300));

        try {
          // Build prompt for only the LLM-needed types
          const llmParams: MbtTemplateParameter[] = hasCustomParams
            ? customParameters!.filter(p => p.enabled && llmTypes.includes(p.key))
            : llmTypes.map(t => ({
                key: t,
                label: t === 'signature' ? 'Подписи (должность + ФИО или прочерк)' : t,
                color: '#888',
                enabled: true,
              }));

          const userPrompt = buildBatchUserPrompt(
            batch.map(p => ({ pageNumber: p.pageNumber, text: p.textContent })),
            llmParams
          );

          const messages = [
            { role: 'system', content: llmSystemPrompt },
            { role: 'user', content: userPrompt },
          ];

          const response = await callLLM(messages, config, { temperature: 0.1, maxTokens: 4000 });
          const batchFindings = parseFindings(response, llmTypes);

          // Merge LLM results into per-page type caches
          for (const page of batch) {
            const typeCache = getTypeCache(page);
            const updatedCache: Record<string, MbtFinding[]> = typeCache ? { ...typeCache } : {};
            const pageFindings = batchFindings.filter(f => f.page === page.pageNumber);

            for (const type of llmTypes) {
              updatedCache[type] = pageFindings.filter(f => f.type === type);
            }

            await storage.updateMbtDocumentPage(page.id, { findingsCache: updatedCache });
            allFindings.push(...pageFindings);

            log.info('[MBT Analysis] LLM page analyzed', {
              pageNumber: page.pageNumber,
              findings: pageFindings.length,
            });
          }

          const pct = Math.round(45 + (batchNum / totalBatches) * 50);
          await setProgress(pct, `ИИ-анализ (${batchNum}/${totalBatches})...`);
        } catch (batchError: any) {
          log.warn('[MBT Analysis] Error in LLM batch, skipping', {
            pages: batch.map(p => p.pageNumber),
            error: batchError?.message || String(batchError),
          });
        }
      }
    }

    await storage.updateMbtDocumentAnalysis(analysis.id, {
      status: 'completed',
      findings: allFindings,
      findingsCount: allFindings.length,
      progress: 100,
      progressStage: 'Готово',
      completedAt: new Date(),
    });

    await storage.updateMbtDocumentFile(fileId, { analysisStatus: 'completed' });

    log.info('[MBT Analysis] Analysis completed', { fileId, findingsCount: allFindings.length });
  } catch (error: any) {
    log.error('[MBT Analysis] Analysis failed', { fileId, error: error.message });

    await storage.updateMbtDocumentAnalysis(analysis.id, {
      status: 'error',
      errorMessage: error.message,
      completedAt: new Date(),
    });

    await storage.updateMbtDocumentFile(fileId, { analysisStatus: 'error' });
  }
}

function getFileType(filename: string): 'pdf' | 'docx' | 'xlsx' | 'other' {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  return 'other';
}

function isHiddenOrMeta(entryName: string): boolean {
  const parts = entryName.split('/');
  return parts.some(p => p.startsWith('.') || p.startsWith('__MACOSX') || p === 'Thumbs.db' || p === '.DS_Store');
}

function cyrillicRatio(text: string): number {
  if (!text.length) return 0;
  const cyrillic = (text.match(/[а-яА-ЯёЁ]/g) || []).length;
  return cyrillic / text.length;
}

function decodeZipEntryName(entry: AdmZip.IZipEntry): string {
  const rawBuf: Buffer | undefined = (entry as any).rawEntryName;
  if (!rawBuf || !Buffer.isBuffer(rawBuf) || rawBuf.length === 0) {
    log.warn('[MBT] ZIP entry: rawEntryName missing, using entryName fallback', { name: entry.entryName });
    return entry.entryName;
  }

  const hasNonAscii = rawBuf.some(b => b > 0x7F);
  if (!hasNonAscii) {
    return entry.entryName;
  }

  const efsFlag = (entry as any).header?.flags_efs;
  if (efsFlag) {
    log.info('[MBT] ZIP entry: EFS flag, using UTF-8', { name: entry.entryName });
    return entry.entryName;
  }

  // CP1251 is the Windows default for Russian ZIPs — use it unconditionally.
  // Fall back to CP866 only if CP1251 yields virtually no Cyrillic and CP866 does significantly better.
  const decoded1251 = iconv.decode(rawBuf, 'win1251');
  const score1251 = cyrillicRatio(decoded1251);

  const decoded866 = iconv.decode(rawBuf, 'cp866');
  const score866 = cyrillicRatio(decoded866);

  const hexPreview = rawBuf.slice(0, 20).toString('hex').replace(/(.{2})/g, '$1 ').trim();

  if (score866 > score1251) {
    log.info('[MBT] ZIP entry: using CP866 fallback', { decoded: decoded866, score866: score866.toFixed(3), hex: hexPreview });
    return decoded866;
  }

  log.info('[MBT] ZIP entry: using CP1251', { decoded: decoded1251, score1251: score1251.toFixed(3), hex: hexPreview });
  return decoded1251;
}

export async function extractZipAndCreateFiles(
  documentId: string,
  zipPath: string,
  outputDir: string
): Promise<void> {
  try {
    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();
    const extractDir = path.join(outputDir, documentId);
    fs.mkdirSync(extractDir, { recursive: true });

    let fileCount = 0;

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const decodedName = decodeZipEntryName(entry);
      log.info('[MBT] ZIP entry decoded', { raw: entry.entryName, decoded: decodedName });
      if (isHiddenOrMeta(decodedName)) continue;

      const filename = path.basename(decodedName);
      const fileType = getFileType(filename);
      if (fileType === 'other') continue;

      const safeName = `${Date.now()}_${fileCount}_${filename.replace(/[/\\:*?"<>|]/g, '_')}`;
      const filePath = path.join(extractDir, safeName);
      fs.writeFileSync(filePath, entry.getData());

      let pdfPath: string | undefined;
      if (fileType === 'docx' || fileType === 'xlsx') {
        try {
          pdfPath = await convertToPdf(filePath, extractDir);
        } catch (convErr) {
          log.warn('[MBT] Failed to convert to PDF', { filename, error: convErr });
        }
      }

      await storage.createMbtDocumentFile({
        documentId,
        filename,
        fileType,
        filePath,
        pdfPath: pdfPath || null,
        fileSize: String(entry.header.size),
        extractionStatus: 'pending',
        analysisStatus: 'none',
        pageCount: 0,
      });

      fileCount++;
    }

    await storage.updateMbtDocument(documentId, { status: 'ready' });
    log.info('[MBT] ZIP extracted', { documentId, fileCount });
  } catch (error: any) {
    log.error('[MBT] ZIP extraction failed', { documentId, error: error.message });
    await storage.updateMbtDocument(documentId, { status: 'error' });
  }
}

async function convertToPdf(inputPath: string, outputDir: string): Promise<string> {
  const { spawn } = await import('child_process');
  const os = await import('os');

  // Each conversion gets its own profile dir to avoid lock conflicts between parallel calls
  const profileDir = path.join(os.tmpdir(), `lo_profile_${process.pid}_${Date.now()}`);

  return new Promise((resolve, reject) => {
    const proc = spawn('libreoffice', [
      '--headless',
      '--norestore',
      `-env:UserInstallation=file://${profileDir}`,
      '--convert-to', 'pdf',
      '--outdir', outputDir,
      inputPath,
    ]);

    // Consume stdout/stderr to prevent pipe buffer stalls
    let stderr = '';
    proc.stdout.on('data', () => {});
    proc.stderr.on('data', d => stderr += d.toString());

    // Safety timeout: 60s per file
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('LibreOffice conversion timed out'));
    }, 60_000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      // Clean up temp profile
      try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch {}
      if (code !== 0) {
        reject(new Error(`LibreOffice exited with code ${code}`));
        return;
      }
      const baseName = path.basename(inputPath, path.extname(inputPath));
      const pdfPath = path.join(outputDir, `${baseName}.pdf`);
      if (fs.existsSync(pdfPath)) {
        resolve(pdfPath);
      } else {
        reject(new Error('PDF output not found after conversion'));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
