#!/usr/bin/env python3
"""
Применяет шаблон парсинга к PDF-файлу.
Вход:  argv[1] = путь к PDF
       stdin   = JSON { columns: [...], mappings: [...] }
Выход: stdout  = JSON { rows, stats }
"""
import sys
import json
import re

try:
    import pdfplumber
except ImportError:
    print(json.dumps({"error": "pdfplumber not installed"}))
    sys.exit(1)


def normalize_amount(val: str) -> str:
    """
    Приводит различные форматы сумм к единому: NNNNNN,NN
    806 376.80  ->  806376,80
    806 376-80  ->  806376,80
    806 376,80  ->  806376,80
    806376.80   ->  806376,80
    """
    v = val.strip()
    # Убираем пробелы между цифрами (тысячные разделители)
    v = re.sub(r'(\d)[\s\u00a0]+(\d)', r'\1\2', v)
    # Точку или дефис перед двумя цифрами на конце меняем на запятую
    v = re.sub(r'[.\-](\d{2})$', r',\1', v)
    # Если разделитель уже запятая — оставляем как есть
    v = v.replace(' ', '').replace('\u00a0', '')
    return v


def compile_safe(rx_str: str, flags: int):
    """Компилирует regex, возвращает None при ошибке."""
    try:
        return re.compile(rx_str, flags)
    except re.error:
        return None


def build_patterns(columns: list, mappings: list) -> list:
    """
    Для каждого маппинга строит список кандидатов-паттернов (от строгого к мягкому).
    Во время поиска берётся первый успешный.

    Стратегии (без DOTALL — не пересекаем строки):
      Уровень 1 (cb+ca, одна строка):  cb[ \\t]*(.+?)[ \\t]*ca
      Уровень 2 (cb, та же строка):    cb[ \\t]*([^\\n\\r]+)
      Уровень 3 (cb, следующая стр.):  cb[^\\n\\r]*\\n[ \\t]*([^\\n\\r]+)
      Уровень 4 (ca, та же строка):    ([^\\n\\r]+?)[ \\t]*ca
      Уровень 5 (только spanText):     exact(spanText)  [no group]
    """
    col_numeric = {c["id"]: c.get("isNumeric", False) for c in columns}
    flags = re.IGNORECASE | re.MULTILINE
    patterns = []

    for m in mappings:
        cb = m.get("contextBefore", "").strip()
        ca = m.get("contextAfter", "").strip()
        span = m.get("spanText", "").strip()

        candidates = []  # list of (compiled_rx, has_group)

        if cb and ca:
            # Ур. 1: значение между cb и ca на одной строке
            rx = compile_safe(re.escape(cb) + r'[ \t]*(.+?)[ \t]*' + re.escape(ca), flags)
            if rx:
                candidates.append((rx, True))

        if cb:
            # Ур. 2: значение после cb на той же строке
            rx = compile_safe(re.escape(cb) + r'[ \t]*([^\n\r]+)', flags)
            if rx:
                candidates.append((rx, True))
            # Ур. 3: значение на следующей строке после cb
            rx = compile_safe(re.escape(cb) + r'[^\n\r]*\n[ \t]*([^\n\r]+)', flags)
            if rx:
                candidates.append((rx, True))

        if ca:
            # Ур. 4: значение перед ca на той же строке
            rx = compile_safe(r'([^\n\r]+?)[ \t]*' + re.escape(ca), flags)
            if rx:
                candidates.append((rx, True))

        if span:
            # Ур. 5: буквальное вхождение spanText (последний шанс)
            rx = compile_safe(re.escape(span), flags)
            if rx:
                candidates.append((rx, False))

        patterns.append({
            "columnId":   m["columnId"],
            "candidates": candidates,
            "spanText":   span,
            "isNumeric":  col_numeric.get(m["columnId"], False),
            "cb_len":     len(cb),   # длина contextBefore — короткий cb = ненадёжный
        })

    return patterns


