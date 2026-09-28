import { useState, useRef, useEffect } from "react";

type RxField = {
  id: string;
  label: string;
  regex: string;
  color: string;
  bg: string;
  border: string;
  match: string;
  colName: string;
};

const SAMPLE_TEXT = `ПЛАТЁЖНОЕ ПОРУЧЕНИЕ № 1547 от 15.06.2026
Плательщик: ООО «Альфа-Строй»
ИНН плательщика: 7704567890  КПП: 770401001
Расчётный счёт: 40702810123456789012
Банк плательщика: АО «Альфа-Банк», г. Москва
БИК: 044525559  Корр.счёт: 30101810200000000593
Получатель: ООО «БетонМикс»
ИНН получателя: 7709876543  КПП: 770901001
Расчётный счёт: 40702810987654321098
Банк получателя: ПАО «Сбербанк», г. Москва
Сумма: 385 200-00
Назначение платежа: Оплата по договору №18/2026 от 01.03.2026 за поставку материалов
НДС не облагается`;

const FIELDS0: RxField[] = [
  { id: "rx_date",    label: "Дата",             colName: "Дата",            regex: "от (\\d{2}\\.\\d{2}\\.\\d{4})",         color: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd",  match: "15.06.2026" },
  { id: "rx_num",     label: "Номер ПП",          colName: "Номер ПП",        regex: "№\\s*(\\d+)",                           color: "#7c3aed", bg: "#ede9fe", border: "#c4b5fd",  match: "1547" },
  { id: "rx_payer",   label: "Плательщик",        colName: "Плательщик",      regex: "Плательщик:\\s*(.+)",                   color: "#0f766e", bg: "#ccfbf1", border: "#5eead4",  match: "ООО «Альфа-Строй»" },
  { id: "rx_inn",     label: "ИНН плательщика",   colName: "ИНН",             regex: "ИНН плательщика:\\s*(\\d{10})",         color: "#b91c1c", bg: "#fee2e2", border: "#fca5a5",  match: "7704567890" },
  { id: "rx_sum",     label: "Сумма",             colName: "Сумма",           regex: "Сумма:\\s*([\\d\\s]+-\\d{2})",          color: "#b45309", bg: "#fef3c7", border: "#fcd34d",  match: "385 200-00" },
  { id: "rx_payee",   label: "Получатель",        colName: "Получатель",      regex: "Получатель:\\s*(.+)",                   color: "#166534", bg: "#dcfce7", border: "#86efac",  match: "ООО «БетонМикс»" },
  { id: "rx_purpose", label: "Назначение",        colName: "Назначение",      regex: "Назначение платежа:\\s*(.+)",           color: "#9d174d", bg: "#fce7f3", border: "#f9a8d4",  match: "Оплата по договору №18/2026 от 01.03.2026 за поставку материалов" },
];

// Simulated rows for other documents
const PREVIEW_ROWS = [
  ["15.06.2026", "1547", "ООО «Альфа-Строй»",   "7704567890", "385 200-00",   "ООО «БетонМикс»",       "Оплата по договору №18/2026"],
  ["14.06.2026", "1546", "ЗАО «ТехноПром»",      "7708234561", "127 000-00",   "ИП Сидоров В.А.",       "Аванс по счёту №214 от 10.06.2026"],
  ["13.06.2026", "1545", "ИП Кузнецов М.В.",     "772456789012","54 300-00",   "ООО «СервисГрупп»",     "Оплата услуг по акту №7"],
  ["12.06.2026", "1544", "ООО «СтройТранс»",     "7706789012", "920 000-00",   "АО «МеталлСнаб»",       "Договор поставки №5-А от 02.01.2026"],
];

type Phase = "view" | "editing" | "saved";

export function RegexMapper() {
  const [fields, setFields] = useState<RxField[]>(FIELDS0);
  const [editId, setEditId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [editColName, setEditColName] = useState("");
  const [phase, setPhase] = useState<Phase>("view");
  const [testResult, setTestResult] = useState<{ ok: boolean; match: string } | null>(null);
  const [hovFieldId, setHovFieldId] = useState<string | null>(null);
  const [tableOpen, setTableOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editId && inputRef.current) inputRef.current.focus();
  }, [editId]);

  const startEdit = (f: RxField) => {
    if (phase !== "editing") return;
    setEditId(f.id);
    setEditVal(f.regex);
    setEditColName(f.colName);
    setTestResult(null);
  };

  const testRegex = (rx: string) => {
    try {
      const m = SAMPLE_TEXT.match(new RegExp(rx));
      if (m?.[1]) return { ok: true, match: m[1] };
      if (m?.[0]) return { ok: true, match: m[0] };
      return { ok: false, match: "— не найдено" };
    } catch {
      return { ok: false, match: "— ошибка regex" };
    }
  };

  const applyEdit = () => {
    if (!editId) return;
    const res = testRegex(editVal);
    setFields(fs => fs.map(f => f.id === editId
      ? { ...f, regex: editVal, match: res.match, colName: editColName || f.colName }
      : f
    ));
    setEditId(null);
    setTestResult(null);
  };

  const removeField = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFields(fs => fs.filter(f => f.id !== id));
    if (editId === id) setEditId(null);
  };

  // Build highlighted segments
  const highlightText = () => {
    const segments: { text: string; fieldId?: string }[] = [];
    const matches: { start: number; end: number; field: RxField }[] = [];
    for (const f of fields) {
      try {
        const rx = new RegExp(f.regex, "g");
        let m;
        while ((m = rx.exec(SAMPLE_TEXT)) !== null) {
          const captured = m[1] ?? m[0];
          const start = m.index + m[0].indexOf(captured);
          const end = start + captured.length;
          matches.push({ start, end, field: f });
          break; // only first match per field for clarity
        }
      } catch { /* ignore */ }
    }
    matches.sort((a, b) => a.start - b.start);
    let pos = 0;
    for (const { start, end, field } of matches) {
      if (start > pos) segments.push({ text: SAMPLE_TEXT.slice(pos, start) });
      if (start < end) segments.push({ text: SAMPLE_TEXT.slice(start, end), fieldId: field.id });
      pos = Math.max(pos, end);
    }
    if (pos < SAMPLE_TEXT.length) segments.push({ text: SAMPLE_TEXT.slice(pos) });
    return segments;
  };

  const segments = highlightText();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui,-apple-system,sans-serif", background: "#f9fafb" }}>

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6" }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>Вариант Б — Regex-маппинг</span>
        <span style={{ fontSize: 11, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 99 }}>Платёжное поручение</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {phase === "view" && (
            <button onClick={() => setPhase("editing")} style={btn("#8b5cf6")}>✎ Редактировать</button>
          )}
          {phase === "editing" && (
            <>
              <button onClick={() => { setPhase("view"); setEditId(null); setFields(FIELDS0); }} style={btn("#6b7280", true)}>Отмена</button>
              <button onClick={() => { applyEdit(); setPhase("saved"); }} style={btn("#16a34a")}>✓ Сохранить шаблон</button>
            </>
          )}
          {phase === "saved" && (
            <>
              <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ Шаблон сохранён</span>
              <button onClick={() => { setFields(FIELDS0); setPhase("view"); }} style={btn("#6b7280", true)}>Сбросить</button>
            </>
          )}
        </div>
      </div>

      {/* ── Middle: doc preview + fields list ── */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", minHeight: 0 }}>

        {/* Document preview */}
        <div style={{ flex: 1, overflow: "auto", padding: 16, borderRight: "1px solid #e5e7eb" }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#9ca3af", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Образец документа · стр. 1 из 24</div>
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, padding: 14, fontFamily: "JetBrains Mono,Consolas,monospace", fontSize: 10.5, lineHeight: 1.9, color: "#374151", whiteSpace: "pre-wrap" }}>
            {segments.map((seg, i) => {
              if (!seg.fieldId) return <span key={i}>{seg.text}</span>;
              const f = fields.find(x => x.id === seg.fieldId)!;
              const isHov = hovFieldId === f.id;
              return (
                <span key={i} onMouseEnter={() => setHovFieldId(f.id)} onMouseLeave={() => setHovFieldId(null)}
                  style={{ background: f.bg, color: f.color, border: `1.5px solid ${f.border}`, borderRadius: 3, padding: "1px 4px", fontWeight: 700,
                    boxShadow: isHov || editId === f.id ? `0 0 0 3px ${f.color}30` : "none", transition: "box-shadow 0.1s",
                    cursor: "default", position: "relative" }}>
                  {seg.text}
                  <span style={{ position: "absolute", bottom: "100%", left: 0, background: f.color, color: "#fff", fontSize: 9, padding: "1px 4px", borderRadius: "3px 3px 0 0", whiteSpace: "nowrap", opacity: isHov ? 1 : 0, pointerEvents: "none", transition: "opacity 0.1s" }}>
                    → кол. «{f.colName}»
                  </span>
                </span>
              );
            })}
          </div>
        </div>

        {/* Regex fields panel */}
        <div style={{ width: 300, overflowY: "auto", background: "#fff", flexShrink: 0 }}>
          <div style={{ padding: "8px 14px", borderBottom: "1px solid #f3f4f6", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Регулярные выражения</span>
            <span style={{ fontSize: 10, color: "#9ca3af", background: "#f3f4f6", borderRadius: 99, padding: "1px 6px" }}>{fields.length} полей</span>
          </div>

          {fields.map(f => {
            const isEditing = editId === f.id;
            const isHov = hovFieldId === f.id;
            return (
              <div key={f.id}
                onClick={() => startEdit(f)}
                onMouseEnter={() => setHovFieldId(f.id)}
                onMouseLeave={() => setHovFieldId(null)}
                style={{ padding: "9px 14px", borderBottom: "1px solid #f9fafb",
                  cursor: phase === "editing" ? "pointer" : "default",
                  background: isEditing ? f.bg : isHov ? "#fafafa" : "transparent",
                  transition: "background 0.1s" }}>

                <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: f.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: f.color, flex: 1 }}>{f.label}</span>
                  {/* Column name badge */}
                  <span style={{ fontSize: 9, color: f.color, background: f.bg, border: `1px solid ${f.border}`, borderRadius: 3, padding: "1px 5px" }}>
                    кол. «{f.colName}»
                  </span>
                  {phase === "editing" && !isEditing && (
                    <button onClick={e => removeField(f.id, e)} title="Удалить поле"
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#d1d5db", padding: 0, lineHeight: 1 }}>✕</button>
                  )}
                </div>

                {isEditing ? (
                  <div onClick={e => e.stopPropagation()}>
                    {/* Column name input */}
                    <div style={{ marginBottom: 4 }}>
                      <label style={{ fontSize: 9, color: "#6b7280", display: "block", marginBottom: 2 }}>Название колонки</label>
                      <input value={editColName} onChange={e => setEditColName(e.target.value)}
                        style={{ width: "100%", boxSizing: "border-box", fontSize: 11, padding: "3px 7px", borderRadius: 4,
                          border: `1.5px solid ${f.border}`, outline: "none", background: "#fff" }} />
                    </div>
                    {/* Regex input */}
                    <div style={{ marginBottom: 4 }}>
                      <label style={{ fontSize: 9, color: "#6b7280", display: "block", marginBottom: 2 }}>Regex паттерн</label>
                      <input ref={inputRef} value={editVal} onChange={e => { setEditVal(e.target.value); setTestResult(testRegex(e.target.value)); }}
                        onKeyDown={e => { if (e.key === "Enter") applyEdit(); if (e.key === "Escape") { setEditId(null); setTestResult(null); } }}
                        style={{ width: "100%", boxSizing: "border-box", fontFamily: "JetBrains Mono,monospace", fontSize: 10,
                          padding: "3px 7px", borderRadius: 4, outline: "none", background: "#fff",
                          border: `1.5px solid ${testResult ? (testResult.ok ? "#86efac" : "#fca5a5") : f.border}` }} />
                    </div>
                    {testResult && (
                      <div style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, marginBottom: 4,
                        background: testResult.ok ? "#f0fdf4" : "#fff5f5", color: testResult.ok ? "#166534" : "#b91c1c" }}>
                        {testResult.ok ? "✓" : "✕"} {testResult.match}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 5 }}>
                      <button onClick={applyEdit} style={btn(f.color, false, false, true)}>OK</button>
                      <button onClick={() => { setEditId(null); setTestResult(null); }} style={btn("#6b7280", true, false, true)}>Отмена</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontFamily: "JetBrains Mono,monospace", fontSize: 9.5, color: "#6b7280", background: "#f9fafb",
                      border: "1px solid #e5e7eb", borderRadius: 3, padding: "2px 6px", wordBreak: "break-all", marginBottom: 3 }}>
                      {f.regex}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ fontSize: 9, color: "#9ca3af" }}>захват:</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: f.color, background: f.bg, padding: "1px 5px",
                        borderRadius: 3, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {f.match}
                      </span>
                    </div>
                  </>
                )}
              </div>
            );
          })}

          {phase === "editing" && (
            <div style={{ padding: "10px 14px", borderTop: "1px solid #f3f4f6", background: "#fafafa" }}>
              <div style={{ fontSize: 10, color: "#9ca3af" }}>
                Capture group <code style={{ background: "#e5e7eb", padding: "0 3px", borderRadius: 2, fontSize: 9 }}>(…)</code> — значение попадёт в ячейку
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom: output table preview ── */}
      <div style={{ borderTop: "2px solid #e5e7eb", background: "#fff", flexShrink: 0 }}>
        {/* Collapsible header */}
        <div onClick={() => setTableOpen(o => !o)}
          style={{ padding: "7px 20px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
            background: "#f9fafb", borderBottom: tableOpen ? "1px solid #e5e7eb" : "none" }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#374151" }}>
            {tableOpen ? "▾" : "▸"} Итоговая таблица XLSX
          </span>
          <span style={{ fontSize: 10, color: "#9ca3af" }}>каждый ПП → 1 строка · каждое поле → 1 колонка</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {fields.map(f => (
              <span key={f.id} style={{ fontSize: 9, color: f.color, background: f.bg, border: `1px solid ${f.border}`,
                borderRadius: 3, padding: "1px 5px", fontWeight: 600 }}>
                {f.colName}
              </span>
            ))}
          </div>
        </div>

        {tableOpen && (
          <div style={{ overflowX: "auto", maxHeight: 160 }}>
            <table style={{ borderCollapse: "collapse", fontSize: 10.5, width: "100%" }}>
              <thead>
                <tr>
                  <th style={thBase("#f3f4f6", "#6b7280")}>#</th>
                  {fields.map(f => (
                    <th key={f.id}
                      onMouseEnter={() => setHovFieldId(f.id)}
                      onMouseLeave={() => setHovFieldId(null)}
                      style={{ ...thBase(hovFieldId === f.id ? f.bg : "#f9fafb", f.color),
                        outline: hovFieldId === f.id ? `2px solid ${f.border}` : "none",
                        outlineOffset: -2, transition: "all 0.1s" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: f.color, flexShrink: 0 }} />
                        {f.colName}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PREVIEW_ROWS.map((row, ri) => (
                  <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#fafafa" }}>
                    <td style={tdBase("#9ca3af")}>{ri + 1}</td>
                    {fields.map((f, ci) => (
                      <td key={f.id}
                        onMouseEnter={() => setHovFieldId(f.id)}
                        onMouseLeave={() => setHovFieldId(null)}
                        style={{ ...tdBase(hovFieldId === f.id ? f.color : "#374151"),
                          background: hovFieldId === f.id ? f.bg + "60" : "transparent",
                          fontWeight: hovFieldId === f.id ? 600 : 400,
                          transition: "all 0.1s" }}>
                        {row[ci] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td colSpan={fields.length + 1} style={{ ...tdBase("#9ca3af"), textAlign: "center", fontStyle: "italic" }}>
                    … ещё 20 строк после запуска парсинга
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function btn(bg: string, ghost = false, disabled = false, small = false): React.CSSProperties {
  return { padding: small ? "3px 10px" : "6px 14px", borderRadius: 6, fontSize: small ? 10 : 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", background: ghost ? "transparent" : disabled ? "#e5e7eb" : bg,
    color: ghost ? bg : disabled ? "#9ca3af" : "#fff", border: ghost ? `1.5px solid ${bg}` : "none" };
}
function thBase(bg: string, color: string): React.CSSProperties {
  return { border: "1px solid #e5e7eb", padding: "5px 10px", background: bg, color, fontWeight: 700,
    textAlign: "left", whiteSpace: "nowrap", fontSize: 10.5 };
}
function tdBase(color: string): React.CSSProperties {
  return { border: "1px solid #e5e7eb", padding: "4px 10px", color, whiteSpace: "nowrap",
    maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", fontSize: 10.5 };
}
