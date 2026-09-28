import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, X, Download, Hash } from "lucide-react";
import type { ParsingColumn, ParsingMapping } from "@shared/schema";

export type SelectedSpan = {
  text:          string;
  contextBefore: string;
  contextAfter:  string;
  el:            HTMLElement;
};

export type ParseStats = {
  pages:       number;
  docs:        number;
  rows:        number;
  totalAmount: number;
};

export type ParsingResult = {
  rows:  Record<string, string>[];
  stats: ParseStats;
};

interface Props {
  columns:               ParsingColumn[];
  mappings:              ParsingMapping[];
  selectedSpan:          SelectedSpan | null;
  phase:                 'mapping' | 'running' | 'done';
  result:                ParsingResult | null;
  sourceFilename:        string;
  onColumnClick:         (columnId: string) => void;
  onColumnAdd:           () => void;
  onColumnRename:        (id: string, name: string) => void;
  onColumnDelete:        (id: string) => void;
  onColumnNumericToggle: (id: string) => void;
  onMappingRemove:       (columnId: string, spanText: string) => void;
  onSave:                (name: string) => void;
  onRun:                 () => void;
  onReset:               () => void;
  onDownloadXlsx:        () => void;
  bboxMode?:             boolean;
  bboxActiveColumnId?:   string | null;
  canRun?:               boolean;
  pageFrom?:             number;
  pageTo?:               number;
  totalPages?:           number;
  onPageRangeChange?:    (from: number, to: number) => void;
}

