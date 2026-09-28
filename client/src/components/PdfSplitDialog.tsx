import { useState, useEffect, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Trash2, Scissors, FileText, CheckCircle2, AlertCircle, Copy } from 'lucide-react';

interface Range {
  id: string;
  start: number;
  end: number;
  name: string;
}

interface SplitResult {
  id: string;
  filename: string;
  pageCount: number;
}

type Mode = 'custom' | 'equal' | 'every';

interface Props {
  fileId: string;
  fileName: string;
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSplitDone?: (newFileIds: string[]) => void;
  currentPage?: number;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function buildRanges(mode: Mode, totalPages: number, count: number): Range[] {
  if (totalPages < 1 || count < 1) return [];

  if (mode === 'equal') {
    const size  = Math.ceil(totalPages / count);
    const parts = Math.ceil(totalPages / size);
    return Array.from({ length: parts }, (_, i) => ({
      id:    generateId(),
      start: i * size + 1,
      end:   Math.min((i + 1) * size, totalPages),
      name:  `часть_${i + 1}`,
    }));
  }

  if (mode === 'every') {
    const parts = Math.ceil(totalPages / count);
    return Array.from({ length: parts }, (_, i) => ({
      id:    generateId(),
      start: i * count + 1,
      end:   Math.min((i + 1) * count, totalPages),
      name:  `часть_${i + 1}`,
    }));
  }

  return [];
}

export function PdfSplitDialog({ fileId, fileName, documentId, open, onOpenChange, onSplitDone, currentPage }: Props) {
  const { toast } = useToast();
  const [mode, setMode]         = useState<Mode>('custom');
  const [ranges, setRanges]     = useState<Range[]>([]);
  const [count, setCount]       = useState(2);
  const [done, setDone]         = useState(false);
  const [results, setResults]   = useState<SplitResult[]>([]);

  // Fetch page count
  const pageCountQuery = useQuery<{ pageCount: number }>({
    queryKey: [`/api/mbt/files/${fileId}/page-count`],
    queryFn: async () => {
      const r = await fetch(`/api/mbt/files/${fileId}/page-count`, { credentials: 'include' });
      return r.json();
    },
    enabled: open && !!fileId,
  });
  const totalPages = pageCountQuery.data?.pageCount ?? 0;

  // Initialize default range when page count loads
  useEffect(() => {
    if (!open) { setDone(false); setResults([]); return; }
    setDone(false);
    setResults([]);
    setMode('custom');
    setCount(2);
    setRanges([]);
  }, [open, fileId]);

  useEffect(() => {
    if (!totalPages || mode === 'custom') return;
    setRanges(buildRanges(mode, totalPages, count));
  }, [mode, count, totalPages]);

  useEffect(() => {
    if (mode === 'custom' && ranges.length === 0 && totalPages > 0) {
      setRanges([{
        id: generateId(),
        start: 1,
        end: Math.ceil(totalPages / 2),
        name: 'часть_1',
      }, {
        id: generateId(),
        start: Math.ceil(totalPages / 2) + 1,
        end: totalPages,
        name: 'часть_2',
      }]);
    }
  }, [mode, ranges.length, totalPages]);

  const updateRange = useCallback((id: string, patch: Partial<Range>) => {
    setRanges(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  const addRange = useCallback(() => {
    const last = ranges[ranges.length - 1];
    const start = last ? last.end + 1 : 1;
    setRanges(prev => [...prev, {
      id: generateId(), start, end: Math.min(start + 99, totalPages || start + 99), name: `часть_${prev.length + 1}`,
    }]);
  }, [ranges, totalPages]);

  const removeRange = useCallback((id: string) => {
    setRanges(prev => prev.filter(r => r.id !== id));
  }, []);

  // Validation
  const errors: string[] = [];
  for (const r of ranges) {
    if (!r.name.trim()) errors.push(`Диапазон ${r.start}–${r.end}: нужно название`);
    if (r.start < 1 || (totalPages > 0 && r.start > totalPages)) errors.push(`Диапазон «${r.name}»: начало вне диапазона`);
    if (r.end < r.start) errors.push(`Диапазон «${r.name}»: конец меньше начала`);
    if (totalPages > 0 && r.end > totalPages) errors.push(`Диапазон «${r.name}»: конец вне документа (${totalPages} стр.)`);
  }
  const canSplit = ranges.length >= 1 && errors.length === 0 && !pageCountQuery.isLoading;

  const splitMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/mbt/files/${fileId}/split`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ranges: ranges.map(({ start, end, name }) => ({ start, end, name })),
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || 'Ошибка разбивки');
      }
      return r.json();
    },
    onSuccess: (data) => {
      setDone(true);
      setResults(data.files.map((f: any) => ({
        id: f.id,
        filename: f.filename,
        pageCount: f.pageCount,
      })));
      // Invalidate file lists
      queryClient.invalidateQueries({ queryKey: [`/api/mbt/documents/${documentId}/files`] });
      queryClient.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey.join(',');
        return k.includes('documents-files') || k.includes(documentId);
      }});
      onSplitDone?.(data.files.map((f: any) => f.id));
      toast({ title: `PDF разбит на ${data.files.length} части`, description: `Файлы добавлены в документ` });
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const savePageMutation = useMutation({
    mutationFn: async (page: number) => {
      const baseName = fileName.replace(/\.pdf$/i, '');
      const r = await fetch(`/api/mbt/files/${fileId}/split`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ranges: [{ start: page, end: page, name: `${baseName}_стр${page}` }],
        }),
      });
      if (!r.ok) {
        const err = await r.json();
        throw new Error(err.message || 'Ошибка');
      }
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/mbt/documents/${documentId}/files`] });
      queryClient.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey.join(',');
        return k.includes('documents-files') || k.includes(documentId);
      }});
      onSplitDone?.(data.files.map((f: any) => f.id));
      toast({ title: `Страница ${currentPage} сохранена`, description: data.files[0]?.filename });
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const shortName = fileName.length > 55 ? '…' + fileName.slice(-52) : fileName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl w-full">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Scissors className="h-4 w-4" />
            Разделить PDF
          </DialogTitle>
          <DialogDescription className="truncate text-xs" title={fileName}>
            {shortName}
            {totalPages > 0 && <span className="ml-2 font-medium text-foreground">{totalPages} стр.</span>}
            {pageCountQuery.isLoading && <Loader2 className="inline h-3 w-3 animate-spin ml-1" />}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          // ── Success state ─────────────────────────────────────────────────
          <div className="py-2 space-y-3">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span className="font-medium">Разбивка выполнена — {results.length} файлов</span>
            </div>
            <ScrollArea className="max-h-52">
              <div className="space-y-1 pr-2">
                {results.map(f => (
                  <div key={f.id} className="flex items-center gap-2 text-sm py-1 px-2 rounded bg-muted/50">
                    <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">{f.filename}</span>
                    <Badge variant="secondary" className="ml-auto shrink-0 text-xs">{f.pageCount} стр.</Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">Файлы добавлены в тот же документ и видны в списке слева.</p>
          </div>
        ) : (
          // ── Config state ──────────────────────────────────────────────────
          <div className="space-y-4 py-1">
            {/* Mode selector */}
            <div className="space-y-1.5">
              <Label>Режим разбивки</Label>
              <Select value={mode} onValueChange={v => { setMode(v as Mode); if (v !== 'custom') setRanges([]); }}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Вручную (задать диапазоны)</SelectItem>
                  <SelectItem value="equal">На равные части</SelectItem>
                  <SelectItem value="every">Каждые N страниц</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Count input for equal/every modes */}
            {(mode === 'equal' || mode === 'every') && (
              <div className="flex items-center gap-3">
                <Label className="shrink-0">
                  {mode === 'equal' ? 'Количество частей' : 'Страниц в части'}
                </Label>
                <Input
                  type="number"
                  min={1}
                  max={mode === 'equal' ? (totalPages || 999) : (totalPages || 999)}
                  value={count}
                  onChange={e => setCount(Math.max(1, parseInt(e.target.value) || 1))}
                  className="w-24"
                />
                {totalPages > 0 && mode === 'equal' && (
                  <span className="text-xs text-muted-foreground">≈ {Math.ceil(totalPages / count)} стр./часть</span>
                )}
                {totalPages > 0 && mode === 'every' && (
                  <span className="text-xs text-muted-foreground">→ {Math.ceil(totalPages / count)} частей</span>
                )}
              </div>
            )}

            {/* Range list */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>
                  Части
                  {ranges.length > 0 && (
                    <Badge variant="secondary" className="ml-2">{ranges.length}</Badge>
                  )}
                </Label>
                {mode === 'custom' && (
                  <Button size="sm" variant="outline" onClick={addRange} className="h-7 text-xs gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    Добавить
                  </Button>
                )}
              </div>

              <ScrollArea className="max-h-56">
                <div className="space-y-2 pr-2">
                  {pageCountQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Определяем количество страниц…
                    </div>
                  ) : ranges.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">Нет частей</p>
                  ) : (
                    ranges.map((r, idx) => (
                      <div key={r.id} className="grid grid-cols-[1fr_80px_80px_auto] gap-2 items-center">
                        <Input
                          value={r.name}
                          onChange={e => updateRange(r.id, { name: e.target.value })}
                          placeholder={`часть_${idx + 1}`}
                          className="h-8 text-sm"
                          readOnly={mode !== 'custom'}
                        />
                        <div className="relative">
                          <Input
                            type="number"
                            min={1}
                            max={totalPages || undefined}
                            value={r.start}
                            onChange={e => updateRange(r.id, { start: parseInt(e.target.value) || 1 })}
                            className="h-8 text-sm pl-7"
                            readOnly={mode !== 'custom'}
                          />
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">с</span>
                        </div>
                        <div className="relative">
                          <Input
                            type="number"
                            min={r.start}
                            max={totalPages || undefined}
                            value={r.end}
                            onChange={e => updateRange(r.id, { end: parseInt(e.target.value) || r.start })}
                            className="h-8 text-sm pl-7"
                            readOnly={mode !== 'custom'}
                          />
                          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">по</span>
                        </div>
                        {mode === 'custom' ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => removeRange(r.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground w-8 text-right">
                            {r.end - r.start + 1} стр.
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              {/* Validation errors */}
              {errors.length > 0 && (
                <div className="space-y-1">
                  {errors.map((e, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-destructive">
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {e}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-row justify-end flex-wrap">
          {done ? (
            <Button onClick={() => onOpenChange(false)}>Закрыть</Button>
          ) : (
            <>
              {currentPage && currentPage >= 1 && totalPages > 0 && (
                <Button
                  variant="outline"
                  className="mr-auto"
                  onClick={() => savePageMutation.mutate(currentPage)}
                  disabled={savePageMutation.isPending || splitMutation.isPending}
                  title={`Сохранить страницу ${currentPage} как отдельный файл`}
                >
                  {savePageMutation.isPending ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" />Сохраняем…</>
                  ) : (
                    <><Copy className="h-4 w-4 mr-2" />Сохранить стр. {currentPage}</>
                  )}
                </Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button
                onClick={() => splitMutation.mutate()}
                disabled={!canSplit || splitMutation.isPending}
              >
                {splitMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin mr-2" />Разбиваем…</>
                ) : (
                  <><Scissors className="h-4 w-4 mr-2" />Разделить{ranges.length > 0 ? ` на ${ranges.length}` : ''}</>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
