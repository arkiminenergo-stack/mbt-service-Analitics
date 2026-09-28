#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extractor for ONE CHUNK of a bank statement PDF.
Called once per chunk from Node.js orchestrator.

Architecture to handle huge PDFs (23000+ pages):
  1. Use pypdf to extract ONLY the chunk pages into a tiny temp PDF
     (avoids pdfplumber hanging on 23k-page XRef table parsing)
  2. Open the tiny temp PDF with pdfplumber (instant)
  3. Extract table rows using "lines" strategy (real borders), then "words" fallback
  4. Write rows to a result .jsonl temp file
  5. Emit result_file JSON line to stdout
  6. Exit cleanly (OS frees all memory)

stdout protocol (JSON-lines):
  {"type":"result_file","path":"/tmp/stmt_xxx.jsonl","columns":[...],"total_rows":N,"start_page":N,"end_page":N}
  {"type":"error","message":"..."}

Usage:
  python3 extract_statement.py <pdf_path> <start_page> <end_page>
  start_page, end_page — 1-based inclusive
"""

import sys
import os
import json
import re
import uuid
import tempfile
import logging
from typing import List, Optional, Tuple

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger(__name__)


def emit(obj: dict):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


# ── Column detection (words strategy fallback) ────────────────────────────────

def detect_col_bands(words: list) -> Optional[List[Tuple[float, float]]]:
    """Cluster word x0-positions into column bands (gap > 18pt = new column)."""
    if not words:
        return None
    xs = sorted(set(round(w['x0'], 0) for w in words))
    if len(xs) < 2:
        return None
    bands, start, prev = [], xs[0], xs[0]
    for x in xs[1:]:
        if x - prev > 18:
            bands.append((start, prev + 14))
            start = x
        prev = x
    bands.append((start, prev + 14))
    return bands if len(bands) >= 2 else None


def words_to_cols(words: list, bands: List[Tuple[float, float]]) -> List[str]:
    cells = [[] for _ in bands]
    for w in words:
        mx = (w['x0'] + w['x1']) / 2
        for i, (lo, hi) in enumerate(bands):
            if lo <= mx <= hi:
                cells[i].append(w['text'])
                break
        else:
            dists = [abs((lo + hi) / 2 - mx) for lo, hi in bands]
            cells[dists.index(min(dists))].append(w['text'])
    return [' '.join(c) for c in cells]


# ── Page extraction strategies ────────────────────────────────────────────────

def extract_page_rows(page) -> List[List[str]]:
    """
    Strategy 1: drawn table borders (lines/explicit rules).
    Strategy 2: word-coordinate clustering.
    NO "text" strategy — leaks ~1.7 MB/page in pdfplumber's pdfminer caches.
    """
    # Strategy 1: explicit drawn lines
    try:
        tables = page.extract_tables({
            "vertical_strategy":    "lines",
            "horizontal_strategy":  "lines",
            "snap_tolerance":       4,
            "join_tolerance":       4,
            "edge_min_length":      3,
            "min_words_vertical":   1,
            "min_words_horizontal": 1,
        })
        if tables:
            best = max(tables, key=lambda t: len(t) * (len(t[0]) if t else 0))
            rows = [[c or '' for c in row] for row in best if any(c for c in row)]
            if rows:
                return rows
    except Exception as e:
        logger.debug("lines strategy error: %s", e)

    # Strategy 2: word-coordinate clustering
    try:
        words = page.extract_words(keep_blank_chars=False, x_tolerance=3, y_tolerance=5)
        if not words:
            return []
        line_map: dict = {}
        for w in words:
            y = round(w['top'] / 5) * 5
            line_map.setdefault(y, []).append(w)
        sorted_lines = [line_map[k] for k in sorted(line_map)]
        bands = detect_col_bands(words)
        if not bands:
            return [[' '.join(w['text'] for w in ln)] for ln in sorted_lines if ln]
        return [words_to_cols(ln, bands) for ln in sorted_lines if any(w for w in ln)]
    except Exception as e:
        logger.debug("words strategy error: %s", e)
        return []


# ── Header detection ──────────────────────────────────────────────────────────

HEADER_KEYWORDS = {
    'дата', 'номер', 'сумма', 'наименование', 'получатель', 'плательщик',
    'назначение', 'дебет', 'кредит', 'остаток', 'счет', 'счёт',
    'операция', 'вид', 'корр', 'инн', 'бик', 'оборот', 'документ',
}


def is_header(row: List[str]) -> bool:
    text = ' '.join(c for c in row if c).lower()
    return any(kw in text for kw in HEADER_KEYWORDS)


def clean_header(row: List[str]) -> List[str]:
    return [re.sub(r'\s+', ' ', (c or '').strip()) for c in row]


# ── Main extraction ───────────────────────────────────────────────────────────

def extract_chunk(pdf_path: str, start_page: int, end_page: int):
    # Step 1: Use pypdf to cut just the needed pages into a small temp PDF.
    # This lets pdfplumber open a tiny file instead of the 23k-page monster.
    chunk_pdf_path = os.path.join(tempfile.gettempdir(), f"chunk_{uuid.uuid4().hex}.pdf")
    result_path    = os.path.join(tempfile.gettempdir(), f"stmt_{uuid.uuid4().hex}.jsonl")

    try:
        try:
            from pypdf import PdfReader, PdfWriter
        except ImportError:
            emit({"type": "error", "message": "pypdf not installed (pip install pypdf)"})
            return

        try:
            import pdfplumber
        except ImportError:
            emit({"type": "error", "message": "pdfplumber not installed"})
            return

        # ── Cut pages with pypdf ──────────────────────────────────────────────
        reader = PdfReader(pdf_path)
        total  = len(reader.pages)
        s = max(1, start_page)
        e = min(end_page, total)

        writer = PdfWriter()
        for i in range(s - 1, e):           # pypdf is 0-based
            writer.add_page(reader.pages[i])

        with open(chunk_pdf_path, 'wb') as f:
            writer.write(f)

        del reader, writer                   # free pypdf memory before pdfplumber

        # ── Extract with pdfplumber on the tiny chunk PDF ─────────────────────
        detected_cols: Optional[List[str]] = None
        num_cols: Optional[int] = None
        total_rows = 0

        with pdfplumber.open(chunk_pdf_path) as pdf, \
             open(result_path, 'w', encoding='utf-8') as out:

            for page in pdf.pages:
                rows = extract_page_rows(page)

                for row in rows:
                    if detected_cols is None and is_header(row):
                        raw = clean_header(row)
                        # Fill empty sub-headers by borrowing the previous non-empty name
                        filled: List[str] = []
                        last = ''
                        for c in raw:
                            if c:
                                filled.append(c)
                                last = c
                            else:
                                # e.g. Банк sub-column under Контрагент
                                filled.append(last + '_2' if last else f'Колонка {len(filled)+1}')
                        detected_cols = filled
                        num_cols = len(detected_cols)
                        continue
                    if not any(c.strip() for c in row):
                        continue
                    if num_cols is not None:
                        if len(row) < num_cols:
                            row = row + [''] * (num_cols - len(row))
                        elif len(row) > num_cols:
                            row = row[:num_cols]
                    out.write(json.dumps(row, ensure_ascii=False) + '\n')
                    total_rows += 1

        # Derive fallback column names if header was not found
        if detected_cols is None and total_rows > 0:
            try:
                with open(result_path, 'r', encoding='utf-8') as f:
                    first = json.loads(f.readline())
                    num_cols = len(first)
            except Exception:
                num_cols = 1
            detected_cols = [f"Колонка {i + 1}" for i in range(num_cols or 1)]

        emit({
            "type":       "result_file",
            "path":       result_path,
            "columns":    detected_cols or [],
            "total_rows": total_rows,
            "start_page": s,
            "end_page":   e,
        })

    except Exception as ex:
        import traceback
        traceback.print_exc(file=sys.stderr)
        for p in (chunk_pdf_path, result_path):
            try:
                os.unlink(p)
            except Exception:
                pass
        emit({"type": "error", "message": str(ex)})

    finally:
        # Always clean up the temp chunk PDF (result file cleaned up by Node.js)
        try:
            os.unlink(chunk_pdf_path)
        except Exception:
            pass


if __name__ == "__main__":
    if len(sys.argv) < 4:
        emit({"type": "error", "message": "Usage: extract_statement.py <pdf> <start_page> <end_page>"})
        sys.exit(1)
    extract_chunk(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
