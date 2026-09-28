#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bbox-based extractor for Russian payment orders (ПП/ПО).
Uses pdfplumber extract_words() + zone bounding-box filtering.

Input:  argv[1] = path to PDF file
        stdin   = JSON {
          zones:    [{ id, columnId, x, y, w, h }],  // 0-1 relative to page
          columns:  [{ id, name, isNumeric }],
          filterPP: bool  // default true — skip non-ПП pages
        }
Output: stdout = JSON { rows, stats }
"""
import sys
import json
import re

try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed"}))
    sys.exit(1)


PP_HEADER_RE = re.compile(
    r'ПЛАТЕЖН(?:ОЕ\s+ПОРУЧЕНИЕ|ЫЙ\s+ОРДЕР)|'
    r'Платежн(?:ое\s+поручение|ый\s+ордер)|'
    r'Плат\.\s*(?:поруч|ордер)',
    re.IGNORECASE | re.UNICODE
)


def normalize_amount(val: str) -> str:
    """Normalise various amount formats to NNNNNN,NN."""
    v = val.strip()
    v = re.sub(r'(\d)[\s\u00a0]+(\d)', r'\1\2', v)
    v = re.sub(r'[.\-](\d{2})$', r',\1', v)
    # Remove any trailing '=' sign (Sberbank quirk: "17920=")
    v = v.rstrip('=').strip()
    v = v.replace(' ', '').replace('\u00a0', '')
    return v


def extract_zone_text(page, zone: dict) -> str:
    """Extract words that fall inside the zone bbox (relative coords → absolute)."""
    pw = float(page.width)
    ph = float(page.height)

    x0  = zone['x'] * pw
    top = zone['y'] * ph
    x1  = (zone['x'] + zone['w']) * pw
    bot = (zone['y'] + zone['h']) * ph

    # Small tolerance to avoid clipping characters on border
    pad_x, pad_y = pw * 0.005, ph * 0.003
    bbox = (x0 - pad_x, top - pad_y, x1 + pad_x, bot + pad_y)

    try:
        words = page.extract_words(x_tolerance=5, y_tolerance=3)
    except Exception:
        return ""

    in_zone = [
        w for w in words
        if w['x0'] >= bbox[0] and w['top'] >= bbox[1]
        and w['x1'] <= bbox[2] and w['bottom'] <= bbox[3]
    ]

    # Sort left-to-right, top-to-bottom (group rows by top with tolerance 3)
    in_zone.sort(key=lambda w: (round(w['top'] / 4) * 4, w['x0']))
    return ' '.join(w['text'] for w in in_zone).strip()


def is_pp_page(page) -> bool:
    """Return True if the page looks like a ПП/ПО (check first 600 chars)."""
    try:
        text = page.extract_text() or ""
    except Exception:
        return False
    return bool(PP_HEADER_RE.search(text[:600]))


def extract(pdf_path: str, config: dict) -> dict:
    zones     = config.get("zones", [])
    columns   = config.get("columns", [])
    filter_pp = config.get("filterPP", True)
    page_from = int(config.get("pageFrom", 1) or 1)
    page_to   = int(config.get("pageTo",   0) or 0)  # 0 = до конца

    col_map = {c['id']: c for c in columns}

    # Group zones by columnId (a column may have multiple zones — merge text)
    col_zones: dict[str, list] = {}
    for z in zones:
        cid = z['columnId']
        col_zones.setdefault(cid, []).append(z)

    rows       = []
    total      = 0.0
    page_count = 0
    pp_pages   = 0

    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        eff_to = page_to if page_to > 0 else page_count

        for page in pdf.pages:
            pnum = page.page_number
            if pnum < page_from or pnum > eff_to:
                continue
            if filter_pp:
                if not is_pp_page(page):
                    continue
            pp_pages += 1

            row: dict = {}
            for cid, czones in col_zones.items():
                parts = []
                for zone in czones:
                    text = extract_zone_text(page, zone)
                    if text:
                        parts.append(text)
                if parts:
                    val = ' '.join(parts).strip()
                    col = col_map.get(cid, {})
                    if col.get('isNumeric', False):
                        val = normalize_amount(val)
                    row[cid] = val

            if row:
                row['_page'] = page.page_number
                rows.append(row)

    # Sum first numeric column for stats
    numeric_ids = [c['id'] for c in columns if c.get('isNumeric', False)]
    for row in rows:
        for cid in numeric_ids:
            if cid in row:
                try:
                    num_str = (
                        row[cid]
                        .replace(',', '.')
                        .replace('\u00a0', '')
                        .replace(' ', '')
                        .rstrip('=')
                    )
                    total += float(num_str)
                except (ValueError, AttributeError):
                    pass
                break

    return {
        "rows": rows,
        "stats": {
            "pages":       page_count,
            "ppPages":     pp_pages,
            "docs":        len(rows),
            "rows":        len(rows),
            "totalAmount": round(total, 2),
        },
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided"}))
        sys.exit(1)

    try:
        cfg    = json.load(sys.stdin)
        result = extract(sys.argv[1], cfg)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)
