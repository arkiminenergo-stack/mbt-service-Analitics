import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Lock, Plus, Trash2, Pencil, ChevronRight, Save, X, GripVertical,
  FileText, Tag, Type, CheckSquare, Square, Settings2,
} from 'lucide-react';
import { CHECKLIST_CASE_TYPE_LABELS } from '@shared/schema';
import type { DocChecklistTemplate, DocChecklistItem, ChecklistMatchRule } from '@shared/schema';

interface TemplateWithItems {
  template: DocChecklistTemplate;
  items: DocChecklistItem[];
}

const CASE_TYPE_OPTIONS = [
  { value: 'subsidy', label: 'Субсидия / Грант' },
  { value: 'contract', label: 'Договорной пакет' },
  { value: 'litigation', label: 'Судебное дело' },
  { value: 'audit', label: 'Аудиторская проверка' },
  { value: 'custom', label: 'Пользовательский' },
];

const RULE_TYPE_LABELS: Record<string, string> = {
  filename: 'Имя файла',
  keyword: 'Ключевое слово',
  filetype: 'Расширение',
};

const RULE_TYPE_ICONS: Record<string, typeof FileText> = {
  filename: FileText,
  keyword: Tag,
  filetype: Type,
};

function MatchRuleEditor({
  rules,
  onChange,
  disabled,
}: {
  rules: ChecklistMatchRule[];
  onChange: (rules: ChecklistMatchRule[]) => void;
  disabled?: boolean;
}) {
  const addRule = () => {
    onChange([...rules, { type: 'keyword', value: '' }]);
  };

  const updateRule = (idx: number, patch: Partial<ChecklistMatchRule>) => {
    const next = rules.map((r, i) => i === idx ? { ...r, ...patch } : r);
    onChange(next);
  };

  const removeRule = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-1.5">
      {rules.map((rule, idx) => {
        const Icon = RULE_TYPE_ICONS[rule.type] ?? Tag;
        return (
          <div key={idx} className="flex items-center gap-1.5">
            <Select
              value={rule.type}
              onValueChange={(v) => updateRule(idx, { type: v as ChecklistMatchRule['type'] })}
              disabled={disabled}
            >
              <SelectTrigger className="w-36 h-7 text-xs shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="filename">
                  <span className="flex items-center gap-1.5 text-xs"><FileText className="h-3 w-3" />Имя файла</span>
                </SelectItem>
                <SelectItem value="keyword">
                  <span className="flex items-center gap-1.5 text-xs"><Tag className="h-3 w-3" />Ключевое слово</span>
                </SelectItem>
                <SelectItem value="filetype">
                  <span className="flex items-center gap-1.5 text-xs"><Type className="h-3 w-3" />Расширение</span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={rule.value}
              onChange={(e) => updateRule(idx, { value: e.target.value })}
              placeholder={rule.type === 'filetype' ? 'pdf' : 'введите значение...'}
              className="h-7 text-xs flex-1"
              disabled={disabled}
            />
            {!disabled && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRule(idx)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        );
      })}
      {!disabled && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={addRule}
        >
          <Plus className="h-3 w-3 mr-1" />
          Добавить правило
        </Button>
      )}
      {rules.length === 0 && disabled && (
        <span className="text-xs text-muted-foreground italic">Нет правил</span>
      )}
    </div>
  );
}

interface EditingItem {
  id?: string;
  name: string;
  description?: string;
  isRequired: boolean;
  matchRules: ChecklistMatchRule[];
  alternativeGroupId?: string;
  order: number;
}

