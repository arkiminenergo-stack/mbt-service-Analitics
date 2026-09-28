import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, X, Download, Hash, MapPin, Trash2 } from "lucide-react";
import type { ParsingColumn } from "@shared/schema";
import type { BboxZone } from "./BboxZoneOverlay";

export type { BboxZone };

export type BboxParseStats = {
  pages:       number;
  ppPages:     number;
  docs:        number;
  rows:        number;
  totalAmount: number;
};

export type BboxParsingResult = {
  rows:  Record<string, string>[];
  stats: BboxParseStats;
};

interface Props {
  columns:               ParsingColumn[];
  zones:                 BboxZone[];
  activeColumnId:        string | null;
  filterPP:              boolean;
  phase:                 'mapping' | 'running' | 'done';
  result:                BboxParsingResult | null;
  onColumnSelect:        (id: string) => void;
  onColumnAdd:           () => void;
  onColumnRename:        (id: string, name: string) => void;
  onColumnDelete:        (id: string) => void;
  onColumnNumericToggle: (id: string) => void;
  onZoneDelete:          (id: string) => void;
  onFilterPPChange:      (v: boolean) => void;
  onRun:                 () => void;
  onReset:               () => void;
  onSave:                (name: string) => void;
  onDownloadXlsx:        () => void;
}

