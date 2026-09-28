import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { useToast } from '@/hooks/use-toast';
import {
  CheckCircle2, XCircle, AlertCircle, Loader2, Play, ChevronDown, ChevronRight,
  FileSearch, GitCompare, ClipboardCheck, Info, MinusCircle, Settings2, Download,
  Pencil, UserCheck, Clock, CheckSquare, History, RotateCcw,
} from 'lucide-react';
import { CHECKLIST_CASE_TYPE_LABELS, DOC_CONCLUSION_STATUS_LABELS } from '@shared/schema';
import type { DocConclusion, CompletenessResultItem, CrossCheckResultItem, ManualOverride } from '@shared/schema';
import { ChecklistTemplateConfigurator } from './ChecklistTemplateConfigurator';

interface Template { id: string; name: string; caseType: string; isBuiltin: boolean; }
interface ProjectCheckTabProps { projectId: string; }

const STATUS_CONFIG = {
  approved: { label: 'Одобрено', color: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle2, iconColor: 'text-green-600' },
  revision: { label: 'Требует доработки', color: 'bg-amber-100 text-amber-800 border-amber-300', icon: AlertCircle, iconColor: 'text-amber-600' },
  rejected: { label: 'Отказано', color: 'bg-red-100 text-red-800 border-red-300', icon: XCircle, iconColor: 'text-red-600' },
  pending: { label: 'На рассмотрении', color: 'bg-blue-100 text-blue-800 border-blue-300', icon: Info, iconColor: 'text-blue-600' },
};

const COMPLETENESS_STATUS = {
  found: { label: 'Найден', icon: CheckCircle2, color: 'text-green-600' },
  missing: { label: 'Отсутствует', icon: XCircle, color: 'text-red-600' },
  alternative_found: { label: 'Альтернатива', icon: MinusCircle, color: 'text-amber-600' },
};

const CROSS_STATUS = {
  match: { label: 'Совпадает', icon: CheckCircle2, color: 'text-green-600' },
  mismatch: { label: 'Расхождение', icon: AlertCircle, color: 'text-red-600' },
  missing: { label: 'Не найдено', icon: MinusCircle, color: 'text-muted-foreground' },
};

const OVERRIDE_STATUS_OPTIONS = [
  { value: 'auto', label: 'Авто (не переопределено)' },
  { value: 'found', label: 'Найден (вручную)' },
  { value: 'missing', label: 'Отсутствует (вручную)' },
  { value: 'not_applicable', label: 'Не применимо' },
];