function ItemEditorDialog({
  item,
  templateId,
  onClose,
  onSaved,
}: {
  item: EditingItem | null;
  templateId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<EditingItem>(
    item ?? { name: '', isRequired: true, matchRules: [], order: 0 }
  );

  const createItem = useMutation({
    mutationFn: () => apiRequest('POST', `/api/checklist-templates/${templateId}/items`, {
      name: form.name,
      description: form.description || undefined,
      isRequired: form.isRequired,
      matchRules: form.matchRules,
      alternativeGroupId: form.alternativeGroupId || undefined,
      order: form.order,
    }).then(r => r.json()),
    onSuccess: () => { onSaved(); toast({ title: 'Позиция добавлена' }); },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const updateItem = useMutation({
    mutationFn: () => apiRequest('PATCH', `/api/checklist-items/${item!.id}`, {
      name: form.name,
      description: form.description || undefined,
      isRequired: form.isRequired,
      matchRules: form.matchRules,
      alternativeGroupId: form.alternativeGroupId || undefined,
    }).then(r => r.json()),
    onSuccess: () => { onSaved(); toast({ title: 'Позиция сохранена' }); },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const isPending = createItem.isPending || updateItem.isPending;

  const handleSave = () => {
    if (!form.name.trim()) {
      toast({ title: 'Укажите название позиции', variant: 'destructive' });
      return;
    }
    item?.id ? updateItem.mutate() : createItem.mutate();
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{item?.id ? 'Редактировать позицию' : 'Новая позиция'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs mb-1 block">Название позиции <span className="text-destructive">*</span></Label>
            <Input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Например: Договор, Акт выполненных работ..."
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Описание (необязательно)</Label>
            <Textarea
              value={form.description ?? ''}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Пояснение к позиции..."
              rows={2}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="isRequired"
              checked={form.isRequired}
              onCheckedChange={(v) => setForm(f => ({ ...f, isRequired: v }))}
            />
            <Label htmlFor="isRequired" className="text-sm cursor-pointer">
              Обязательный документ
            </Label>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Группа альтернативы (необязательно)</Label>
            <Input
              value={form.alternativeGroupId ?? ''}
              onChange={(e) => setForm(f => ({ ...f, alternativeGroupId: e.target.value }))}
              placeholder="Идентификатор группы (например: ownership)"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Позиции с одинаковым идентификатором считаются взаимозаменяемыми
            </p>
          </div>
          <Separator />
          <div>
            <Label className="text-xs mb-2 block">Правила поиска документа</Label>
            <MatchRuleEditor
              rules={form.matchRules}
              onChange={(rules) => setForm(f => ({ ...f, matchRules: rules }))}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Хотя бы одно совпадение засчитывается как «найден»
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={handleSave} disabled={isPending}>
            <Save className="h-4 w-4 mr-1" />
            {item?.id ? 'Сохранить' : 'Добавить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TemplateEditor({
  templateId,
  onChanged,
}: {
  templateId: string;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [editingItem, setEditingItem] = useState<EditingItem | null | false>(false);
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [descEdit, setDescEdit] = useState<string | null>(null);
  const [caseTypeEdit, setCaseTypeEdit] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery<TemplateWithItems>({
    queryKey: ['/api/checklist-templates', templateId],
    queryFn: () => apiRequest('GET', `/api/checklist-templates/${templateId}`).then(r => r.json()),
  });

  const updateTemplate = useMutation({
    mutationFn: (patch: { name?: string; description?: string; caseType?: string }) =>
      apiRequest('PATCH', `/api/checklist-templates/${templateId}`, patch).then(r => r.json()),
    onSuccess: () => {
      refetch();
      onChanged();
      setNameEdit(null);
      setDescEdit(null);
      setCaseTypeEdit(null);
      toast({ title: 'Шаблон обновлён' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const deleteItem = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/checklist-items/${id}`).then(r => r.json()),
    onSuccess: () => { refetch(); onChanged(); setDeletingItemId(null); toast({ title: 'Позиция удалена' }); },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  if (isLoading || !data) {
    return <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">Загрузка…</div>;
  }

  const { template, items } = data;
  const isBuiltin = template.isBuiltin;

  return (
    <div className="flex flex-col gap-4">
      {/* Template meta */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs mb-1 block">Название шаблона</Label>
          {isBuiltin ? (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{template.name}</span>
              <Lock className="h-3 w-3 text-muted-foreground" />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={nameEdit ?? template.name}
                onChange={(e) => setNameEdit(e.target.value)}
                className="flex-1"
              />
              {nameEdit !== null && nameEdit !== template.name && (
                <Button
                  size="sm"
                  onClick={() => updateTemplate.mutate({ name: nameEdit })}
                  disabled={updateTemplate.isPending}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div>
          <Label className="text-xs mb-1 block">Тип дела</Label>
          {isBuiltin ? (
            <Badge variant="secondary" className="text-xs">
              {CHECKLIST_CASE_TYPE_LABELS[template.caseType] ?? template.caseType}
            </Badge>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                value={caseTypeEdit ?? template.caseType}
                onValueChange={(v) => {
                  setCaseTypeEdit(v);
                  updateTemplate.mutate({ caseType: v });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CASE_TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {template.description && (
          <div>
            <Label className="text-xs mb-1 block">Описание</Label>
            <p className="text-xs text-muted-foreground">{template.description}</p>
          </div>
        )}

        {!isBuiltin && (
          <div>
            <Label className="text-xs mb-1 block">Описание</Label>
            <div className="flex gap-2">
              <Textarea
                value={descEdit ?? (template.description ?? '')}
                onChange={(e) => setDescEdit(e.target.value)}
                rows={2}
                placeholder="Краткое описание шаблона..."
              />
              {descEdit !== null && descEdit !== (template.description ?? '') && (
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() => updateTemplate.mutate({ description: descEdit })}
                  disabled={updateTemplate.isPending}
                >
                  <Save className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      <Separator />

      {/* Items list */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs">
            Позиции комплекта <Badge variant="outline" className="ml-1 text-xs">{items.length}</Badge>
          </Label>
          {!isBuiltin && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => setEditingItem({ name: '', isRequired: true, matchRules: [], order: items.length })}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Добавить
            </Button>
          )}
        </div>

        <div className="space-y-1.5">
          {items.length === 0 && (
            <div className="text-center text-muted-foreground text-xs py-6">
              Нет позиций. Добавьте первую.
            </div>
          )}
          {items.map((item, idx) => (
            <div
              key={item.id}
              className="flex items-start gap-2 p-2 rounded-md border bg-card hover:bg-muted/30 transition-colors"
            >
              {!isBuiltin && (
                <GripVertical className="h-4 w-4 text-muted-foreground/40 mt-0.5 shrink-0 cursor-grab" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-medium">{item.name}</span>
                  {item.isRequired ? (
                    <Badge variant="outline" className="text-xs py-0 px-1">обяз.</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs py-0 px-1">опц.</Badge>
                  )}
                  {item.alternativeGroupId && (
                    <Badge variant="secondary" className="text-xs py-0 px-1 bg-amber-50 text-amber-700 border-amber-200">
                      alt: {item.alternativeGroupId}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {((item.matchRules ?? []) as ChecklistMatchRule[]).slice(0, 3).map((r, ri) => {
                    const Icon = RULE_TYPE_ICONS[r.type] ?? Tag;
                    return (
                      <span key={ri} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                        <Icon className="h-2.5 w-2.5" />
                        {r.value}
                      </span>
                    );
                  })}
                  {((item.matchRules ?? []) as ChecklistMatchRule[]).length > 3 && (
                    <span className="text-xs text-muted-foreground">
                      +{((item.matchRules ?? []) as ChecklistMatchRule[]).length - 3}
                    </span>
                  )}
                  {((item.matchRules ?? []) as ChecklistMatchRule[]).length === 0 && (
                    <span className="text-xs text-muted-foreground italic">нет правил</span>
                  )}
                </div>
              </div>
              {!isBuiltin && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditingItem({
                      id: item.id,
                      name: item.name,
                      description: item.description ?? undefined,
                      isRequired: item.isRequired,
                      matchRules: (item.matchRules ?? []) as ChecklistMatchRule[],
                      alternativeGroupId: item.alternativeGroupId ?? undefined,
                      order: item.order,
                    })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeletingItemId(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Item editor dialog */}
      {editingItem !== false && (
        <ItemEditorDialog
          item={editingItem}
          templateId={templateId}
          onClose={() => setEditingItem(false)}
          onSaved={() => { setEditingItem(false); refetch(); onChanged(); }}
        />
      )}

      {/* Delete item confirm */}
      {deletingItemId && (
        <AlertDialog open onOpenChange={() => setDeletingItemId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить позицию?</AlertDialogTitle>
              <AlertDialogDescription>
                Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteItem.mutate(deletingItemId)}
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

interface CreateTemplateForm {
  name: string;
  description: string;
  caseType: string;
}

function CreateTemplateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState<CreateTemplateForm>({ name: '', description: '', caseType: 'custom' });

  const createTemplate = useMutation({
    mutationFn: () => apiRequest('POST', '/api/checklist-templates', {
      name: form.name,
      description: form.description || undefined,
      caseType: form.caseType,
    }).then(r => r.json()),
    onSuccess: (data: TemplateWithItems) => {
      queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
      toast({ title: 'Шаблон создан' });
      onCreated(data.template.id);
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новый шаблон</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs mb-1 block">Название <span className="text-destructive">*</span></Label>
            <Input
              value={form.name}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Название шаблона..."
              autoFocus
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">Тип дела</Label>
            <Select value={form.caseType} onValueChange={(v) => setForm(f => ({ ...f, caseType: v }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CASE_TYPE_OPTIONS.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Описание</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Краткое описание..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button
            onClick={() => {
              if (!form.name.trim()) {
                toast({ title: 'Укажите название шаблона', variant: 'destructive' });
                return;
              }
              createTemplate.mutate();
            }}
            disabled={createTemplate.isPending}
          >
            <Plus className="h-4 w-4 mr-1" />
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function ChecklistTemplateConfigurator({ open, onClose }: Props) {
  const { toast } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<string | null>(null);

  const { data: templates = [], refetch } = useQuery<DocChecklistTemplate[]>({
    queryKey: ['/api/checklist-templates'],
    queryFn: () => apiRequest('GET', '/api/checklist-templates').then(r => r.json()),
    enabled: open,
  });

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/checklist-templates/${id}`).then(r => r.json()),
    onSuccess: () => {
      refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
      if (deletingTemplateId === selectedId) setSelectedId(null);
      setDeletingTemplateId(null);
      toast({ title: 'Шаблон удалён' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const builtin = templates.filter(t => t.isBuiltin);
  const custom = templates.filter(t => !t.isBuiltin);

  const selectedTemplate = templates.find(t => t.id === selectedId) ?? null;

  return (
    <>
      <Dialog open={open} onOpenChange={() => onClose()}>
        <DialogContent className="max-w-4xl h-[80vh] p-0 gap-0 flex flex-col">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-primary" />
              Конфигуратор шаблонов
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-1 overflow-hidden">
            {/* Left: template list */}
            <div className="w-64 border-r flex flex-col shrink-0">
              <div className="p-3 border-b">
                <Button
                  size="sm"
                  className="w-full"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Новый шаблон
                </Button>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-3">
                  {builtin.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground px-2 mb-1 flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        Встроенные
                      </p>
                      <div className="space-y-0.5">
                        {builtin.map(t => (
                          <button
                            key={t.id}
                            className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors flex items-center gap-2 group ${
                              selectedId === t.id
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-muted'
                            }`}
                            onClick={() => setSelectedId(t.id)}
                          >
                            <Lock className="h-3 w-3 shrink-0 opacity-60" />
                            <span className="flex-1 truncate">{t.name}</span>
                            <ChevronRight className={`h-3 w-3 shrink-0 opacity-0 group-hover:opacity-60 ${selectedId === t.id ? 'opacity-60' : ''}`} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {custom.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground px-2 mb-1">Пользовательские</p>
                      <div className="space-y-0.5">
                        {custom.map(t => (
                          <div
                            key={t.id}
                            className={`flex items-center gap-1 px-2 py-1.5 rounded-md transition-colors group ${
                              selectedId === t.id
                                ? 'bg-primary text-primary-foreground'
                                : 'hover:bg-muted'
                            }`}
                          >
                            <button
                              className="flex-1 text-left text-sm truncate"
                              onClick={() => setSelectedId(t.id)}
                            >
                              {t.name}
                            </button>
                            <button
                              className={`p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100 ${
                                selectedId === t.id
                                  ? 'hover:bg-primary-foreground/20'
                                  : 'hover:text-destructive'
                              }`}
                              onClick={(e) => { e.stopPropagation(); setDeletingTemplateId(t.id); }}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {templates.length === 0 && (
                    <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                      Загрузка...
                    </p>
                  )}
                </div>
              </ScrollArea>
            </div>

            {/* Right: editor */}
            <div className="flex-1 overflow-hidden">
              {!selectedId ? (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
                  <Settings2 className="h-10 w-10 opacity-20" />
                  <p className="text-sm">Выберите шаблон для просмотра или редактирования</p>
                  <p className="text-xs opacity-60">Встроенные шаблоны доступны только для просмотра</p>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="p-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge variant={selectedTemplate?.isBuiltin ? 'secondary' : 'outline'} className="text-xs">
                        {selectedTemplate?.isBuiltin ? (
                          <span className="flex items-center gap-1"><Lock className="h-3 w-3" />Встроенный</span>
                        ) : (
                          'Пользовательский'
                        )}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {CHECKLIST_CASE_TYPE_LABELS[selectedTemplate?.caseType ?? ''] ?? 'Пользовательский'}
                      </Badge>
                    </div>
                    <TemplateEditor
                      key={selectedId}
                      templateId={selectedId}
                      onChanged={() => {
                        refetch();
                        queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
                      }}
                    />
                  </div>
                </ScrollArea>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {showCreate && (
        <CreateTemplateDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            refetch();
            setSelectedId(id);
          }}
        />
      )}

      {deletingTemplateId && (
        <AlertDialog open onOpenChange={() => setDeletingTemplateId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить шаблон?</AlertDialogTitle>
              <AlertDialogDescription>
                Все позиции шаблона будут удалены. Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteTemplate.mutate(deletingTemplateId)}
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
