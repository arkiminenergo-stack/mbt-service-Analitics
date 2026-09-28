import { useState, useCallback } from "react";
import { X } from "lucide-react";
import type { ParsingColumn } from "@shared/schema";

export interface BboxZone {
  id:       string;
  columnId: string;
  x:        number;
  y:        number;
  w:        number;
  h:        number;
}

interface DrawState {
  startX:   number;
  startY:   number;
  currentX: number;
  currentY: number;
}

interface Props {
  zones:           BboxZone[];
  columns:         ParsingColumn[];
  activeColumnId:  string | null;
  onZoneAdd:       (zone: BboxZone) => void;
  onZoneDelete:    (id: string) => void;
}

export function BboxZoneOverlay({
  zones, columns, activeColumnId, onZoneAdd, onZoneDelete,
}: Props) {
  const [drawing, setDrawing] = useState<DrawState | null>(null);

  const colById = useCallback(
    (id: string) => columns.find(c => c.id === id),
    [columns]
  );

  const activeCol = activeColumnId ? colById(activeColumnId) : null;

  const getRelative = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeColumnId) return;
    e.preventDefault();
    const { x, y } = getRelative(e);
    setDrawing({ startX: x, startY: y, currentX: x, currentY: y });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawing) return;
    e.preventDefault();
    const { x, y } = getRelative(e);
    setDrawing(d => d ? { ...d, currentX: x, currentY: y } : null);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!drawing || !activeColumnId) { setDrawing(null); return; }
    e.preventDefault();
    const rx = Math.min(drawing.startX, drawing.currentX);
    const ry = Math.min(drawing.startY, drawing.currentY);
    const rw = Math.abs(drawing.currentX - drawing.startX);
    const rh = Math.abs(drawing.currentY - drawing.startY);
    if (rw > 0.015 && rh > 0.008) {
      onZoneAdd({ id: `z_${Date.now()}`, columnId: activeColumnId, x: rx, y: ry, w: rw, h: rh });
    }
    setDrawing(null);
  };

  const drawRect = drawing ? {
    x: Math.min(drawing.startX, drawing.currentX),
    y: Math.min(drawing.startY, drawing.currentY),
    w: Math.abs(drawing.currentX - drawing.startX),
    h: Math.abs(drawing.currentY - drawing.startY),
  } : null;

  return (
    <div
      className="absolute inset-0"
      style={{
        zIndex:  20,
        cursor:  activeColumnId ? 'crosshair' : 'default',
        userSelect: 'none',
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => setDrawing(null)}
    >
      {zones.map(zone => {
        const col = colById(zone.columnId);
        const color = col?.color ?? '#a5b4fc';
        return (
          <div
            key={zone.id}
            style={{
              position:        'absolute',
              left:            `${zone.x * 100}%`,
              top:             `${zone.y * 100}%`,
              width:           `${zone.w * 100}%`,
              height:          `${zone.h * 100}%`,
              backgroundColor: `${color}55`,
              border:          `2px solid ${color}`,
              borderRadius:    3,
              boxSizing:       'border-box',
              overflow:        'hidden',
            }}
          >
            <div
              style={{
                display:    'flex',
                alignItems: 'center',
                gap:        2,
                padding:    '1px 3px',
                background: `${color}cc`,
                fontSize:   10,
                fontWeight: 600,
                lineHeight: 1.2,
                maxWidth:   '100%',
              }}
            >
              <span
                style={{
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                  flex:         1,
                  color:        '#1e293b',
                }}
              >
                {col?.name ?? zone.columnId}
              </span>
              <button
                onMouseDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onZoneDelete(zone.id); }}
                style={{
                  background: 'none',
                  border:     'none',
                  cursor:     'pointer',
                  padding:    0,
                  lineHeight: 1,
                  color:      '#1e293b',
                  flexShrink: 0,
                }}
                title="Удалить зону"
              >
                <X style={{ width: 10, height: 10 }} />
              </button>
            </div>
          </div>
        );
      })}

      {drawRect && drawRect.w > 0 && drawRect.h > 0 && (
        <div
          style={{
            position:        'absolute',
            left:            `${drawRect.x * 100}%`,
            top:             `${drawRect.y * 100}%`,
            width:           `${drawRect.w * 100}%`,
            height:          `${drawRect.h * 100}%`,
            backgroundColor: `${activeCol?.color ?? '#6366f1'}33`,
            border:          `2px dashed ${activeCol?.color ?? '#6366f1'}`,
            borderRadius:    3,
            boxSizing:       'border-box',
            pointerEvents:   'none',
          }}
        />
      )}

      {activeColumnId && !drawing && (
        <div
          style={{
            position:      'absolute',
            bottom:        6,
            left:          '50%',
            transform:     'translateX(-50%)',
            background:    'rgba(0,0,0,0.65)',
            color:         '#fff',
            fontSize:      11,
            padding:       '3px 8px',
            borderRadius:  4,
            pointerEvents: 'none',
            whiteSpace:    'nowrap',
          }}
        >
          Рисуйте прямоугольник для «{activeCol?.name}»
        </div>
      )}
    </div>
  );
}