export function ParsingModePanel({
  columns, mappings, selectedSpan, phase, result,
  onColumnClick, onColumnAdd, onColumnRename, onColumnDelete,
  onColumnNumericToggle, onMappingRemove, onSave, onRun, onReset, onDownloadXlsx,
  bboxMode = false, bboxActiveColumnId = null, canRun,
  pageFrom = 1, pageTo, totalPages, onPageRangeChange,
}: Props) {
  const [editingColId, setEditingColId] = useState<string | null>(null);
  const [editingName, setEditingName]   = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [templateName, setTemplateName]   = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  const startRename = (col: ParsingColumn) => {
    setEditingColId(col.id);
    setEditingName(col.name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };

  const commitRename = () => {
    if (editingColId && editingName.trim()) {
      onColumnRename(editingColId, editingName.trim());
    }
    setEditingColId(null);
  };

  const handleSaveClick = () => {
    if (!showSaveInput) {
      setShowSaveInput(true);
      setTimeout(() => saveInputRef.current?.focus(), 50);
      return;
    }
    if (templateName.trim()) {
      onSave(templateName.trim());
      setShowSaveInput(false);
      setTemplateName("");
    }
  };

  const formatAmount = (n: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';

  // ── Фаза: running ────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <div className="border-t bg-background px-6 py-5 flex flex-col items-center gap-3 shrink-0">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Обрабатываю документ…</span>
        </div>
        <div className="w-full max-w-md h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary animate-pulse rounded-full" style={{ width: '40%' }} />
        </div>
      </div>
    );
  }

  // ── Фаза: done ───────────────────────────────────────────────────────────
  if (phase === 'done' && result) {
    const { rows, stats } = result;
    return (
      <div className="border-t bg-background flex flex-col shrink-0" style={{ maxHeight: 320 }}>
        <div className="px-4 py-2 border-b flex items-center justify-between flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span><strong className="text-foreground">{stats.pages}</strong> стр.</span>
            <span><strong className="text-foreground">{stats.docs}</strong> документов</span>
            <span><strong className="text-foreground">{stats.rows}</strong> строк</span>
            {stats.totalAmount > 0 && (
              <span>Сумма: <strong className="text-foreground">{formatAmount(stats.totalAmount)}</strong></span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onReset}>← Настроить</Button>
            <Button size="sm" onClick={onDownloadXlsx}>
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Скачать XLSX
            </Button>
          </div>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr>
                <th className="border px-2 py-1.5 text-left font-semibold text-muted-foreground w-8">№</th>
                {columns.map(c => (
                  <th key={c.id} className="border px-2 py-1.5 text-left font-semibold whitespace-nowrap">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="border px-2 py-1 text-muted-foreground">{i + 1}</td>
                  {columns.map(c => (
                    <td key={c.id} className="border px-2 py-1 max-w-[180px] truncate" title={row[c.id]}>
                      {row[c.id] ?? <span className="text-muted-foreground">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Фаза: mapping ────────────────────────────────────────────────────────
  return (
    <div className="border-t bg-background flex flex-col shrink-0 select-none">
      {/* Строка статуса */}
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2 text-sm shrink-0">
        {bboxMode ? (
          bboxActiveColumnId ? (
            <>
              <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
              <span>Поле <strong className="font-mono bg-indigo-50 px-1 rounded">{columns.find(c => c.id === bboxActiveColumnId)?.name ?? bboxActiveColumnId}</strong></span>
              <span className="text-muted-foreground">→ обведите область на PDF</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full border border-muted-foreground/40 shrink-0" />
              <span className="text-muted-foreground">Нажмите на название колонки, затем обведите область на PDF</span>
            </>
          )
        ) : selectedSpan ? (
          <>
            <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
            <span>Выбрано: <strong className="font-mono bg-indigo-50 px-1 rounded">{selectedSpan.text}</strong></span>
            <span className="text-muted-foreground">→ нажмите на название колонки</span>
          </>
        ) : (
          <>
            <span className="w-2 h-2 rounded-full border border-muted-foreground/40 shrink-0" />
            <span className="text-muted-foreground">Выберите значение в документе, затем нажмите название нужной колонки</span>
          </>
        )}
      </div>

      {/* Таблица колонок */}
      <div className="overflow-x-auto shrink-0">
        <table className="border-collapse text-sm" style={{ minWidth: '100%' }}>
          <thead>
            <tr>
              {columns.map(col => {
                const hasMappings = mappings.some(m => m.columnId === col.id);
                const isTarget    = bboxMode ? true : !!selectedSpan;
                const isBboxActive = bboxMode && bboxActiveColumnId === col.id;
                return (
                  <th
                    key={col.id}
                    onClick={() => isTarget && onColumnClick(col.id)}
                    className={[
                      "border px-3 py-2 text-left font-semibold transition-all duration-100",
                      isTarget
                        ? "cursor-pointer hover:ring-2 hover:ring-indigo-400 hover:ring-inset hover:bg-indigo-50"
                        : "cursor-default",
                      isBboxActive
                        ? "bg-indigo-100 dark:bg-indigo-950/50 ring-2 ring-indigo-400 ring-inset"
                        : hasMappings ? "bg-blue-50 dark:bg-blue-950/30" : "bg-muted/50",
                    ].join(" ")}
                    style={{ minWidth: 120, maxWidth: 200 }}
                  >
                    <div className="flex items-center gap-1 group">
                      <button
                        title={col.isNumeric ? "Числовой (нормализация сумм)" : "Текстовый столбец"}
                        onClick={e => { e.stopPropagation(); onColumnNumericToggle(col.id); }}
                        className={`shrink-0 transition-colors ${col.isNumeric ? "text-blue-600" : "text-muted-foreground/25 hover:text-muted-foreground"}`}
                      >
                        <Hash className="h-3 w-3" />
                      </button>

                      {editingColId === col.id ? (
                        <input
                          ref={editInputRef}
                          value={editingName}
                          onChange={e => setEditingName(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setEditingColId(null);
                          }}
                          onClick={e => e.stopPropagation()}
                          className="flex-1 text-sm font-semibold border-b border-indigo-400 outline-none bg-transparent min-w-0"
                        />
                      ) : (
                        <span
                          className="flex-1 truncate"
                          onDoubleClick={e => { e.stopPropagation(); startRename(col); }}
                          title="Двойной клик — переименовать"
                        >
                          {col.name}
                        </span>
                      )}

                      <button
                        onClick={e => { e.stopPropagation(); onColumnDelete(col.id); }}
                        className="shrink-0 text-muted-foreground/20 hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Удалить колонку"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                );
              })}
              <th className="border px-2 py-2 bg-muted/20">
                <button
                  onClick={onColumnAdd}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
                >
                  <Plus className="h-3 w-3" /> Добавить
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              {columns.map(col => (
                <td
                  key={col.id}
                  className="border px-3 py-2 text-sm"
                  style={{ background: col.previewValue ? col.color + '50' : undefined }}
                >
                  {col.previewValue
                    ? <span className="font-medium">{col.previewValue}</span>
                    : <span className="text-muted-foreground/40 italic text-xs">— не задано —</span>
                  }
                </td>
              ))}
              <td className="border px-2 py-2" />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Список активных маппингов */}
      {mappings.length > 0 && (
        <div className="px-4 py-2 border-t bg-muted/10 shrink-0">
          <div className="flex flex-wrap gap-1.5">
            {mappings.map((m, i) => {
              const col = columns.find(c => c.id === m.columnId);
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 font-medium border"
                  style={{ backgroundColor: (col?.color ?? '#e5e7eb') + '60', borderColor: (col?.color ?? '#e5e7eb') }}
                >
                  <span className="text-muted-foreground">{col?.name ?? m.columnId}:</span>
                  <span className="font-mono max-w-[120px] truncate" title={m.spanText}>{m.spanText}</span>
                  <button
                    onClick={() => onMappingRemove(m.columnId, m.spanText)}
                    className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="Убрать маппинг"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Нижняя панель действий */}
      <div className="px-4 py-2.5 border-t bg-muted/20 flex items-center gap-3 flex-wrap shrink-0">
        {/* Диапазон страниц */}
        {onPageRangeChange && totalPages && totalPages > 1 && (
          <div className="flex items-center gap-1.5 text-sm mr-1">
            <span className="text-muted-foreground text-xs">Стр.</span>
            <Input
              type="number"
              min={1}
              max={pageTo ?? totalPages}
              value={pageFrom}
              onChange={e => {
                const v = Math.max(1, Math.min(pageTo ?? totalPages, parseInt(e.target.value) || 1));
                onPageRangeChange(v, Math.max(v, pageTo ?? totalPages));
              }}
              className="h-6 w-14 text-xs px-1.5"
            />
            <span className="text-muted-foreground text-xs">—</span>
            <Input
              type="number"
              min={pageFrom}
              max={totalPages}
              value={pageTo ?? totalPages}
              onChange={e => {
                const v = Math.max(pageFrom, Math.min(totalPages, parseInt(e.target.value) || totalPages));
                onPageRangeChange(pageFrom, v);
              }}
              className="h-6 w-14 text-xs px-1.5"
            />
            <span className="text-muted-foreground text-xs">из {totalPages}</span>
          </div>
        )}

        {showSaveInput ? (
          <div className="flex items-center gap-2">
            <Input
              ref={saveInputRef}
              placeholder="Название шаблона…"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSaveClick();
                if (e.key === 'Escape') { setShowSaveInput(false); setTemplateName(""); }
              }}
              className="h-7 text-sm w-48"
            />
            <Button size="sm" variant="outline" onClick={handleSaveClick} disabled={!templateName.trim()}>
              Сохранить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowSaveInput(false); setTemplateName(""); }}>
              Отмена
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={handleSaveClick}>
            Сохранить шаблон
          </Button>
        )}

        <Button
          size="sm"
          onClick={onRun}
          disabled={canRun !== undefined ? !canRun : mappings.length === 0}
          title={
            canRun !== undefined
              ? (!canRun ? (bboxMode ? "Нарисуйте хотя бы одну зону" : "Укажите хотя бы одно поле") : undefined)
              : (mappings.length === 0 ? "Укажите хотя бы одно поле" : undefined)
          }
        >
          Запустить ▶
        </Button>

        <div className="ml-auto text-xs text-muted-foreground">
          {!bboxMode && mappings.length > 0 && (
            <span>{mappings.length} {mappings.length === 1 ? 'маппинг' : mappings.length < 5 ? 'маппинга' : 'маппингов'} настроено</span>
          )}
        </div>
      </div>
    </div>
  );
}