export function BboxParsingPanel({
  columns, zones, activeColumnId, filterPP, phase, result,
  onColumnSelect, onColumnAdd, onColumnRename, onColumnDelete,
  onColumnNumericToggle, onZoneDelete, onFilterPPChange,
  onRun, onReset, onSave, onDownloadXlsx,
}: Props) {
  const [editingColId, setEditingColId]   = useState<string | null>(null);
  const [editingName, setEditingName]     = useState("");
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
    if (editingColId && editingName.trim()) onColumnRename(editingColId, editingName.trim());
    setEditingColId(null);
  };

  const formatAmount = (n: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';

  const zonesForCol = (colId: string) => zones.filter(z => z.columnId === colId);

  // ── running ────────────────────────────────────────────────────────────────
  if (phase === 'running') {
    return (
      <div className="border-t bg-background px-6 py-5 flex flex-col items-center gap-3 shrink-0">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Обрабатываю зоны…</span>
        </div>
        <div className="w-full max-w-md h-2 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary animate-pulse rounded-full" style={{ width: '60%' }} />
        </div>
      </div>
    );
  }

  // ── done ───────────────────────────────────────────────────────────────────
  if (phase === 'done' && result) {
    const { rows, stats } = result;
    return (
      <div className="border-t bg-background flex flex-col shrink-0" style={{ maxHeight: 320 }}>
        <div className="px-4 py-2 border-b flex items-center justify-between flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span><strong className="text-foreground">{stats.pages}</strong> стр. всего</span>
            {stats.ppPages != null && (
              <span><strong className="text-foreground">{stats.ppPages}</strong> ПП/ПО</span>
            )}
            <span><strong className="text-foreground">{stats.docs}</strong> документов</span>
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
                <th className="border px-2 py-1.5 text-left font-semibold text-muted-foreground w-10">Стр.</th>
                {columns.map(c => (
                  <th key={c.id} className="border px-2 py-1.5 text-left font-semibold whitespace-nowrap">{c.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                  <td className="border px-2 py-1 text-muted-foreground">{i + 1}</td>
                  <td className="border px-2 py-1 text-muted-foreground">{row._page ?? ''}</td>
                  {columns.map(c => (
                    <td key={c.id} className="border px-2 py-1 max-w-[200px] truncate" title={row[c.id]}>
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

  // ── mapping ────────────────────────────────────────────────────────────────
  return (
    <div className="border-t bg-background flex flex-col shrink-0 select-none" style={{ maxHeight: 280 }}>
      {/* Заголовок */}
      <div className="px-4 py-2 border-b bg-indigo-50/60 dark:bg-indigo-950/20 flex items-center gap-2 text-sm shrink-0">
        <MapPin className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
        <span className="text-muted-foreground">
          {activeColumnId
            ? <>Выбрано поле <strong className="text-foreground">{columns.find(c => c.id === activeColumnId)?.name}</strong> — рисуйте зону на странице</>
            : 'Выберите поле ниже, затем обведите его область на странице документа'
          }
        </span>
      </div>

      {/* Список колонок + их зон */}
      <div className="overflow-auto flex-1 px-4 py-2 space-y-1">
        {columns.map(col => {
          const colZones   = zonesForCol(col.id);
          const isActive   = col.id === activeColumnId;
          return (
            <div
              key={col.id}
              className={[
                "rounded-md border transition-all",
                isActive
                  ? "border-indigo-400 ring-1 ring-indigo-300 bg-indigo-50/60 dark:bg-indigo-950/20"
                  : "border-border hover:border-muted-foreground/40 bg-muted/10",
              ].join(" ")}
            >
              <div
                className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                onClick={() => onColumnSelect(col.id === activeColumnId ? '' : col.id)}
              >
                <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: col.color }} />

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
                    className="flex-1 text-sm font-medium border-b border-indigo-400 outline-none bg-transparent"
                  />
                ) : (
                  <span
                    className="flex-1 text-sm font-medium"
                    onDoubleClick={e => { e.stopPropagation(); startRename(col); }}
                    title="Двойной клик — переименовать"
                  >
                    {col.name}
                  </span>
                )}

                <button
                  title={col.isNumeric ? "Числовой" : "Текстовый"}
                  onClick={e => { e.stopPropagation(); onColumnNumericToggle(col.id); }}
                  className={`shrink-0 transition-colors ${col.isNumeric ? "text-blue-600" : "text-muted-foreground/30 hover:text-muted-foreground"}`}
                >
                  <Hash className="h-3 w-3" />
                </button>

                <span className="text-xs text-muted-foreground shrink-0">
                  {colZones.length > 0
                    ? `${colZones.length} зон${colZones.length === 1 ? 'а' : colZones.length < 5 ? 'ы' : ''}`
                    : <span className="italic opacity-50">нет зон</span>
                  }
                </span>

                <button
                  onClick={e => { e.stopPropagation(); onColumnDelete(col.id); }}
                  className="shrink-0 text-muted-foreground/20 hover:text-destructive transition-colors"
                  title="Удалить поле"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>

              {colZones.length > 0 && (
                <div className="px-3 pb-1.5 flex flex-wrap gap-1">
                  {colZones.map(z => (
                    <span
                      key={z.id}
                      className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 border"
                      style={{ backgroundColor: col.color + '30', borderColor: col.color }}
                    >
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {Math.round(z.x * 100)}%,{Math.round(z.y * 100)}%
                        {' '}
                        {Math.round(z.w * 100)}×{Math.round(z.h * 100)}%
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); onZoneDelete(z.id); }}
                        className="text-muted-foreground/40 hover:text-destructive transition-colors"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <button
          onClick={onColumnAdd}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
        >
          <Plus className="h-3 w-3" /> Добавить поле
        </button>
      </div>

      {/* Нижняя панель */}
      <div className="px-4 py-2 border-t bg-muted/20 flex items-center gap-3 flex-wrap shrink-0">
        {/* Фильтр ПП */}
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
          <input
            type="checkbox"
            checked={filterPP}
            onChange={e => onFilterPPChange(e.target.checked)}
            className="rounded"
          />
          Только ПП/ПО страницы
        </label>

        <div className="flex-1" />

        {showSaveInput ? (
          <div className="flex items-center gap-2">
            <Input
              ref={saveInputRef}
              placeholder="Название шаблона…"
              value={templateName}
              onChange={e => setTemplateName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && templateName.trim()) {
                  onSave(templateName.trim());
                  setShowSaveInput(false);
                  setTemplateName("");
                }
                if (e.key === 'Escape') { setShowSaveInput(false); setTemplateName(""); }
              }}
              className="h-7 text-sm w-44"
              autoFocus
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (templateName.trim()) {
                  onSave(templateName.trim());
                  setShowSaveInput(false);
                  setTemplateName("");
                }
              }}
              disabled={!templateName.trim()}
            >
              Сохранить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowSaveInput(false); setTemplateName(""); }}>
              Отмена
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setShowSaveInput(true)} disabled={zones.length === 0}>
            Сохранить шаблон
          </Button>
        )}

        <Button
          size="sm"
          onClick={onRun}
          disabled={zones.length === 0}
          title={zones.length === 0 ? "Нарисуйте хотя бы одну зону" : undefined}
        >
          Запустить ▶
        </Button>
      </div>
    </div>
  );
}
