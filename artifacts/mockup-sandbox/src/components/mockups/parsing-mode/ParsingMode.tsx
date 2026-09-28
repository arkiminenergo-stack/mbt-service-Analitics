import { useState, CSSProperties } from "react";

type FieldChip = {
  id: string;
  label: string;
  value: string;
  color: string;
  bg: string;
  border: string;
};

const FIELDS: FieldChip[] = [
  { id: "f1", label: "Дата", value: "15.06.2026", color: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd" },
  { id: "f2", label: "Номер ПП", value: "№ 1547", color: "#7c3aed", bg: "#ede9fe", border: "#c4b5fd" },
  { id: "f3", label: "Плательщик", value: "ООО «Альфа-Строй»", color: "#0f766e", bg: "#ccfbf1", border: "#5eead4" },
  { id: "f4", label: "Сумма", value: "385 200,00", color: "#b45309", bg: "#fef3c7", border: "#fcd34d" },
  { id: "f5", label: "ИНН плательщика", value: "7704567890", color: "#b91c1c", bg: "#fee2e2", border: "#fca5a5" },
  { id: "f6", label: "Получатель", value: 'ООО «БетонМикс»', color: "#166534", bg: "#dcfce7", border: "#86efac" },
  { id: "f7", label: "Назначение платежа", value: "Оплата по договору №18/2026 от 01.03.2026", color: "#9d174d", bg: "#fce7f3", border: "#f9a8d4" },
  { id: "f8", label: "БИК банка", value: "044525559", color: "#1e3a5f", bg: "#e0f0ff", border: "#7eb8f7" },
];

type Col = { id: string; name: string; fields: string[] };

const COLS0: Col[] = [
  { id: "c1", name: "Дата ПП", fields: [] },
  { id: "c2", name: "Номер ПП", fields: [] },
  { id: "c3", name: "Плательщик", fields: [] },
  { id: "c4", name: "Сумма", fields: [] },
  { id: "c5", name: "Назначение", fields: [] },
];

type Phase = "idle" | "analyzing" | "mapping" | "running" | "done";

export function ParsingMode() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [sel, setSel] = useState<string | null>(null);
  const [cols, setCols] = useState<Col[]>(COLS0);
  const [newName, setNewName] = useState("");
  const [addingCol, setAddingCol] = useState(false);
  const [progress, setProgress] = useState(0);

  const mapped = cols.flatMap(c => c.fields);
  const unmapped = FIELDS.filter(f => !mapped.includes(f.id));
  const getF = (id: string) => FIELDS.find(f => f.id === id)!;

  const analyze = () => {
    setPhase("analyzing");
    setTimeout(() => setPhase("mapping"), 1800);
  };

  const pickField = (id: string) => {
    if (phase !== "mapping") return;
    setSel(p => p === id ? null : id);
  };

  const pickCol = (colId: string) => {
    if (!sel || phase !== "mapping") return;
    setCols(c => c.map(x => x.id === colId && !x.fields.includes(sel) ? { ...x, fields: [...x.fields, sel] } : x));
    setSel(null);
  };

  const removeMap = (colId: string, fId: string) =>
    setCols(c => c.map(x => x.id === colId ? { ...x, fields: x.fields.filter(f => f !== fId) } : x));

  const addCol = () => {
    if (!newName.trim()) return;
    setCols(c => [...c, { id: `c${Date.now()}`, name: newName.trim(), fields: [] }]);
    setNewName(""); setAddingCol(false);
  };

  const run = () => {
    setPhase("running"); let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 10 + 3;
      if (p >= 100) { p = 100; clearInterval(iv); setTimeout(() => setPhase("done"), 400); }
      setProgress(Math.min(100, p));
    }, 160);
  };

  const reset = () => { setPhase("idle"); setSel(null); setCols(COLS0); setProgress(0); };

  const panelOpen = phase !== "idle";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif", background: "#f9fafb" }}>
      {/* Top bar */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontSize: 13, color: "#6b7280" }}>📄</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: "#374151" }}>Платёжное поручение №1547 от 15.06.2026.pdf</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>• стр. 1 из 24</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {phase === "idle" && (
            <button onClick={analyze} style={btn("#7c3aed", "#fff")}>✂ Парсинг</button>
          )}
          {(phase === "mapping" || phase === "analyzing") && (
            <button onClick={reset} style={btn("#6b7280", "#fff", true)}>↺ Сброс</button>
          )}
        </div>
      </div>

      {/* Document area */}
      <div style={{ flex: 1, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 16px", background: "#e5e7eb" }}>
        <DocumentView phase={phase} sel={sel} onPick={pickField} />
      </div>

      {/* Parsing panel */}
      {panelOpen && (
        <div style={{ background: "#fff", borderTop: "2px solid #7c3aed", boxShadow: "0 -4px 16px rgba(0,0,0,0.08)", flexShrink: 0 }}>
          {/* Panel header */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", background: "#faf5ff", borderBottom: "1px solid #e9d5ff" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#6d28d9" }}>✂ Режим парсинга</span>
            {phase === "analyzing" && <Spin text="ИИ анализирует страницу…" />}
            {phase === "mapping" && (
              <>
                <Pill text="Тип: Форма · Ориентация: Книжная" color="#7c3aed" bg="#ede9fe" />
                <span style={{ fontSize: 11, color: "#6d28d9", background: "#ede9fe", padding: "2px 8px", borderRadius: 99, border: "1px solid #c4b5fd" }}>
                  ← Кликните поле, затем колонку
                </span>
                <div style={{ marginLeft: "auto" }}>
                  <button onClick={run} disabled={mapped.length === 0} style={btn("#16a34a", "#fff", false, mapped.length === 0)}>▶ Выполнить</button>
                </div>
              </>
            )}
            {(phase === "running" || phase === "done") && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
                {phase === "running" ? (
                  <>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>Обработка 24 страниц…</span>
                    <div style={{ width: 140, height: 8, background: "#e5e7eb", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${progress}%`, background: "#16a34a", borderRadius: 99, transition: "width 0.2s" }} />
                    </div>
                    <span style={{ fontSize: 11, fontFamily: "monospace", color: "#374151" }}>{Math.round(progress)}%</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ Готово! 24 строки извлечено</span>
                    <button style={btn("#2563eb", "#fff")}>↓ Скачать XLSX</button>
                    <button onClick={reset} style={{ background: "none", border: "none", fontSize: 12, color: "#6b7280", cursor: "pointer", textDecoration: "underline" }}>Заново</button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Panel body */}
          {phase === "analyzing" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, gap: 8, color: "#7c3aed", fontSize: 13 }}>
              <Spin text="Определяем поля, тип документа и ориентацию…" />
            </div>
          )}

          {phase === "mapping" && (
            <div style={{ maxHeight: "40vh", overflow: "auto" }}>
              {/* Found fields */}
              <div style={{ padding: "10px 16px", borderBottom: "1px solid #f3f4f6", background: "#fafafa", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 600, whiteSpace: "nowrap" }}>Найдено полей:</span>
                {unmapped.map(f => (
                  <FieldChipEl key={f.id} f={f} selected={sel === f.id} hasSel={!!sel && sel !== f.id} onClick={() => pickField(f.id)} />
                ))}
                {unmapped.length === 0 && <span style={{ fontSize: 11, color: "#15803d", fontWeight: 500 }}>✓ Все поля распределены</span>}
              </div>

              {/* Columns */}
              <div style={{ padding: "12px 16px", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-start" }}>
                {cols.map(col => (
                  <ColSlot key={col.id} col={col} hasSel={!!sel} onColClick={() => pickCol(col.id)} onRemove={(fId) => removeMap(col.id, fId)} getF={getF} />
                ))}
                {addingCol ? (
                  <div style={{ minWidth: 130, border: "2px dashed #a78bfa", borderRadius: 8, padding: "4px 6px", background: "#faf5ff" }}>
                    <input autoFocus placeholder="Название…" value={newName} onChange={e => setNewName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") addCol(); if (e.key === "Escape") setAddingCol(false); }}
                      style={{ fontSize: 12, background: "transparent", border: "none", outline: "none", color: "#6d28d9", width: "100%" }}
                    />
                    <div style={{ display: "flex", borderTop: "1px solid #e9d5ff", marginTop: 4 }}>
                      <button onClick={addCol} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#7c3aed", padding: "2px 0" }}>OK</button>
                      <button onClick={() => setAddingCol(false)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", fontSize: 11, color: "#9ca3af", padding: "2px 0" }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={(e) => { e.stopPropagation(); setAddingCol(true); }}
                    style={{ minWidth: 90, padding: "8px 12px", border: "2px dashed #d1d5db", borderRadius: 8, background: "none", cursor: "pointer", fontSize: 12, color: "#9ca3af", display: "flex", alignItems: "center", gap: 4 }}>
                    + Колонка
                  </button>
                )}
              </div>
            </div>
          )}

          {(phase === "running" || phase === "done") && (
            <div style={{ padding: 16, overflowX: "auto" }}>
              <ResultTable cols={cols} phase={phase} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldChipEl({ f, selected, hasSel, onClick }: { f: FieldChip; selected: boolean; hasSel: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 99,
      border: `1.5px solid ${f.border}`,
      background: selected ? f.color : f.bg,
      color: selected ? "#fff" : f.color,
      fontSize: 11, fontWeight: 500, cursor: "pointer",
      opacity: hasSel ? 0.4 : 1,
      transform: selected ? "scale(1.05)" : "scale(1)",
      boxShadow: selected ? `0 0 0 3px ${f.color}30` : "none",
      transition: "all 0.15s",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: selected ? "#fff" : f.color, flexShrink: 0 }} />
      {f.label}
      <span style={{ opacity: 0.6, maxWidth: 90, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>: {f.value}</span>
    </button>
  );
}

function ColSlot({ col, hasSel, onColClick, onRemove, getF }: {
  col: Col; hasSel: boolean; onColClick: () => void; onRemove: (fId: string) => void; getF: (id: string) => FieldChip;
}) {
  return (
    <div onClick={onColClick} style={{
      minWidth: 130, maxWidth: 180, borderRadius: 8,
      border: hasSel ? "2px dashed #7c3aed" : "1.5px solid #e5e7eb",
      background: hasSel ? "#faf5ff" : "#fff",
      boxShadow: hasSel ? "0 0 0 3px #7c3aed20" : "none",
      cursor: hasSel ? "pointer" : "default",
      transition: "all 0.15s",
    }}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid #f3f4f6", fontSize: 11, fontWeight: 700, color: "#374151", background: "#f9fafb", borderRadius: "6px 6px 0 0" }}>
        {col.name}
      </div>
      <div style={{ padding: "6px 8px", minHeight: 36, display: "flex", flexDirection: "column", gap: 4 }}>
        {col.fields.length === 0 ? (
          <span style={{ fontSize: 11, color: "#9ca3af", fontStyle: "italic" }}>
            {hasSel ? "← клик для добавления" : "пусто"}
          </span>
        ) : col.fields.map(fId => {
          const f = getF(fId);
          return (
            <div key={fId} onClick={e => e.stopPropagation()} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "2px 5px", borderRadius: 4,
              background: f.bg, color: f.color, fontSize: 10, fontWeight: 600,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: f.color, flexShrink: 0 }} />
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.label}</span>
              <button onClick={() => onRemove(fId)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: f.color, opacity: 0.6, padding: 0, lineHeight: 1 }}>✕</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DocumentView({ phase, sel, onPick }: { phase: Phase; sel: string | null; onPick: (id: string) => void }) {
  const active = phase === "mapping";

  const H = ({ fId }: { fId: string }) => {
    const f = FIELDS.find(x => x.id === fId)!;
    const isSelected = sel === fId;
    const isMuted = !!sel && sel !== fId;
    return (
      <span onClick={() => active && onPick(fId)} style={{
        display: "inline-block", borderRadius: 3,
        padding: active ? "1px 4px" : "0",
        background: active ? f.bg : "transparent",
        color: active ? f.color : "#1f2937",
        border: active ? `1.5px solid ${f.border}` : "none",
        cursor: active ? "pointer" : "default",
        fontWeight: isSelected ? 700 : 500,
        opacity: isMuted ? 0.35 : 1,
        boxShadow: isSelected ? `0 0 0 3px ${f.color}40` : "none",
        transform: isSelected ? "scale(1.02)" : "scale(1)",
        transition: "all 0.1s",
        fontSize: "inherit",
      }}>
        {f.value}
      </span>
    );
  };

  return (
    <div style={{ background: "#fff", boxShadow: "0 4px 24px rgba(0,0,0,0.12)", borderRadius: 4, width: 560, padding: "28px 36px", fontSize: 10, lineHeight: 1.4 }}>
      <div style={{ textAlign: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 8, color: "#9ca3af", letterSpacing: 2, textTransform: "uppercase" }}>Платёжное поручение (унифицированная форма)</div>
        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>ПЛАТЁЖНОЕ ПОРУЧЕНИЕ</div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
        <tbody>
          <tr>
            <Td w="30%">Номер документа</Td><Td w="30%">Дата составления</Td><Td>Вид платежа</Td>
          </tr>
          <tr>
            <Td><H fId="f2" /></Td><Td><H fId="f1" /></Td><Td style={{ color: "#374151" }}>электронно</Td>
          </tr>
          <tr><Td colSpan={3} style={{ color: "#9ca3af" }}>Плательщик</Td></tr>
          <tr><Td colSpan={3} style={{ padding: "6px 6px" }}><H fId="f3" /></Td></tr>
          <tr>
            <Td>ИНН</Td><Td>КПП</Td><Td>Сумма</Td>
          </tr>
          <tr>
            <Td><H fId="f5" /></Td>
            <Td style={{ color: "#374151" }}>770401001</Td>
            <Td style={{ fontWeight: 700 }}><H fId="f4" /></Td>
          </tr>
          <tr><Td colSpan={2} style={{ color: "#9ca3af" }}>Банк плательщика</Td><Td style={{ color: "#9ca3af" }}>БИК</Td></tr>
          <tr>
            <Td colSpan={2} style={{ color: "#374151" }}>АО «Альфа-Банк», г. Москва</Td>
            <Td><H fId="f8" /></Td>
          </tr>
          <tr><Td colSpan={3} style={{ color: "#9ca3af" }}>Получатель</Td></tr>
          <tr><Td colSpan={3} style={{ padding: "6px 6px" }}><H fId="f6" /></Td></tr>
          <tr><Td colSpan={3} style={{ color: "#9ca3af" }}>Назначение платежа</Td></tr>
          <tr><Td colSpan={3} style={{ padding: "8px 6px", lineHeight: 1.7 }}><H fId="f7" /></Td></tr>
        </tbody>
      </table>
      {active && (
        <div style={{ marginTop: 10, textAlign: "center", fontSize: 11, color: "#7c3aed" }}>
          ✨ ИИ выделил значимые поля — кликните для выбора
        </div>
      )}
    </div>
  );
}

function Td({ children, w, colSpan, style }: { children?: React.ReactNode; w?: string; colSpan?: number; style?: CSSProperties }) {
  return (
    <td colSpan={colSpan} style={{ border: "1px solid #d1d5db", padding: "4px 6px", width: w, verticalAlign: "middle", ...style }}>
      {children}
    </td>
  );
}

const ROWS = [
  ["15.06.2026", "№ 1547", "ООО «Альфа-Строй»", "385 200,00", "Оплата по договору №18/2026"],
  ["14.06.2026", "№ 1546", "ЗАО «ТехноПром»", "127 000,00", "Аванс по счёту №214 от 10.06.2026"],
  ["13.06.2026", "№ 1545", "ИП Кузнецов М.В.", "54 300,00", "Оплата услуг по акту №7"],
  ["12.06.2026", "№ 1544", "ООО «СтройТранс»", "920 000,00", "Договор поставки №5-А"],
];

function ResultTable({ cols, phase }: { cols: Col[]; phase: Phase }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 8 }}>Предварительный просмотр (первые 4 строки из 24):</div>
      <table style={{ fontSize: 11, borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.id} style={{ border: "1px solid #e5e7eb", padding: "5px 10px", background: "#f9fafb", fontWeight: 700, color: "#374151", textAlign: "left", whiteSpace: "nowrap" }}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f9fafb" }}>
              {cols.map((col, ci) => (
                <td key={col.id} style={{ border: "1px solid #e5e7eb", padding: "5px 10px", color: "#1f2937" }}>
                  {phase === "done" ? (row[ci] ?? "—") : (
                    <span style={{ display: "inline-block", height: 10, background: "#e5e7eb", borderRadius: 4, width: `${50 + Math.random() * 60}px` }} />
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Spin({ text }: { text: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#7c3aed" }}>
      <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid #a78bfa", borderTopColor: "#7c3aed", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      {text}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}

function Pill({ text, color, bg }: { text: string; color: string; bg: string }) {
  return <span style={{ fontSize: 11, color, background: bg, padding: "2px 8px", borderRadius: 99, fontWeight: 500 }}>{text}</span>;
}

function btn(bg: string, color: string, ghost = false, disabled = false): CSSProperties {
  return {
    padding: "6px 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer",
    background: ghost ? "transparent" : bg, color: ghost ? bg : color,
    border: ghost ? `1.5px solid ${bg}` : "none",
    opacity: disabled ? 0.4 : 1, transition: "opacity 0.15s",
  };
}
