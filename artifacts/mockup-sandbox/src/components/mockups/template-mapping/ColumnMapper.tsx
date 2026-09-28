import { useState } from "react";

type Col = { id: string; header: string; sample: string[] };
type Field = { id: string; label: string; color: string; bg: string; border: string; mapped: string | null };

const COLS: Col[] = [
  { id: "c0", header: "Дата операции", sample: ["15.06.2026", "14.06.2026", "13.06.2026", "12.06.2026"] },
  { id: "c1", header: "Номер документа", sample: ["1547", "1546", "1545", "1544"] },
  { id: "c2", header: "Дебет", sample: ["", "127 000,00", "", "920 000,00"] },
  { id: "c3", header: "Кредит", sample: ["385 200,00", "", "54 300,00", ""] },
  { id: "c4", header: "Контрагент", sample: ["ООО «Альфа-Строй»", "ЗАО «ТехноПром»", "ИП Кузнецов М.В.", "ООО «СтройТранс»"] },
  { id: "c5", header: "ИНН контрагента", sample: ["7704567890", "7708234561", "772456789012", "7706789012"] },
  { id: "c6", header: "Назначение платежа", sample: ["Оплата по договору №18/2026", "Аванс по счёту №214", "Оплата услуг по акту №7", "Договор поставки №5-А"] },
  { id: "c7", header: "Остаток", sample: ["1 250 000,00", "1 635 200,00", "1 508 200,00", "1 562 500,00"] },
];

const FIELDS0: Field[] = [
  { id: "f_date", label: "Дата", color: "#1d4ed8", bg: "#dbeafe", border: "#93c5fd", mapped: null },
  { id: "f_num", label: "Номер документа", color: "#7c3aed", bg: "#ede9fe", border: "#c4b5fd", mapped: null },
  { id: "f_debit", label: "Дебет", color: "#b91c1c", bg: "#fee2e2", border: "#fca5a5", mapped: null },
  { id: "f_credit", label: "Кредит", color: "#15803d", bg: "#dcfce7", border: "#86efac", mapped: null },
  { id: "f_party", label: "Контрагент", color: "#0f766e", bg: "#ccfbf1", border: "#5eead4", mapped: null },
  { id: "f_inn", label: "ИНН", color: "#b45309", bg: "#fef3c7", border: "#fcd34d", mapped: null },
  { id: "f_purpose", label: "Назначение", color: "#9d174d", bg: "#fce7f3", border: "#f9a8d4", mapped: null },
];

const ROWS = 4;

type Phase = "idle" | "mapping" | "done";

