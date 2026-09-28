#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extractor for Russian payment orders (Платёжные поручения / Платёжные ордера) from PDF.
Extracts: Номер, Дата, Сумма, Назначение платежа, Тип документа.

Fixes applied:
  1. Supports both «ПЛАТЁЖНОЕ ПОРУЧЕНИЕ» (0401060) and «ПЛАТЁЖНЫЙ ОРДЕР» (0401066).
  2. Deduplication by (number, date) pair — not just number, since the same
     payment number can legitimately repeat in different months.
"""

import re
import json
import logging
from typing import List, Dict, Any, Optional

logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger(__name__)

# ─── Regex patterns ───────────────────────────────────────────────────────────

# Header: matches both «Платёжное поручение» (0401060) and «Платёжный ордер» (0401066)
RE_PP_HEADER = re.compile(
    r'(?:ПЛАТЕЖН(?:ОЕ\s+ПОРУЧЕНИЕ|ЫЙ\s+ОРДЕР)|'
    r'Платежн(?:ое\s+поручение|ый\s+ордер)|'
    r'Плат\.?\s*(?:поруч|ордер)\.?)',
    re.IGNORECASE | re.UNICODE
)

# Number: after «ПОРУЧЕНИЕ №» or «ОРДЕР №» on the same line
RE_NUMBER = re.compile(
    r'(?:ПОРУЧЕНИЕ|ОРДЕР)\s*(?:№|N)\s*(\d{1,6})',
    re.IGNORECASE | re.UNICODE
)

# Fallback: any «№ NNN» or «N NNN» in first 300 chars of block
RE_NUMBER_ANY = re.compile(
    r'(?:№|N)\s*(\d{1,6})',
    re.IGNORECASE | re.UNICODE
)

# Date: DD.MM.YYYY
RE_DATE = re.compile(r'\b(\d{2}\.\d{2}\.\d{4})\b')

# Amount: «Сумма NNN.NN» or «Сумма NNN,NN» (ВТБ format: no colon, amount on same line)
RE_AMOUNT = re.compile(
    r'(?:^|\n)[^\n]*?Сумма\s+([\d\s]+[\.,]\d{2})',
    re.IGNORECASE | re.MULTILINE | re.UNICODE
)
# Fallback: «Сумма:» or «Итого:»
RE_AMOUNT_COLON = re.compile(
    r'(?:Сумма|Итого)\s*[:\s]\s*([\d\s]+[\.,]\d{2}(?:-\d{2})?)',
    re.IGNORECASE | re.UNICODE
)
# Fallback: large standalone amount (e.g. "1 500 000-00")
RE_AMOUNT_LINE = re.compile(
    r'^\s*((?:\d{1,3}\s){1,5}\d{3}[-,\.]\d{2})\s*$',
    re.MULTILINE
)

# Purpose — ВТБ style (ПП): text between «Получатель» label line and «Назначение платежа» label
RE_PURPOSE_BEFORE = re.compile(
    r'Получатель\s*\n(.*?)\nНазначение\s+платежа',
    re.DOTALL | re.UNICODE
)
# Purpose — classic: text after «Назначение платежа:»
RE_PURPOSE_AFTER = re.compile(
    r'Назначение\s+платежа\s*[:\s]+(.*?)(?=\nПодписи|\nОтметки|\n[А-ЯA-Z]{4,}|\Z)',
    re.IGNORECASE | re.DOTALL | re.UNICODE
)
# Purpose — ПО style: text on the NEXT line(s) after «Назначение платежа» row
# In ПО format the line reads «Назначение платежа Отметки банка» with purpose below it
RE_PURPOSE_PO = re.compile(
    r'Назначение\s+платежа[^\n]*\n(.*?)(?=\nНДС|\nИСПОЛНЕНО|\Z)',
    re.IGNORECASE | re.DOTALL | re.UNICODE
)

# Document type detector
RE_DOC_TYPE = re.compile(
    r'(ПЛАТЕЖН(?:ОЕ\s+ПОРУЧЕНИЕ|ЫЙ\s+ОРДЕР))',
    re.IGNORECASE | re.UNICODE
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def parse_amount(raw: str) -> float:
    if not raw:
        return 0.0
    cleaned = re.sub(r'\s+', '', raw)
    cleaned = re.sub(r'-(\d{2})$', r'.\1', cleaned)
    cleaned = cleaned.replace(',', '.')
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def format_amount(amount: float) -> str:
    if amount == 0:
        return '0,00'
    integer_part = int(amount)
    frac_part = round((amount - integer_part) * 100)
    s = f"{integer_part:,}".replace(',', ' ')
    return f"{s},{frac_part:02d}"


# ─── Field extractor ──────────────────────────────────────────────────────────

def extract_block_fields(block: str) -> Optional[Dict[str, Any]]:
    result: Dict[str, Any] = {
        'type': 'ПП',
        'number': None,
        'date': None,
        'amount': None,
        'amount_raw': None,
        'purpose': None,
    }

    # Document type
    m = RE_DOC_TYPE.search(block)
    if m:
        raw_type = m.group(1).upper()
        result['type'] = 'ПО' if 'ОРДЕР' in raw_type else 'ПП'

    # Number — prefer inline «ПОРУЧЕНИЕ/ОРДЕР № NNN»
    m = RE_NUMBER.search(block)
    if m:
        result['number'] = m.group(1)
    else:
        m2 = RE_NUMBER_ANY.search(block[:400])
        if m2:
            result['number'] = m2.group(1)

    # Date — first DD.MM.YYYY in block (header date)
    dates = RE_DATE.findall(block)
    if dates:
        result['date'] = dates[0]

    # Amount — «Сумма NNN.NN» inline (ВТБ format).
    # Take the FIRST non-zero match: in ПО there is also «Сумма ост. пл. → 0.00»
    # at the bottom of the form which must be ignored.
    all_amounts = RE_AMOUNT.findall(block)
    for raw in all_amounts:
        val = parse_amount(raw.strip())
        if val > 0:
            result['amount_raw'] = raw.strip()
            result['amount'] = val
            break
    if not result['amount']:
        m2 = RE_AMOUNT_COLON.search(block)
        if m2:
            result['amount_raw'] = m2.group(1).strip()
            result['amount'] = parse_amount(result['amount_raw'])
        if not result['amount']:
            m3 = RE_AMOUNT_LINE.search(block)
            if m3:
                val = parse_amount(m3.group(1).strip())
                if val > 0:
                    result['amount_raw'] = m3.group(1).strip()
                    result['amount'] = val

    # Purpose — three strategies in priority order:
    # 1. ВТБ-ПП style: text between standalone «Получатель\n» and «Назначение платежа»
    # 2. ПО style: text on next line(s) after «Назначение платежа ... Отметки банка»
    # 3. Classic style: text after «Назначение платежа:»
    purpose_raw = None

    m = RE_PURPOSE_BEFORE.search(block)
    if m:
        purpose_raw = m.group(1).strip()
        # Filter out account-number lines (Сч. № ...)
        lines = [
            l for l in purpose_raw.splitlines()
            if not re.match(r'^\s*Сч\.\s*№', l) and l.strip()
        ]
        purpose_raw = ' '.join(lines)
    else:
        # ПО style: purpose on next line(s) after «Назначение платежа Отметки банка»
        # Must try BEFORE RE_PURPOSE_AFTER to avoid "Отметки банка" being captured
        m3 = RE_PURPOSE_PO.search(block)
        if m3:
            purpose_raw = m3.group(1).strip()
            # ПО text is 2-column: left=purpose, right=bank stamp — split at ФИЛИАЛ/БИК marker
            lines_clean = []
            for line in purpose_raw.splitlines():
                # Trim bank-side content that leaks in from right column
                line = re.sub(r'\s+ФИЛИАЛ\b.*$', '', line)
                line = re.sub(r'\s+БИК\s+\d+.*$', '', line)
                line = re.sub(r'\s+к/с\s+\d+.*$', '', line)
                if line.strip():
                    lines_clean.append(line.strip())
            purpose_raw = ' '.join(lines_clean)
        else:
            m2 = RE_PURPOSE_AFTER.search(block)
            if m2:
                purpose_raw = m2.group(1).strip()

    if purpose_raw:
        purpose_raw = re.sub(r'\s{2,}', ' ', purpose_raw)
        result['purpose'] = purpose_raw[:400]

    # Must have number/date AND amount/purpose to count as a real document
    has_identity = result['number'] or result['date']
    has_content = result['amount'] or result['purpose']
    if not (has_identity and has_content):
        return None

    return result


# ─── Block splitter ───────────────────────────────────────────────────────────

def split_into_blocks(text: str) -> List[str]:
    """
    Split by payment document header (both ПП and ПО).
    Falls back to page markers if no headers found.
    """
    positions = [m.start() for m in RE_PP_HEADER.finditer(text)]

    if not positions:
        pages = re.split(r'--- Page \d+ ---', text)
        return [p.strip() for p in pages if p.strip()]

    blocks = []
    for i, pos in enumerate(positions):
        end = positions[i + 1] if i + 1 < len(positions) else len(text)
        blocks.append(text[pos:end])

    return blocks


# ─── Main extractor ───────────────────────────────────────────────────────────

def extract_payments_from_pdf(file_path: str) -> Dict[str, Any]:
    try:
        import pdfplumber
    except ImportError:
        return {'error': 'pdfplumber not installed', 'payments': [], 'total_count': 0, 'total_amount': 0}

    full_text_parts = []
    try:
        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text() or ''
                full_text_parts.append(f"--- Page {page_num} ---\n{text}")
    except Exception as e:
        return {'error': str(e), 'payments': [], 'total_count': 0, 'total_amount': 0}

    full_text = '\n\n'.join(full_text_parts)
    blocks = split_into_blocks(full_text)
    payments = []

    # Deduplication rules:
    # - ПП: deduplicate by (number, date) — same ПП can repeat in archive but is one document
    # - ПО: NO deduplication — every tranche (partial execution) is a separate row
    seen_pp_keys: set = set()

    RE_PAGE_MARKER = re.compile(r'--- Page (\d+) ---')

    for block in blocks:
        fields = extract_block_fields(block)
        if not fields:
            continue

        num   = fields.get('number') or ''
        date  = fields.get('date')  or ''
        dtype = fields.get('type', 'ПП')

        if dtype == 'ПП':
            amount_val = fields.get('amount') or 0.0
            dedup_key = (num, date, round(amount_val, 2))
            if num and dedup_key in seen_pp_keys:
                continue
            if num:
                seen_pp_keys.add(dedup_key)

        # Extract page number from the first «--- Page N ---» marker in the block
        page_match = RE_PAGE_MARKER.search(block)
        page_num = int(page_match.group(1)) if page_match else None

        payments.append({
            'type': fields['type'],
            'number': num or '—',
            'date': date or '—',
            'amount': fields['amount'] or 0.0,
            'amount_formatted': format_amount(fields['amount'] or 0.0),
            'purpose': fields['purpose'] or '—',
            'page': page_num,
        })

    total_amount = sum(p['amount'] for p in payments)

    return {
        'payments': payments,
        'total_count': len(payments),
        'total_amount': total_amount,
        'total_amount_formatted': format_amount(total_amount),
    }


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('file_path')
    args = parser.parse_args()
    result = extract_payments_from_pdf(args.file_path)
    print(json.dumps(result, ensure_ascii=False, indent=2))