def best_match(candidates, text: str, span_text: str, cb_len: int = 999) -> str | None:
    """
    Пробует кандидатов по порядку (от строгого к мягкому).

    Для каждого кандидата собираем ВСЕ совпадения (finditer, не только первое),
    чтобы не застрять на ложном первом совпадении (например, "Сумма Прописью"
    вместо "Сумма 806 376.86" когда "Сумма" встречается дважды на странице).

    Логика выбора победителя:
    1. Идеальный: результат содержит spanText как подстроку → сразу возвращаем.
    2. Идеальный: spanText содержит результат (raw ⊆ spanText, min 2 символа) → сразу.
    3. Нейтральные: среди допустимых (≤ max(|spanText|×4, 60) символов)
       возвращаем ближайший по длине к spanText.
    4. Level-5 (прямой spanText): если spanText ≥ 5 символов и найден в тексте.
    """
    # Разделяем level-5 (no-group) от остальных
    level5 = None
    main_candidates = []
    for item in candidates:
        rx, has_group = item
        if not has_group:
            level5 = item
        else:
            main_candidates.append(item)

    non_ideal: list = []

    for rx, has_group in main_candidates:
        for match in rx.finditer(text):
            raw = (match.group(1) if has_group and match.lastindex else match.group(0)).strip()
            raw = re.sub(r'\s{2,}', ' ', raw)
            if not raw:
                continue
            # Идеал 1: spanText содержится в результате (проверяем ДО фильтра длины)
            if span_text and span_text.lower() in raw.lower():
                return raw
            # Идеал 2: результат является подстрокой spanText и при этом достаточно длинный
            # (минимум 50% от span_text или 5 символов — чтобы "024" не матчило "02.04.2024")
            min_sub_len = max(len(span_text) * 0.5, 5) if span_text else 5
            if span_text and len(raw) >= min_sub_len and raw.lower() in span_text.lower():
                return raw
            # Нейтральный: фильтруем слишком короткие (< 3 символов) — слишком неоднозначны
            if len(raw) >= 3:
                non_ideal.append(raw)

    # Если contextBefore слишком короткий (≤ 3 символа) — нейтральные кандидаты
    # слишком неоднозначны (одна цифра/буква встречается в тексте повсюду).
    # В этом случае возвращаем None, чтобы не давать заведомо ложные значения.
    if cb_len <= 3:
        pass  # пропускаем нейтральных кандидатов, переходим к level-5
    elif non_ideal:
        # Выбираем лучший нейтральный: ближайший по длине к spanText,
        # но не длиннее max(|spanText|×4, 60) символов.
        max_acceptable = max(len(span_text) * 4, 60) if span_text else 200
        acceptable = [r for r in non_ideal if len(r) <= max_acceptable]
        if acceptable:
            target = len(span_text) if span_text else 0
            # Если spanText содержит цифры, предпочитаем числовые результаты.
            span_has_digits = bool(re.search(r'\d', span_text)) if span_text else False
            if span_has_digits:
                numeric_like = [r for r in acceptable if re.search(r'\d', r)]
                if numeric_like:
                    return min(numeric_like, key=lambda r: abs(len(r) - target))
            return min(acceptable, key=lambda r: abs(len(r) - target))

    # Level-5: прямое вхождение spanText — только для строк ≥ 5 символов
    if level5 and span_text and len(span_text) >= 5:
        rx, _ = level5
        if rx.search(text):
            return span_text

    return None


def extract(pdf_path: str, template: dict) -> dict:
    columns  = template.get("columns", [])
    mappings = template.get("mappings", [])
    patterns = build_patterns(columns, mappings)

    page_from = int(template.get("pageFrom", 1) or 1)
    page_to   = int(template.get("pageTo",   0) or 0)  # 0 = до конца

    rows       = []
    total      = 0.0
    page_count = 0

    with pdfplumber.open(pdf_path) as pdf:
        page_count = len(pdf.pages)
        eff_to = page_to if page_to > 0 else page_count

        for page_num, page in enumerate(pdf.pages, start=1):
            if page_num < page_from or page_num > eff_to:
                continue
            text = page.extract_text() or ""
            if not text.strip():
                continue

            row = {}
            for p in patterns:
                raw = best_match(p["candidates"], text, p["spanText"], p.get("cb_len", 999))
                if raw is None:
                    continue

                val = normalize_amount(raw) if p["isNumeric"] else raw
                cid = p["columnId"]

                # Если для этой колонки уже есть значение — добавляем через пробел
                if cid in row:
                    row[cid] = (row[cid] + " " + val).strip()
                else:
                    row[cid] = val

            if row:
                row["_page"] = page_num
                rows.append(row)

    # Суммируем числовые колонки
    numeric_col_ids = {p["columnId"] for p in patterns if p["isNumeric"]}
    for row in rows:
        for cid in numeric_col_ids:
            if cid in row:
                try:
                    num_str = row[cid].replace(',', '.').replace('\u00a0', '').replace(' ', '')
                    total += float(num_str)
                except (ValueError, AttributeError):
                    pass
                break  # считаем только первую числовую колонку

    return {
        "rows": rows,
        "stats": {
            "pages":       page_count,
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
        tmpl   = json.load(sys.stdin)
        result = extract(sys.argv[1], tmpl)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)
