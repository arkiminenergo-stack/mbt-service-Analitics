import { storage } from '../storage';
import { callLLM, getOllamaConfig } from './llmExtraction';
import { log } from '../logger';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface AssistantMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AssistantAction =
  | { type: 'create_section'; name: string; rules: Array<{ type: 'filename' | 'has_artifact'; value: string }> }
  | { type: 'create_template'; name: string; items: Array<{ name: string; isRequired: boolean; matchRules: Array<{ type: 'filename' | 'keyword' | 'filetype'; value: string }> }> }
  | { type: 'create_folder'; name: string; parentId?: string | null }
  | { type: 'run_check' };

export interface ActionResult {
  action: AssistantAction;
  status: 'ok' | 'error';
  label: string;
  detail?: string;
}

export interface AssistantResponse {
  reply: string;
  actionsPerformed: ActionResult[];
  done: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// System prompt
// ──────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Ты — эксперт-помощник по настройке проектов КПД (Комплексная проверка документов) в российской системе верификации документов.

Твоя задача: провести диалог с пользователем, выяснить требования, а затем автоматически настроить проект:
1. Создать разделы (группировка файлов по правилам)
2. Создать шаблон проверки с перечнем обязательных документов
3. При необходимости создать папки для организации документов
4. Запустить проверку комплектности

ПРАВИЛА ОТВЕТА:
- Отвечай ТОЛЬКО валидным JSON (без markdown-блоков, без пояснений вне JSON)
- Формат ответа:
{
  "message": "Текст ответа пользователю на русском языке",
  "actions": [],
  "done": false
}

ДОСТУПНЫЕ ДЕЙСТВИЯ в поле "actions":

1. Создать раздел:
{ "type": "create_section", "name": "Название раздела", "rules": [{"type": "filename", "value": "слово1,слово2"}] }
- type правила: "filename" (совпадение в имени файла) или "has_artifact" (находки AI-анализа)
- value: ключевые слова через запятую (в нижнем регистре)

2. Создать шаблон проверки:
{ "type": "create_template", "name": "Название шаблона", "items": [
  { "name": "Соглашение о субсидии", "isRequired": true, "matchRules": [{"type": "filename", "value": "соглашение,agreement"}] }
]}

3. Создать папку:
{ "type": "create_folder", "name": "Название папки", "parentId": null }

4. Запустить проверку:
{ "type": "run_check" }

КОГДА ГЕНЕРИРОВАТЬ ДЕЙСТВИЯ:
- Только когда ты собрал достаточно информации (обычно после 2–4 вопросов)
- Сначала спроси: тип документов, уровень трансферта, нужна ли проверка подписей/печатей
- Затем одним сообщением верни все действия для создания конфигурации
- После создания предложи запустить проверку

ТИПЫ ПРОЕКТОВ И СТАНДАРТНЫЕ ПАКЕТЫ ДОКУМЕНТОВ:

1. Субсидия на капитальное строительство (капвложения):
Разделы: Соглашение | ПСД и разрешения | Конкурсные процедуры (44-ФЗ) | Акты выполненных работ | Платёжные поручения | Отчёты
Шаблон (обязательные): Соглашение о предоставлении субсидии, Паспорт проекта, Разрешение на строительство, ПСД, Положительное заключение экспертизы, Документы по конкурсным процедурам, КС-2, КС-3, Платёжные поручения, Отчёт об использовании средств

2. Текущая субсидия (некапитальные расходы):
Разделы: Соглашение | Отчёты | Платёжные поручения
Шаблон: Соглашение, Отчёт о расходовании средств, Платёжные поручения, Выписки банка

3. Дотация (выравнивание):
Разделы: Нормативные документы | Расчёты | Платёжные поручения
Шаблон: Закон/постановление о дотации, Расчёт объёма дотации, Платёжные поручения

4. Иной вид документов (межбюджетные кредиты, субвенции):
Уточнить у пользователя.

УРОВНИ ТРАНСФЕРТА:
- Федеральный → региональный: более строгие требования, часто нужен аудиторский отчёт
- Региональный → муниципальный: стандартный пакет
- Муниципальный → поселенческий: упрощённый пакет

ПРАВИЛА ИМЕНОВАНИЯ РАЗДЕЛОВ (примеры):
- "Соглашение" → rules: filename: "соглашение,agreement,договор"
- "ПСД и разрешения" → filename: "псд,проект,разрешение,экспертиз"
- "Конкурсные процедуры" → filename: "44-фз,аукцион,котировка,закупка,тендер,конкурс"
- "Акты выполненных работ" → filename: "кс-2,кс-3,акт,выполнен"
- "Платёжные поручения" → filename: "плат,п/п,поручени"
- "Отчёты" → filename: "отчёт,отчет,report"
- "ПСД" → filename: "псд,смета,проект"

ВАЖНО: При "done": true — это означает что вся настройка завершена. Ставь done:true только после того как создал все нужные сущности.`;

// ──────────────────────────────────────────────────────────────────────────────
// LLM call
// ──────────────────────────────────────────────────────────────────────────────

interface LLMStructuredResponse {
  message: string;
  actions: AssistantAction[];
  done: boolean;
}

function extractJSON(raw: string): string {
  // Strip markdown code blocks if present
  const codeBlock = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) return codeBlock[1].trim();
  // Find first { and last }
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) return raw.slice(firstBrace, lastBrace + 1);
  return raw;
}

async function callAssistantLLM(messages: AssistantMessage[]): Promise<LLMStructuredResponse> {
  const config = await getOllamaConfig();

  const llmMessages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  let raw: string;
  try {
    raw = await callLLM(llmMessages, config, { temperature: 0.4, maxTokens: 2000 });
  } catch (primaryErr: any) {
    // If primary provider (ollama) failed AND openai is configured, try openai fallback
    if (config.aiProvider !== 'openai' && config.openaiApiKey) {
      log.warn('Primary LLM provider failed, falling back to OpenAI provider', {
        primaryError: primaryErr?.message,
      });
      const fallbackConfig = { ...config, aiProvider: 'openai' };
      raw = await callLLM(llmMessages, fallbackConfig, { temperature: 0.4, maxTokens: 2000 });
    } else {
      throw primaryErr;
    }
  }

  const jsonStr = extractJSON(raw);

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      message: String(parsed.message ?? ''),
      actions: Array.isArray(parsed.actions) ? parsed.actions : [],
      done: Boolean(parsed.done),
    };
  } catch (e) {
    log.error('Failed to parse assistant LLM response', { raw, error: e });
    // Fallback — treat entire response as a plain message
    return { message: raw.slice(0, 1000), actions: [], done: false };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Action executor
// ──────────────────────────────────────────────────────────────────────────────

async function executeActions(
  projectId: string,
  userId: string,
  actions: AssistantAction[],
  createdTemplateId: { value: string | null },
): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of actions) {
    try {
      if (action.type === 'create_section') {
        const section = await storage.createMbtSection({
          projectId,
          name: action.name,
          order: 0,
        });

        for (const rule of action.rules ?? []) {
          await storage.createMbtSectionRule({
            sectionId: section.id,
            type: rule.type as any,
            value: rule.value,
          });
        }

        results.push({
          action,
          status: 'ok',
          label: `Раздел «${action.name}» создан`,
          detail: action.rules?.map(r => r.value).join('; '),
        });

        // Log
        storage.logActivity({
          projectId, userId,
          action: 'override_set',
          entityType: 'section',
          entityId: section.id,
          entityLabel: action.name,
          meta: { source: 'assistant' },
        }).catch(() => {});

      } else if (action.type === 'create_template') {
        const template = await storage.createChecklistTemplate({
          name: action.name,
          description: 'Создан помощником',
          isBuiltin: false,
          createdBy: userId,
        });

        createdTemplateId.value = template.id;

        for (let i = 0; i < (action.items ?? []).length; i++) {
          const item = action.items[i];
          await storage.createChecklistItem({
            templateId: template.id,
            name: item.name,
            description: null,
            isRequired: item.isRequired !== false,
            matchRules: item.matchRules ?? [],
            alternativeGroupId: null,
            order: i,
          });
        }

        results.push({
          action,
          status: 'ok',
          label: `Шаблон «${action.name}» создан`,
          detail: `${action.items?.length ?? 0} позиций`,
        });

      } else if (action.type === 'create_folder') {
        const folder = await storage.createFolder({
          projectId,
          name: action.name,
          parentId: action.parentId ?? null,
          color: null,
          order: 0,
          createdBy: userId,
        });

        results.push({
          action,
          status: 'ok',
          label: `Папка «${action.name}» создана`,
        });

      } else if (action.type === 'run_check') {
        const { checkCompleteness, crossCheckDocuments, buildConclusion, seedBuiltinTemplates } =
          await import('./checklistService');

        await seedBuiltinTemplates();

        const templateId = createdTemplateId.value ?? undefined;
        const completenessResult = templateId ? await checkCompleteness(projectId, templateId) : [];
        const crossCheckResult = await crossCheckDocuments(projectId);
        const { status, completenessScore, criticalIssues, nonCriticalIssues } =
          buildConclusion(completenessResult, crossCheckResult);

        const conclusion = await storage.createConclusion({
          projectId,
          checklistTemplateId: templateId ?? null,
          status,
          completenessScore,
          completenessResult,
          crossCheckResult,
          criticalIssues,
          nonCriticalIssues,
          createdBy: userId,
        });

        storage.logActivity({
          projectId, userId,
          action: 'check_run',
          entityType: 'conclusion',
          entityId: conclusion.id,
          meta: { status, completenessScore, criticalIssues, nonCriticalIssues, source: 'assistant' },
        }).catch(() => {});

        const statusLabels: Record<string, string> = {
          approved: 'Одобрено', revision: 'Требует доработки',
          rejected: 'Отказано', pending: 'На рассмотрении',
        };

        results.push({
          action,
          status: 'ok',
          label: 'Проверка выполнена',
          detail: `Статус: ${statusLabels[status] ?? status}, Комплектность: ${completenessScore}%, Критических: ${criticalIssues}`,
        });
      }
    } catch (err: any) {
      log.error('Assistant action failed', { action, error: err?.message });
      results.push({
        action,
        status: 'error',
        label: `Ошибка: ${(action as any).name ?? action.type}`,
        detail: err?.message ?? String(err),
      });
    }
  }

  return results;
}

// ──────────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────────

export async function runProjectAssistant(
  projectId: string,
  userId: string,
  messages: AssistantMessage[],
  /** Pass mutable ref so executor can share created templateId across actions */
  sessionState: { createdTemplateId: string | null },
): Promise<AssistantResponse> {
  const llmResponse = await callAssistantLLM(messages);

  const createdTemplateRef = { value: sessionState.createdTemplateId };
  const actionsPerformed = await executeActions(projectId, userId, llmResponse.actions, createdTemplateRef);
  sessionState.createdTemplateId = createdTemplateRef.value;

  return {
    reply: llmResponse.message,
    actionsPerformed,
    done: llmResponse.done,
  };
}
