#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
PDF splitter.
Splits a PDF into multiple files by page ranges using pypdf.

Usage:
  python3 split_pdf.py <pdf_path> <output_dir> <ranges_json>

ranges_json — JSON array of objects:
  [{"start": 1, "end": 100, "name": "часть_1"}, ...]
  start/end are 1-based inclusive page numbers.

stdout: one JSON line
  {"ok": true, "total": N, "files": [{"path": "...", "name": "...", "pages": N, "start": N, "end": N}]}
  {"ok": false, "error": "..."}
"""

import sys
import os
import json
import re


def safe_filename(s: str) -> str:
    s = s.strip()
    s = re.sub(r'[\\/:*?"<>|]', '_', s)
    s = re.sub(r'\s+', '_', s)
    return s or 'часть'


def split_pdf(pdf_path: str, output_dir: str, ranges: list):
    try:
        from pypdf import PdfReader, PdfWriter
    except ImportError:
        print(json.dumps({"ok": False, "error": "pypdf not installed"}))
        return

    try:
        reader = PdfReader(pdf_path)
        total = len(reader.pages)
    except Exception as e:
        print(json.dumps({"ok": False, "error": f"Cannot open PDF: {e}"}))
        return

    os.makedirs(output_dir, exist_ok=True)

    results = []
    used_names: set = set()

    for idx, r in enumerate(ranges):
        start = max(1, int(r.get('start', 1)))
        end   = min(int(r.get('end', total)), total)
        if start > end:
            continue

        base_name = safe_filename(r.get('name', '') or f'часть_{idx + 1}')
        # Ensure unique filename
        candidate = base_name
        counter = 2
        while candidate in used_names:
            candidate = f'{base_name}_{counter}'
            counter += 1
        used_names.add(candidate)
        out_filename = f'{candidate}.pdf'
        out_path = os.path.join(output_dir, out_filename)

        writer = PdfWriter()
        for i in range(start - 1, end):
            writer.add_page(reader.pages[i])

        with open(out_path, 'wb') as f:
            writer.write(f)

        size = os.path.getsize(out_path)
        results.append({
            'path':    out_path,
            'name':    out_filename,
            'pages':   end - start + 1,
            'start':   start,
            'end':     end,
            'size':    size,
        })

    print(json.dumps({"ok": True, "total": total, "files": results}, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "Usage: split_pdf.py <pdf> <output_dir> <ranges_json>"}))
        sys.exit(1)
    split_pdf(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]))