// ── Item override popover ─────────────────────────────────────────────────────
function ItemOverridePopover({
  item,
  override,
  onSave,
  disabled,
}: {
  item: CompletenessResultItem;
  override?: ManualOverride;
  onSave: (ov: ManualOverride | null) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string>(override?.status ?? 'auto');
  const [note, setNote] = useState(override?.note ?? '');

  const handleSave = () => {
    if (status === 'auto') {
      onSave(null);
    } else {
      onSave({ itemId: item.itemId, status: status as ManualOverride['status'], note: note || undefined });
    }
    setOpen(false);
  };

  const hasOverride = !!override;

  return (
    <Popover open={open} onOpenChange={(v) => {
      if (v) {
        setStatus(override?.status ?? 'auto');
        setNote(override?.note ?? '');
      }
      setOpen(v);
    }}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`h-6 w-6 shrink-0 ${hasOverride ? 'text-blue-600' : 'text-muted-foreground opacity-0 group-hover:opacity-100'}`}
          disabled={disabled}
          title={hasOverride ? 'Есть переопределение' : 'Переопределить статус'}
        >
          {hasOverride ? <UserCheck className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="end">
        <div className="space-y-3">
          <p className="text-xs font-medium">{item.itemName}</p>
          <div>
            <Label className="text-xs mb-1 block">Статус рецензента</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OVERRIDE_STATUS_OPTIONS.map(o => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Примечание</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Необязательный комментарий..."
              rows={2}
              className="text-xs"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={handleSave}>Сохранить</Button>
            {hasOverride && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { onSave(null); setOpen(false); }}>
                <RotateCcw className="h-3 w-3 mr-1" />
                Сброс
              </Button>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Reviewer sign-off panel ───────────────────────────────────────────────────
function ReviewerPanel({
  conclusion,
  projectId,
  onUpdated,
}: {
  conclusion: DocConclusion;
  projectId: string;
  onUpdated: () => void;
}) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(!conclusion.isReviewed);
  const [finalStatus, setFinalStatus] = useState<string>(conclusion.finalStatus ?? conclusion.status);
  const [reviewerNote, setReviewerNote] = useState(conclusion.reviewerNote ?? '');

  const updateMutation = useMutation({
    mutationFn: (patch: Record<string, any>) =>
      apiRequest('PATCH', `/api/mbt/conclusions/${conclusion.id}`, patch).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusion'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusions'] });
      onUpdated();
      toast({ title: conclusion.isReviewed ? 'Верификация снята' : 'Заключение верифицировано' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const handleSign = () => {
    updateMutation.mutate({
      finalStatus,
      reviewerNote: reviewerNote || null,
      isReviewed: true,
    });
  };

  const handleUnsign = () => {
    updateMutation.mutate({ isReviewed: false });
  };

  return (
    <Card className={conclusion.isReviewed ? 'border-blue-200 bg-blue-50/30' : 'border-dashed'}>
      <CardHeader className="pb-2 pt-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <CardTitle className="text-sm flex items-center gap-2">
          <UserCheck className={`h-4 w-4 ${conclusion.isReviewed ? 'text-blue-600' : 'text-muted-foreground'}`} />
          Верификация рецензента
          {conclusion.isReviewed && (
            <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs ml-1">
              Подписано
            </Badge>
          )}
          <div className="ml-auto">
            {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          </div>
        </CardTitle>
      </CardHeader>
      {expanded && (
        <CardContent className="pt-0 space-y-3">
          {conclusion.isReviewed && conclusion.reviewedAt && (
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Верифицировано {new Date(conclusion.reviewedAt).toLocaleString('ru-RU')}
            </div>
          )}
          <div>
            <Label className="text-xs mb-1 block">Итоговый статус рецензента</Label>
            <Select value={finalStatus} onValueChange={setFinalStatus} disabled={conclusion.isReviewed}>
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">✅ Одобрено</SelectItem>
                <SelectItem value="revision">⚠️ Требует доработки</SelectItem>
                <SelectItem value="rejected">❌ Отказано</SelectItem>
                <SelectItem value="pending">🕐 На рассмотрении</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Примечание</Label>
            <Textarea
              value={reviewerNote}
              onChange={(e) => setReviewerNote(e.target.value)}
              placeholder="Комментарий рецензента к заключению..."
              rows={3}
              disabled={conclusion.isReviewed}
            />
          </div>
          <div className="flex gap-2">
            {!conclusion.isReviewed ? (
              <Button
                size="sm"
                className="flex-1"
                onClick={handleSign}
                disabled={updateMutation.isPending}
              >
                {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <UserCheck className="h-3.5 w-3.5 mr-1" />}
                Подписать заключение
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={handleSign}
                disabled={updateMutation.isPending}
              >
                Обновить статус/примечание
              </Button>
            )}
            {conclusion.isReviewed && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={handleUnsign}
                disabled={updateMutation.isPending}
              >
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Снять
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── History entry ─────────────────────────────────────────────────────────────
function HistoryEntry({
  c,
  isCurrent,
  onExport,
  onSelect,
}: {
  c: DocConclusion;
  isCurrent: boolean;
  onExport: () => void;
  onSelect: () => void;
}) {
  const effectiveStatus = (c.finalStatus ?? c.status) as keyof typeof STATUS_CONFIG;
  const cfg = STATUS_CONFIG[effectiveStatus] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;

  return (
    <div
      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/30 transition-colors ${isCurrent ? 'border-primary/40 bg-primary/5' : ''}`}
      onClick={onSelect}
    >
      <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${cfg.iconColor}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-xs font-medium ${cfg.iconColor}`}>
            {DOC_CONCLUSION_STATUS_LABELS[effectiveStatus] ?? effectiveStatus}
          </span>
          {isCurrent && <Badge variant="outline" className="text-xs py-0 px-1">текущая</Badge>}
          {c.isReviewed && (
            <Badge className="bg-blue-100 text-blue-800 text-xs py-0 px-1 border-blue-200">
              <UserCheck className="h-2.5 w-2.5 mr-0.5" />верифицировано
            </Badge>
          )}
          {c.finalStatus && c.finalStatus !== c.status && (
            <Badge variant="secondary" className="text-xs py-0 px-1">статус изменён</Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(c.createdAt).toLocaleString('ru-RU')}
          </span>
          {(c.completenessResult as any[])?.length > 0 && (
            <span>{c.completenessScore}% комплектность</span>
          )}
          {(c.criticalIssues ?? 0) > 0 && (
            <span className="text-red-600">{c.criticalIssues} крит.</span>
          )}
        </div>
        {c.reviewerNote && (
          <p className="text-xs text-muted-foreground mt-1 italic line-clamp-1">«{c.reviewerNote}»</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={(e) => { e.stopPropagation(); onExport(); }}
        title="Экспорт в XLSX"
      >
        <Download className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function ProjectCheckTab({ projectId }: ProjectCheckTabProps) {
  const { toast } = useToast();
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('none');
  const [expandedCross, setExpandedCross] = useState<Set<string>>(new Set());
  const [configuratorOpen, setConfiguratorOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [viewingConclusionId, setViewingConclusionId] = useState<string | null>(null);

  const { data: templates = [], isLoading: templatesLoading } = useQuery<Template[]>({
    queryKey: ['/api/checklist-templates'],
    queryFn: () => apiRequest('GET', '/api/checklist-templates').then(r => r.json()),
  });

  const { data: latestConclusion, isLoading: conclusionLoading } = useQuery<DocConclusion | null>({
    queryKey: ['/api/mbt/projects', projectId, 'conclusion'],
    queryFn: () => apiRequest('GET', `/api/mbt/projects/${projectId}/conclusion`).then(r => r.json()),
  });

  const { data: historyList = [] } = useQuery<DocConclusion[]>({
    queryKey: ['/api/mbt/projects', projectId, 'conclusions'],
    queryFn: () => apiRequest('GET', `/api/mbt/projects/${projectId}/conclusions`).then(r => r.json()),
    enabled: !!latestConclusion,
  });

  // Determine which conclusion to display (latest or a selected historical one)
  const { data: viewingConclusion } = useQuery<DocConclusion>({
    queryKey: ['/api/mbt/conclusions', viewingConclusionId],
    queryFn: () => apiRequest('GET', `/api/mbt/conclusions/${viewingConclusionId}`).then(r => r.json()),
    enabled: !!viewingConclusionId,
  });

  const displayConclusion: DocConclusion | null | undefined = viewingConclusionId
    ? (viewingConclusion ?? null)
    : latestConclusion;

  const checkMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/mbt/projects/${projectId}/check`, {
      templateId: selectedTemplateId === 'none' ? undefined : selectedTemplateId,
    }).then(r => r.json()),
    onSuccess: (data: DocConclusion) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusion'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusions'] });
      setViewingConclusionId(null);
      toast({ title: 'Проверка завершена' });
    },
    onError: (e: any) => toast({ title: 'Ошибка проверки', description: e.message, variant: 'destructive' }),
  });

  const overrideMutation = useMutation({
    mutationFn: (overrides: ManualOverride[]) =>
      apiRequest('PATCH', `/api/mbt/conclusions/${displayConclusion!.id}`, {
        manualOverrides: overrides,
      }).then(r => r.json()),
    onSuccess: (data: DocConclusion) => {
      if (viewingConclusionId) {
        queryClient.setQueryData(['/api/mbt/conclusions', viewingConclusionId], data);
      } else {
        queryClient.setQueryData(['/api/mbt/projects', projectId, 'conclusion'], data);
      }
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusions'] });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const handleExport = async (conclusionId?: string) => {
    const id = conclusionId ?? displayConclusion?.id;
    if (!id) return;
    setExporting(id);
    try {
      const url = conclusionId
        ? `/api/mbt/conclusions/${id}/export`
        : `/api/mbt/projects/${projectId}/conclusion/export`;
      const resp = await apiRequest('GET', url);
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).message ?? 'Ошибка экспорта');
      const blob = await resp.blob();
      const cd = resp.headers.get('Content-Disposition') ?? '';
      const match = cd.match(/filename\*=UTF-8''([^;]+)/);
      const filename = match ? decodeURIComponent(match[1]) : `conclusion.xlsx`;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl; a.download = filename; a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e: any) {
      toast({ title: 'Ошибка экспорта', description: e.message, variant: 'destructive' });
    } finally {
      setExporting(null);
    }
  };

  const handleOverride = (item: CompletenessResultItem, override: ManualOverride | null) => {
    if (!displayConclusion) return;
    const current = (displayConclusion.manualOverrides ?? []) as ManualOverride[];
    let next: ManualOverride[];
    if (override === null) {
      next = current.filter(o => o.itemId !== item.itemId);
    } else {
      const idx = current.findIndex(o => o.itemId === item.itemId);
      if (idx >= 0) {
        next = current.map((o, i) => i === idx ? override : o);
      } else {
        next = [...current, override];
      }
    }
    overrideMutation.mutate(next);
  };

  const isCurrentConclusion = !viewingConclusionId || viewingConclusionId === latestConclusion?.id;
  const statusCfg = displayConclusion
    ? STATUS_CONFIG[((displayConclusion.finalStatus ?? displayConclusion.status) as keyof typeof STATUS_CONFIG)] ?? STATUS_CONFIG.pending
    : null;
  const StatusIcon = statusCfg?.icon;

  const completeness = (displayConclusion?.completenessResult ?? []) as CompletenessResultItem[];
  const crossCheck = (displayConclusion?.crossCheckResult ?? []) as CrossCheckResultItem[];
  const manualOverrides = (displayConclusion?.manualOverrides ?? []) as ManualOverride[];

  const mismatches = crossCheck.filter(c => c.status === 'mismatch');
  const missingRequired = completeness.filter(i => i.isRequired && i.status === 'missing');

  const effectiveCompleteness = useMemo(() => {
    return completeness.map(item => {
      const ov = manualOverrides.find(o => o.itemId === item.itemId);
      if (ov) return { ...item, _overrideStatus: ov.status, _overrideNote: ov.note };
      return item;
    });
  }, [completeness, manualOverrides]);

  return (
    <>
      <div className="flex flex-col h-full gap-0 overflow-hidden">
        <Tabs defaultValue="check" className="flex flex-col h-full overflow-hidden">
          <div className="flex items-center gap-2 px-0 pb-3 shrink-0">
            <TabsList className="h-8">
              <TabsTrigger value="check" className="text-xs h-7">
                <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                Проверка
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs h-7">
                <History className="h-3.5 w-3.5 mr-1" />
                История
                {historyList.length > 0 && (
                  <Badge variant="secondary" className="ml-1 text-xs py-0 px-1 h-4">{historyList.length}</Badge>
                )}
              </TabsTrigger>
            </TabsList>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-7 text-xs text-muted-foreground"
              onClick={() => setConfiguratorOpen(true)}
            >
              <Settings2 className="h-3.5 w-3.5 mr-1" />
              Шаблоны
            </Button>
          </div>

          {/* ── Check tab ── */}
          <TabsContent value="check" className="flex-1 overflow-hidden flex flex-col gap-4 mt-0">
            {/* Run check panel */}
            <Card className="shrink-0">
              <CardContent className="pt-4 pb-3">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <label className="text-xs text-muted-foreground mb-1 block">Шаблон комплекта</label>
                    {templatesLoading ? (
                      <div className="h-9 bg-muted animate-pulse rounded-md" />
                    ) : (
                      <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Выберите шаблон (или без шаблона)" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Без шаблона (только сверка реквизитов)</SelectItem>
                          {templates.map(t => (
                            <SelectItem key={t.id} value={t.id}>
                              <span className="flex items-center gap-2">
                                <span className="text-muted-foreground text-xs">
                                  {CHECKLIST_CASE_TYPE_LABELS[t.caseType] ?? t.caseType}
                                </span>
                                <span>{t.name}</span>
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {displayConclusion && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExport()}
                        disabled={!!exporting}
                        className="h-9"
                        title="Экспорт текущего заключения в XLSX"
                      >
                        {exporting === displayConclusion.id ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        ) : (
                          <Download className="h-4 w-4 mr-2" />
                        )}
                        XLSX
                      </Button>
                    )}
                    <Button
                      onClick={() => checkMutation.mutate()}
                      disabled={checkMutation.isPending}
                      className="h-9"
                    >
                      {checkMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Play className="h-4 w-4 mr-2" />
                      )}
                      Запустить проверку
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Viewing historical run banner */}
            {viewingConclusionId && !isCurrentConclusion && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-800">
                <History className="h-3.5 w-3.5 shrink-0" />
                <span>Просмотр исторической проверки</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-6 text-xs text-amber-800 hover:text-amber-900 px-2"
                  onClick={() => setViewingConclusionId(null)}
                >
                  К текущей
                </Button>
              </div>
            )}

            {conclusionLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : !displayConclusion ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <FileSearch className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Проверка ещё не запускалась</p>
                  <p className="text-xs mt-1">Выберите шаблон и нажмите «Запустить проверку»</p>
                  <Button
                    variant="link"
                    size="sm"
                    className="mt-2 text-xs text-muted-foreground"
                    onClick={() => setConfiguratorOpen(true)}
                  >
                    <Settings2 className="h-3.5 w-3.5 mr-1" />
                    Настроить шаблоны
                  </Button>
                </div>
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <div className="flex flex-col gap-4 pr-2">

                  {/* Verdict card */}
                  <Card className={`border ${statusCfg?.color ?? ''}`}>
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-start gap-3">
                        {StatusIcon && <StatusIcon className={`h-6 w-6 shrink-0 mt-0.5 ${statusCfg?.iconColor}`} />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-base">
                              {DOC_CONCLUSION_STATUS_LABELS[(displayConclusion.finalStatus ?? displayConclusion.status)] ?? displayConclusion.status}
                            </span>
                            {displayConclusion.finalStatus && displayConclusion.finalStatus !== displayConclusion.status && (
                              <Badge variant="secondary" className="text-xs">изменён рецензентом</Badge>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {new Date(displayConclusion.createdAt).toLocaleString('ru-RU')}
                            </span>
                          </div>
                          <div className="flex items-center gap-4 mt-2 flex-wrap text-sm">
                            {completeness.length > 0 && (
                              <span className="flex items-center gap-1">
                                <span className="font-medium">{displayConclusion.completenessScore}%</span>
                                <span className="text-muted-foreground">комплектность</span>
                              </span>
                            )}
                            {(displayConclusion.criticalIssues ?? 0) > 0 && (
                              <span className="flex items-center gap-1 text-red-700">
                                <XCircle className="h-3.5 w-3.5" />
                                <span className="font-medium">{displayConclusion.criticalIssues}</span>
                                <span>крит.</span>
                              </span>
                            )}
                            {(displayConclusion.nonCriticalIssues ?? 0) > 0 && (
                              <span className="flex items-center gap-1 text-amber-700">
                                <AlertCircle className="h-3.5 w-3.5" />
                                <span className="font-medium">{displayConclusion.nonCriticalIssues}</span>
                                <span>некрит.</span>
                              </span>
                            )}
                            {(displayConclusion.criticalIssues ?? 0) === 0 && (displayConclusion.nonCriticalIssues ?? 0) === 0 && completeness.length > 0 && (
                              <span className="flex items-center gap-1 text-green-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span>Замечаний не выявлено</span>
                              </span>
                            )}
                            {manualOverrides.length > 0 && (
                              <span className="flex items-center gap-1 text-blue-700">
                                <UserCheck className="h-3.5 w-3.5" />
                                <span>{manualOverrides.length} переопред.</span>
                              </span>
                            )}
                          </div>
                          {displayConclusion.isReviewed && displayConclusion.reviewerNote && (
                            <p className="mt-2 text-xs text-muted-foreground italic">
                              «{displayConclusion.reviewerNote}»
                            </p>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Completeness section */}
                  {completeness.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <FileSearch className="h-4 w-4 text-muted-foreground" />
                          Проверка полноты комплекта
                          <div className="ml-auto flex items-center gap-2">
                            {manualOverrides.length > 0 && (
                              <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs">
                                {manualOverrides.length} вручную
                              </Badge>
                            )}
                            <Badge variant="outline" className="text-xs">
                              {completeness.filter(i => i.status === 'found').length} / {completeness.length}
                            </Badge>
                            {missingRequired.length > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                {missingRequired.length} обяз. отсутствуют
                              </Badge>
                            )}
                          </div>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="space-y-1">
                          {effectiveCompleteness.map(item => {
                            const ov = manualOverrides.find(o => o.itemId === item.itemId);
                            const displayStatus = (ov?.status ?? item.status) as keyof typeof COMPLETENESS_STATUS;
                            const cfg = COMPLETENESS_STATUS[displayStatus] ?? COMPLETENESS_STATUS.missing;
                            const Icon = cfg.icon;
                            const isOverridden = !!ov;
                            return (
                              <div
                                key={item.itemId}
                                className={`group flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors ${isOverridden ? 'bg-blue-50/50' : ''}`}
                              >
                                <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
                                <div className="flex-1 min-w-0">
                                  <span className={`text-sm ${item.status === 'missing' && item.isRequired && !ov ? 'font-medium text-red-700' : ''}`}>
                                    {item.itemName}
                                  </span>
                                  {(ov?.fileName ?? item.matchedFileName) && (
                                    <span className="text-xs text-muted-foreground ml-2 truncate">
                                      → {ov?.fileName ?? item.matchedFileName}
                                    </span>
                                  )}
                                  {ov?.note && (
                                    <span className="text-xs text-blue-600 ml-2 italic">{ov.note}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {isOverridden && (
                                    <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-xs py-0 px-1">ручное</Badge>
                                  )}
                                  {item.isRequired ? (
                                    <Badge variant="outline" className="text-xs py-0 px-1.5">обяз.</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-xs py-0 px-1.5">опц.</Badge>
                                  )}
                                  <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                                  <ItemOverridePopover
                                    item={item}
                                    override={ov}
                                    onSave={(override) => handleOverride(item, override)}
                                    disabled={overrideMutation.isPending}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Cross-check section */}
                  {crossCheck.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm flex items-center gap-2">
                          <GitCompare className="h-4 w-4 text-muted-foreground" />
                          Сверка реквизитов
                          {mismatches.length > 0 && (
                            <Badge variant="destructive" className="ml-auto text-xs">
                              {mismatches.length} расхождений
                            </Badge>
                          )}
                          {mismatches.length === 0 && (
                            <Badge variant="outline" className="ml-auto text-xs text-green-700 border-green-300">
                              Все совпадают
                            </Badge>
                          )}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <div className="space-y-1">
                          {crossCheck.map(item => {
                            const cfg = CROSS_STATUS[item.status as keyof typeof CROSS_STATUS];
                            const Icon = cfg.icon;
                            const isExpanded = expandedCross.has(item.field);
                            const toggle = () => setExpandedCross(prev => {
                              const n = new Set(prev);
                              n.has(item.field) ? n.delete(item.field) : n.add(item.field);
                              return n;
                            });
                            return (
                              <div key={item.field} className="rounded-md border overflow-hidden">
                                <button
                                  className="w-full flex items-center gap-2 py-1.5 px-2 hover:bg-muted/40 transition-colors text-left"
                                  onClick={toggle}
                                >
                                  <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
                                  <span className="flex-1 text-sm font-medium">{item.fieldLabel}</span>
                                  <span className={`text-xs ${cfg.color}`}>{cfg.label}</span>
                                  {item.status === 'mismatch' && (
                                    <Badge variant="destructive" className="text-xs py-0 px-1.5 ml-1">
                                      {new Set(item.values.map(v => v.value)).size} значений
                                    </Badge>
                                  )}
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 ml-1 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 ml-1 text-muted-foreground" />
                                  )}
                                </button>
                                {isExpanded && (
                                  <div className="border-t bg-muted/20">
                                    {item.values.map((v, idx) => (
                                      <div key={idx} className="flex items-start gap-2 py-1 px-3 border-b last:border-0 text-xs">
                                        <span className="text-muted-foreground shrink-0 w-4 text-right">{idx + 1}.</span>
                                        <span className="font-mono bg-muted/60 px-1 rounded shrink-0">{v.value}</span>
                                        <span className="text-muted-foreground truncate">{v.fileName}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {crossCheck.length === 0 && (
                    <Card>
                      <CardContent className="py-6 text-center text-muted-foreground text-sm">
                        <GitCompare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        Реквизиты не обнаружены. Убедитесь, что документы проанализированы (OCR выполнен).
                      </CardContent>
                    </Card>
                  )}

                  {/* Reviewer panel — only for current/editable conclusions */}
                  {isCurrentConclusion && (
                    <ReviewerPanel
                      conclusion={displayConclusion}
                      projectId={projectId}
                      onUpdated={() => {
                        queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusion'] });
                        queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusions'] });
                      }}
                    />
                  )}

                </div>
              </ScrollArea>
            )}
          </TabsContent>

          {/* ── History tab ── */}
          <TabsContent value="history" className="flex-1 overflow-hidden flex flex-col mt-0">
            {historyList.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <History className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">История пуста</p>
                  <p className="text-xs mt-1">Запустите первую проверку</p>
                </div>
              </div>
            ) : (
              <ScrollArea className="flex-1">
                <div className="space-y-2 pr-2">
                  {historyList.map((c, idx) => (
                    <HistoryEntry
                      key={c.id}
                      c={c}
                      isCurrent={c.id === latestConclusion?.id}
                      onExport={() => handleExport(c.id)}
                      onSelect={() => {
                        setViewingConclusionId(c.id);
                      }}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <ChecklistTemplateConfigurator
        open={configuratorOpen}
        onClose={() => setConfiguratorOpen(false)}
      />
    </>
  );
}