export function ColumnMapper() {
  const [fields, setFields] = useState<Field[]>(FIELDS0);
  const [selField, setSelField] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hovCol, setHovCol] = useState<string | null>(null);

  const getField = (id: string) => fields.find(f => f.id === id)!;
  const getMappedField = (colId: string) => fields.find(f => f.mapped === colId) ?? null;

  const mapColToField = (colId: string) => {
    if (!selField) return;
    setFields(fs => fs.map(f => {
      if (f.id === selField) return { ...f, mapped: colId };
      if (f.mapped === colId) return { ...f, mapped: null };
      return f;
    }));
    setSelField(null);
  };

  const unmap = (fieldId: string) => setFields(fs => fs.map(f => f.id === fieldId ? { ...f, mapped: null } : f));

  const mappedCount = fields.filter(f => f.mapped !== null).length;
  const allMapped = mappedCount === fields.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, -apple-system, sans-serif", background: "#f9fafb" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "10px 20px", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6" }} />
        <span style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>Вариант А — Маппинг колонок</span>
        <span style={{ fontSize: 12, color: "#6b7280", background: "#f3f4f6", padding: "2px 8px", borderRadius: 99 }}>Выписка банка</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {phase === "idle" && (
            <button onClick={() => setPhase("mapping")} style={btnStyle("#3b82f6")}>
              Настроить маппинг →
            </button>
          )}
          {phase === "mapping" && (
            <>
              <span style={{ fontSize: 12, color: "#6b7280" }}>{mappedCount}/{fields.length} полей</span>
              <button onClick={() => setPhase("idle")} style={btnStyle("#6b7280", true)}>Отмена</button>
              <button onClick={() => setPhase("done")} disabled={mappedCount === 0} style={btnStyle("#16a34a", false, mappedCount === 0)}>
                ✓ Сохранить шаблон
              </button>
            </>
          )}
          {phase === "done" && (
            <>
              <span style={{ fontSize: 13, color: "#15803d", fontWeight: 600 }}>✓ Шаблон сохранён</span>
              <button onClick={() => { setFields(FIELDS0); setPhase("idle"); setSelField(null); }} style={btnStyle("#6b7280", true)}>
                Сбросить
              </button>
            </>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {/* Instructions banner */}
        {phase === "mapping" && (
          <div style={{ background: "#eff6ff", borderBottom: "1px solid #bfdbfe", padding: "8px 20px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 13, color: "#1d4ed8" }}>
              {selField
                ? `← Кликните на колонку таблицы чтобы привязать поле «${getField(selField).label}»`
                : "① Выберите поле из списка слева → ② кликните на колонку таблицы"}
            </span>
            {selField && (
              <button onClick={() => setSelField(null)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "#6b7280" }}>
                ✕ Отмена
              </button>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflow: "hidden", display: "flex", gap: 0 }}>
          {/* Left: Fields panel */}
          {phase !== "idle" && (
            <div style={{ width: 200, borderRight: "1px solid #e5e7eb", background: "#fff", flexShrink: 0, overflowY: "auto" }}>
              <div style={{ padding: "10px 12px", borderBottom: "1px solid #f3f4f6" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#6b7280", textTransform: "uppercase", letterSpacing: 1 }}>Поля шаблона</div>
              </div>
              {fields.map(f => {
                const isSel = selField === f.id;
                return (
                  <div key={f.id} onClick={() => phase === "mapping" && setSelField(isSel ? null : f.id)} style={{
                    padding: "8px 12px", borderBottom: "1px solid #f9fafb", cursor: phase === "mapping" ? "pointer" : "default",
                    background: isSel ? f.bg : "transparent",
                    transition: "background 0.1s",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: f.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 500, color: f.color, flex: 1 }}>{f.label}</span>
                      {isSel && <span style={{ fontSize: 10, color: f.color }}>←</span>}
                    </div>
                    {f.mapped ? (
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: 10, color: "#6b7280", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          → {COLS.find(c => c.id === f.mapped)?.header}
                        </span>
                        {phase === "mapping" && (
                          <button onClick={e => { e.stopPropagation(); unmap(f.id); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#9ca3af", padding: 0 }}>✕</button>
                        )}
                      </div>
                    ) : (
                      <div style={{ marginTop: 3, fontSize: 10, color: "#9ca3af", fontStyle: "italic" }}>не привязано</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Right: Table */}
          <div style={{ flex: 1, overflow: "auto", padding: 16 }}>
            {phase === "idle" ? (
              <div style={{ textAlign: "center", paddingTop: 80 }}>
                <div style={{ fontSize: 48 }}>📊</div>
                <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginTop: 12 }}>Выписка банка готова к настройке</div>
                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 8 }}>8 колонок · 24 строки данных</div>
                <button onClick={() => setPhase("mapping")} style={{ ...btnStyle("#3b82f6"), marginTop: 24, fontSize: 14, padding: "10px 24px" }}>
                  Настроить маппинг →
                </button>
              </div>
            ) : (
              <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%", tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    {COLS.map(col => {
                      const mappedField = getMappedField(col.id);
                      const isSelTarget = !!selField;
                      const isHov = hovCol === col.id;
                      return (
                        <th key={col.id}
                          onClick={() => phase === "mapping" && selField && mapColToField(col.id)}
                          onMouseEnter={() => setHovCol(col.id)}
                          onMouseLeave={() => setHovCol(null)}
                          style={{
                            border: "1px solid #e5e7eb",
                            padding: "6px 8px",
                            background: mappedField ? mappedField.bg : isSelTarget && isHov ? "#f0fdf4" : "#f9fafb",
                            color: mappedField ? mappedField.color : "#374151",
                            fontWeight: 700,
                            textAlign: "left",
                            cursor: phase === "mapping" && selField ? "pointer" : "default",
                            outline: mappedField ? `2px solid ${mappedField.border}` : isSelTarget && isHov ? "2px dashed #86efac" : "none",
                            outlineOffset: -2,
                            transition: "all 0.1s",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {mappedField && <span style={{ width: 6, height: 6, borderRadius: "50%", background: mappedField.color, flexShrink: 0 }} />}
                            {col.header}
                          </div>
                          {mappedField && (
                            <div style={{ fontSize: 9, fontWeight: 500, color: mappedField.color, marginTop: 2 }}>→ {mappedField.label}</div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: ROWS }).map((_, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#fafafa" }}>
                      {COLS.map(col => {
                        const mf = getMappedField(col.id);
                        return (
                          <td key={col.id} style={{
                            border: "1px solid #e5e7eb",
                            padding: "5px 8px",
                            color: mf ? mf.color : "#374151",
                            background: mf ? mf.bg + "40" : "transparent",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}>
                            {col.sample[ri] || <span style={{ color: "#d1d5db" }}>—</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={COLS.length} style={{ border: "1px solid #e5e7eb", padding: "4px 8px", color: "#9ca3af", fontSize: 10, textAlign: "center" }}>
                      … ещё 20 строк
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Bottom summary */}
      {phase === "done" && allMapped && (
        <div style={{ background: "#f0fdf4", borderTop: "1px solid #86efac", padding: "8px 20px", display: "flex", gap: 16, flexShrink: 0 }}>
          {fields.map(f => (
            <div key={f.id} style={{ fontSize: 11, color: f.color }}>
              <span style={{ fontWeight: 600 }}>{f.label}</span>
              <span style={{ color: "#6b7280" }}> → {COLS.find(c => c.id === f.mapped)?.header ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function btnStyle(bg: string, ghost = false, disabled = false): React.CSSProperties {
  return {
    padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    background: ghost ? "transparent" : disabled ? "#e5e7eb" : bg,
    color: ghost ? bg : disabled ? "#9ca3af" : "#fff",
    border: ghost ? `1.5px solid ${bg}` : "none",
    opacity: 1, transition: "opacity 0.15s",
  };
}
