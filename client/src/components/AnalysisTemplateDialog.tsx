import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, Trash2, Edit, ChevronLeft, Star, StarOff, Copy,
  GripVertical, Check, X, Settings2, Bot, AlignLeft, Eye, EyeOff,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import type { AnalysisParameter } from '@shared/schema';

export type { AnalysisParameter };

export interface AnalysisTemplate {
  id: string;
  projectId: string | null;
  name: string;
  systemPrompt: string;
  parameters: AnalysisParameter[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_ROLE_TEXT = `Ты — специалист по анализу официальных, финансовых и юридических документов (РФ).
Твоя задача — сканировать предоставленный текст (извлечённый из PDF/DOC/сканов после OCR) и извлекать все значимые артефакты, относящиеся к датам, подписям и печатям.

КРИТИЧЕСКОЕ ПРАВИЛО: Если в тексте есть явное указание на артефакт — обязан зафиксировать. Если артефакт отсутствует в тексте — не выдумывай.`;

const DEFAULT_ADDITIONAL_INSTRUCTIONS = `textFragment: ТОЧНАЯ цитата из текста (5–80 символов).
Ответ: ТОЛЬКО валидный JSON-массив, без дополнительного текста.`;

const DEFAULT_PROMPT_TEXTS: Record<string, string> = {
  date: `Искать форматы:
- ДД.ММ.ГГГГ, ДД.ММ.ГГ: "01.09.2011", "31.12.2025", "02.03.26"
- Словесные: "14 апреля 2026 г.", "1 января 2025 года"
- С предлогом: "от 01.01.2025", "по состоянию на 02.03.2026"
- Номер + дата: "№ 123 от 01.01.2025"
- Шаблоны: "«__» ________ 20__ г."
description: краткое пояснение (например: "дата документа", "дата подписания")`,
  signature: `Ловить маркеры — ТОЛЬКО при наличии должности или ФИО рядом:
- Должность + ФИО: "Директор В.В. Коновалов"
- Блоки утверждения: "УТВЕРЖДАЮ" / "СОГЛАСОВАНО" + должность
- Должность + прочерк: "Генеральный директор ________"
- Электронная подпись: "Подписан электронной подписью"
description: должность и ФИО (если известно)`,
  seal: `Искать явные маркеры:
- "М.П.", "Место печати", "М. П."
- "гербовая печать", "круглая печать"
- Электронная подпись как аналог печати
description: тип печати или "место печати"`,
};

const SEPARATOR = '══════════════════════════════════════';

function buildSystemPrompt(
  roleText: string,
  parameters: AnalysisParameter[],
  additionalInstructions: string
): string {
  const parts: string[] = [];
  if (roleText.trim()) parts.push(roleText.trim());

  let sectionNum = 1;
  for (const param of parameters) {
    if (param.enabled && param.promptText?.trim()) {
      parts.push(
        `${SEPARATOR}\n${sectionNum}. ${param.label.toUpperCase()} (type: "${param.key}")\n${SEPARATOR}\n${param.promptText.trim()}`
      );
      sectionNum++;
    }
  }

  if (additionalInstructions.trim()) {
    parts.push(additionalInstructions.trim());
  }
  return parts.join('\n\n');
}

function parseSystemPrompt(
  systemPrompt: string,
  _parameters: AnalysisParameter[]
): { roleText: string; additionalInstructions: string; paramPrompts: Record<string, string> } {
  // Match all artifact block headers: SEPARATOR\nN. LABEL (type: "key")\nSEPARATOR
  // ═ is U+2550 — not a special regex character, no escaping needed
  const headerPattern = new RegExp(
    `${SEPARATOR}\\n(\\d+)\\.\\s+[^\\n]+\\s+\\(type:\\s+"([^"]+)"\\)\\n${SEPARATOR}`,
    'g'
  );

  const headerMatches = [...systemPrompt.matchAll(headerPattern)];

  if (headerMatches.length === 0) {
    // No artifact blocks: put everything into roleText, nothing else
    return { roleText: systemPrompt.trim(), additionalInstructions: '', paramPrompts: {} };
  }

  const roleText = systemPrompt.substring(0, headerMatches[0].index).trim();
  const paramPrompts: Record<string, string> = {};
  let additionalInstructions = '';

  for (let i = 0; i < headerMatches.length; i++) {
    const match = headerMatches[i];
    const key = match[2];
    const contentStart = (match.index ?? 0) + match[0].length;

    if (i + 1 < headerMatches.length) {
      // Content ends where the next block begins
      paramPrompts[key] = systemPrompt.substring(contentStart, headerMatches[i + 1].index).trim();
    } else {
      // Last block: raw tail may contain additional instructions after a blank line
      const rawTail = systemPrompt.substring(contentStart);
      const blankLineIdx = rawTail.indexOf('\n\n');
      if (blankLineIdx !== -1) {
        paramPrompts[key] = rawTail.substring(0, blankLineIdx).trim();
        additionalInstructions = rawTail.substring(blankLineIdx + 2).trim();
      } else {
        paramPrompts[key] = rawTail.trim();
      }
    }
  }

  return { roleText, additionalInstructions, paramPrompts };
}

const DEFAULT_PARAMETERS: AnalysisParameter[] = [
  { key: 'date', label: 'Дата', color: '#22c55e', enabled: true, promptText: DEFAULT_PROMPT_TEXTS.date },
  { key: 'signature', label: 'Подпись', color: '#3b82f6', enabled: true, promptText: DEFAULT_PROMPT_TEXTS.signature },
  { key: 'seal', label: 'Печать', color: '#ef4444', enabled: true, promptText: DEFAULT_PROMPT_TEXTS.seal },
];

interface TemplateFormState {
  name: string;
  parameters: AnalysisParameter[];
  roleText: string;
  additionalInstructions: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  selectedTemplateId?: string | null;
  onSelectTemplate: (templateId: string | null) => void;
}

export function AnalysisTemplateDialog({ open, onClose, projectId, selectedTemplateId, onSelectTemplate }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [view, setView] = useState<'list' | 'edit' | 'create'>('list');
  const [editingTemplate, setEditingTemplate] = useState<AnalysisTemplate | null>(null);
  const [form, setForm] = useState<TemplateFormState>({
    name: '',
    parameters: DEFAULT_PARAMETERS.map(p => ({ ...p })),
    roleText: DEFAULT_ROLE_TEXT,
    additionalInstructions: DEFAULT_ADDITIONAL_INSTRUCTIONS,
  });

  const [showRole, setShowRole] = useState(false);
  const [openPrompts, setOpenPrompts] = useState<Set<number>>(new Set());
  const [showAdditional, setShowAdditional] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const templatesKey = ['/api/mbt/analysis-templates', projectId];

  const { data: templates = [], isLoading } = useQuery<AnalysisTemplate[]>({
    queryKey: templatesKey,
    queryFn: async () => {
      const url = projectId
        ? `/api/mbt/analysis-templates?projectId=${projectId}`
        : '/api/mbt/analysis-templates';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch templates');
      return res.json();
    },
    enabled: open,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: templatesKey });

  const builtPrompt = useMemo(
    () => buildSystemPrompt(form.roleText, form.parameters, form.additionalInstructions),
    [form.roleText, form.parameters, form.additionalInstructions]
  );

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; systemPrompt: string; parameters: AnalysisParameter[]; projectId: string | null }) => {
      const res = await apiRequest('POST', '/api/mbt/analysis-templates', data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Шаблон создан' });
      invalidate();
      setView('list');
    },
    onError: () => toast({ title: 'Ошибка при создании шаблона', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { name: string; systemPrompt: string; parameters: AnalysisParameter[] } }) => {
      const res = await apiRequest('PUT', `/api/mbt/analysis-templates/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Шаблон обновлён' });
      invalidate();
      setView('list');
    },
    onError: () => toast({ title: 'Ошибка при обновлении', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/mbt/analysis-templates/${id}`);
    },
    onSuccess: (_, id) => {
      toast({ title: 'Шаблон удалён' });
      if (selectedTemplateId === id) onSelectTemplate(null);
      invalidate();
    },
    onError: () => toast({ title: 'Ошибка при удалении', variant: 'destructive' }),
  });

  const resetFormUI = () => {
    setShowRole(false);
    setOpenPrompts(new Set());
    setShowAdditional(false);
    setShowPreview(false);
  };

  const startCreate = useCallback(() => {
    setForm({
      name: '',
      parameters: DEFAULT_PARAMETERS.map(p => ({ ...p })),
      roleText: DEFAULT_ROLE_TEXT,
      additionalInstructions: DEFAULT_ADDITIONAL_INSTRUCTIONS,
    });
    resetFormUI();
    setEditingTemplate(null);
    setView('create');
  }, []);

  const startEdit = useCallback((tmpl: AnalysisTemplate) => {
    const { roleText, additionalInstructions, paramPrompts } = parseSystemPrompt(
      tmpl.systemPrompt,
      tmpl.parameters
    );
    setForm({
      name: tmpl.name,
      parameters: tmpl.parameters.map(p => ({
        ...p,
        promptText: p.promptText ?? paramPrompts[p.key] ?? '',
      })),
      roleText,
      additionalInstructions,
    });
    resetFormUI();
    setEditingTemplate(tmpl);
    setView('edit');
  }, []);

  const startDuplicate = useCallback((tmpl: AnalysisTemplate) => {
    const { roleText, additionalInstructions, paramPrompts } = parseSystemPrompt(
      tmpl.systemPrompt,
      tmpl.parameters
    );
    setForm({
      name: `${tmpl.name} (копия)`,
      parameters: tmpl.parameters.map(p => ({
        ...p,
        promptText: p.promptText ?? paramPrompts[p.key] ?? '',
      })),
      roleText,
      additionalInstructions,
    });
    resetFormUI();
    setEditingTemplate(null);
    setView('create');
  }, []);

  const handleSave = () => {
    if (!form.name.trim()) {
      toast({ title: 'Укажите название шаблона', variant: 'destructive' });
      return;
    }
    if (form.parameters.length === 0) {
      toast({ title: 'Добавьте хотя бы один параметр', variant: 'destructive' });
      return;
    }
    const systemPrompt = builtPrompt;
    if (!systemPrompt.trim()) {
      toast({ title: 'Системный промпт не может быть пустым', variant: 'destructive' });
      return;
    }
    const payload = {
      name: form.name,
      systemPrompt,
      parameters: form.parameters,
      projectId: projectId || null,
    };
    if (view === 'edit' && editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const addParameter = () => {
    setForm(f => ({
      ...f,
      parameters: [
        ...f.parameters,
        {
          key: `param_${Date.now()}`,
          label: 'Новый параметр',
          color: '#a855f7',
          enabled: true,
          promptText: '',
        },
      ],
    }));
  };

  const removeParameter = (idx: number) => {
    setForm(f => ({ ...f, parameters: f.parameters.filter((_, i) => i !== idx) }));
    setOpenPrompts(prev => {
      const next = new Set<number>();
      prev.forEach(i => { if (i < idx) next.add(i); else if (i > idx) next.add(i - 1); });
      return next;
    });
  };

  const updateParameter = (idx: number, patch: Partial<AnalysisParameter>) => {
    setForm(f => ({
      ...f,
      parameters: f.parameters.map((p, i) => i === idx ? { ...p, ...patch } : p),
    }));
  };

  const togglePrompt = (idx: number) => {
    setOpenPrompts(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const isFormView = view === 'edit' || view === 'create';
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <div className="flex items-center gap-2">
            {isFormView && (
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setView('list')}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <div>
              <DialogTitle>
                {view === 'list' ? 'Шаблоны анализа' : view === 'create' ? 'Новый шаблон' : 'Редактировать шаблон'}
              </DialogTitle>
              <DialogDescription className="text-xs mt-0.5">
                {view === 'list'
                  ? 'Выберите шаблон или создайте новый с пользовательскими параметрами поиска'
                  : 'Настройте параметры и секции системного промпта'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* ── LIST VIEW ── */}
        {view === 'list' && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-4 space-y-2">
                <button
                  onClick={() => { onSelectTemplate(null); onClose(); }}
                  className={`w-full text-left rounded-lg border p-3 transition-colors ${
                    !selectedTemplateId
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">По умолчанию</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Даты, подписи, печати — встроенный промпт</p>
                    </div>
                    {!selectedTemplateId && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </button>

                {isLoading ? (
                  <div className="text-sm text-muted-foreground text-center py-4">Загрузка...</div>
                ) : templates.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Шаблонов пока нет. Создайте первый!
                  </div>
                ) : (
                  templates.map((tmpl) => (
                    <div
                      key={tmpl.id}
                      className={`rounded-lg border p-3 transition-colors ${
                        selectedTemplateId === tmpl.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          className="flex-1 text-left"
                          onClick={() => { onSelectTemplate(tmpl.id); onClose(); }}
                        >
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium">{tmpl.name}</p>
                            {tmpl.isDefault && (
                              <Badge variant="secondary" className="text-xs py-0">по умолч.</Badge>
                            )}
                            {selectedTemplateId === tmpl.id && (
                              <Check className="h-3.5 w-3.5 text-primary" />
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {tmpl.parameters.map(p => (
                              <span
                                key={p.key}
                                className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
                                style={{
                                  backgroundColor: `${p.color}22`,
                                  color: p.color,
                                  opacity: p.enabled ? 1 : 0.4,
                                }}
                              >
                                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: p.color }} />
                                {p.label}
                              </span>
                            ))}
                          </div>
                        </button>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Дублировать" onClick={() => startDuplicate(tmpl)}>
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Редактировать" onClick={() => startEdit(tmpl)}>
                            <Edit className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                            title="Удалить" onClick={() => deleteMutation.mutate(tmpl.id)} disabled={deleteMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="px-4 py-3 border-t shrink-0">
              <Button onClick={startCreate} className="w-full" size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Создать шаблон
              </Button>
            </div>
          </div>
        )}

        {/* ── FORM VIEW (create / edit) ── */}
        {isFormView && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="p-6 space-y-5">

                {/* Name */}
                <div className="space-y-1.5">
                  <Label htmlFor="tmpl-name">Название шаблона</Label>
                  <Input
                    id="tmpl-name"
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Например: КПД — базовый анализ"
                  />
                </div>

                {/* ── ARTIFACT PARAMETERS + PROMPT SECTIONS ── */}
                <div className="space-y-3">
                  {/* Header row */}
                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Артефакты и промпт</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Каждый артефакт добавляет свою секцию в системный промпт
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={addParameter}>
                      <Plus className="h-3.5 w-3.5 mr-1" />
                      Добавить
                    </Button>
                  </div>

                  {/* ROLE section button */}
                  <button
                    type="button"
                    onClick={() => setShowRole(v => !v)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      showRole
                        ? 'border-primary/60 bg-primary/5 text-primary'
                        : 'border-dashed border-muted-foreground/40 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >
                    <Bot className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium flex-1 text-left">Роль</span>
                    <span className="text-xs opacity-60">{showRole ? 'Свернуть' : 'Вводная часть промпта'}</span>
                    {showRole ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                  </button>

                  {showRole && (
                    <div className="rounded-lg border border-primary/30 bg-primary/3 p-3 space-y-1.5">
                      <div className="flex items-center gap-2 mb-1">
                        <Bot className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-medium text-primary">Роль и вводные инструкции</span>
                        <span className="text-xs text-muted-foreground ml-auto">начало промпта</span>
                      </div>
                      <Textarea
                        value={form.roleText}
                        onChange={e => setForm(f => ({ ...f, roleText: e.target.value }))}
                        className="font-mono text-xs min-h-[120px] resize-y bg-background"
                        placeholder="Опишите роль ИИ и общие инструкции..."
                      />
                    </div>
                  )}

                  {/* Artifact parameter rows */}
                  <div className="space-y-2">
                    {form.parameters.map((param, idx) => (
                      <div key={idx} className="rounded-lg border bg-muted/20 overflow-hidden">
                        {/* Main row */}
                        <div className="flex items-center gap-2 p-2.5">
                          {/* Color picker */}
                          <div className="relative shrink-0">
                            <input
                              type="color"
                              value={param.color}
                              onChange={e => updateParameter(idx, { color: e.target.value })}
                              className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                              title="Выбрать цвет"
                            />
                            <div
                              className="w-7 h-7 rounded-full border-2 border-white shadow-sm cursor-pointer"
                              style={{ backgroundColor: param.color }}
                            />
                          </div>

                          {/* Label */}
                          <Input
                            value={param.label}
                            onChange={e => updateParameter(idx, { label: e.target.value })}
                            placeholder="Название"
                            className="flex-1 h-8 text-sm"
                          />

                          {/* Key */}
                          <Input
                            value={param.key}
                            onChange={e => updateParameter(idx, { key: e.target.value.toLowerCase().replace(/\s+/g, '_') })}
                            placeholder="ключ"
                            className="w-24 h-8 text-xs font-mono"
                            title="Технический ключ (type в JSON)"
                          />

                          {/* Enabled toggle */}
                          <Switch
                            checked={param.enabled}
                            onCheckedChange={v => updateParameter(idx, { enabled: v })}
                            title={param.enabled ? 'Включён' : 'Отключён'}
                          />

                          {/* Settings — open/close prompt editor */}
                          <Button
                            variant={openPrompts.has(idx) ? 'secondary' : 'ghost'}
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            title="Настроить текст секции в промпте"
                            onClick={() => togglePrompt(idx)}
                          >
                            <Settings2 className="h-3.5 w-3.5" />
                          </Button>

                          {/* Delete */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                            onClick={() => removeParameter(idx)}
                            disabled={form.parameters.length === 1}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        {/* Expandable prompt text editor */}
                        {openPrompts.has(idx) && (
                          <div className={`border-t px-3 py-2.5 space-y-1.5 ${!param.enabled ? 'opacity-50' : ''}`}>
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: param.color }}
                              />
                              <span className="text-xs font-medium" style={{ color: param.color }}>
                                {param.label || param.key}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono">type: "{param.key}"</span>
                              {!param.enabled && (
                                <span className="text-xs text-muted-foreground ml-auto italic">отключён — не попадёт в промпт</span>
                              )}
                              {param.enabled && (
                                <span className="text-xs text-muted-foreground ml-auto">
                                  секция {form.parameters.slice(0, idx + 1).filter(p => p.enabled).length} в промпте
                                </span>
                              )}
                            </div>
                            <Textarea
                              value={param.promptText ?? ''}
                              onChange={e => updateParameter(idx, { promptText: e.target.value })}
                              className="font-mono text-xs min-h-[100px] resize-y bg-background"
                              placeholder={DEFAULT_PROMPT_TEXTS[param.key] ?? `Инструкции для поиска артефакта "${param.label}"...`}
                              disabled={!param.enabled}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* ADDITIONAL INSTRUCTIONS button */}
                  <button
                    type="button"
                    onClick={() => setShowAdditional(v => !v)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                      showAdditional
                        ? 'border-amber-400/60 bg-amber-50/50 text-amber-700 dark:bg-amber-950/20 dark:text-amber-400'
                        : 'border-dashed border-muted-foreground/40 text-muted-foreground hover:border-amber-400/40 hover:text-foreground'
                    }`}
                  >
                    <AlignLeft className="h-3.5 w-3.5 shrink-0" />
                    <span className="font-medium flex-1 text-left">Дополнительные инструкции</span>
                    <span className="text-xs opacity-60">{showAdditional ? 'Свернуть' : 'Конец промпта'}</span>
                    {showAdditional ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
                  </button>

                  {showAdditional && (
                    <div className="rounded-lg border border-amber-400/30 bg-amber-50/30 dark:bg-amber-950/10 p-3 space-y-1.5">
                      <div className="flex items-center gap-2 mb-1">
                        <AlignLeft className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Дополнительные инструкции</span>
                        <span className="text-xs text-muted-foreground ml-auto">конец промпта</span>
                      </div>
                      <Textarea
                        value={form.additionalInstructions}
                        onChange={e => setForm(f => ({ ...f, additionalInstructions: e.target.value }))}
                        className="font-mono text-xs min-h-[80px] resize-y bg-background"
                        placeholder="Дополнительные инструкции для ИИ (формат ответа, ограничения и т.д.)..."
                      />
                    </div>
                  )}
                </div>

                {/* PROMPT PREVIEW */}
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setShowPreview(v => !v)}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    {showPreview ? 'Скрыть итоговый промпт' : 'Показать итоговый промпт'}
                  </button>
                  {showPreview && (
                    <Textarea
                      value={builtPrompt}
                      readOnly
                      className="font-mono text-xs min-h-[200px] resize-y bg-muted/30 text-muted-foreground cursor-default"
                    />
                  )}
                </div>

              </div>
            </div>

            <div className="px-6 py-3 border-t flex items-center justify-end gap-2 shrink-0">
              <Button variant="outline" onClick={() => setView('list')}>Отмена</Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
