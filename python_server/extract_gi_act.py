#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Extractor for Акты гидроиспытаний (hydraulic testing acts).
Hybrid approach: Tesseract OCR for full page text + GPT Vision API for handwritten fragments.

Input:  argv[1] = path to PDF file
        stdin   = JSON config (optional, currently unused — fields are preset)
Output: stdout  = JSON { fields: [{key, value, confidence, rawOcr}], pageCount, pageText }
"""
import sys
import json
import os
import re
import base64
import tempfile
import subprocess
import logging

logging.basicConfig(level=logging.INFO, stream=sys.stderr)
logger = logging.getLogger(__name__)

# ── Field definitions ─────────────────────────────────────────────────────────
FIELD_KEYS = [
    "act_number",
    "act_date",
    "test_date",
    "heat_source",
    "pipeline_sections",
    "test_pressure",
    "pressure_duration",
    "pressure_drop",
    "makeup_water",
    "defects",
    "conclusions",
    "has_gku_signature",
]

FIELD_LABELS = {
    "act_number":        "Номер акта",
    "act_date":          "Дата акта",
    "test_date":         "Дата гидравлического испытания",
    "heat_source":       "Наименование теплоисточника (котельной/ЦТП)",
    "pipeline_sections": "Наименование и протяжённость участков тепловых сетей",
    "test_pressure":     "Пробное давление (МПа или кгс/см²)",
    "pressure_duration": "Время под давлением (мин/ч)",
    "pressure_drop":     "Снижение давления (МПа или кгс/см²)",
    "makeup_water":      "Расход подпиточной воды (л/ч или м³/ч)",
    "defects":           "Описание дефектов",
    "conclusions":       "Выводы и заключения комиссии",
    "has_gku_signature": "Наличие подписи представителя ГКУ МО МОС АВС (да/нет)",
}


# ── Utilities ─────────────────────────────────────────────────────────────────

def pdf_to_image_bytes(pdf_path: str, page_num: int = 1, dpi: int = 250) -> bytes | None:
    """Convert one PDF page to PNG bytes using pdftoppm."""
    try:
        with tempfile.TemporaryDirectory() as tmp:
            prefix = os.path.join(tmp, "page")
            result = subprocess.run(
                ["pdftoppm", "-png", "-f", str(page_num), "-l", str(page_num),
                 "-r", str(dpi), pdf_path, prefix],
                capture_output=True, timeout=60
            )
            if result.returncode != 0:
                logger.error(f"pdftoppm failed: {result.stderr.decode()}")
                return None
            img_file = f"{prefix}-{page_num}.png"
            if not os.path.exists(img_file):
                logger.error(f"Output file not found: {img_file}")
                return None
            with open(img_file, "rb") as f:
                return f.read()
    except Exception as e:
        logger.error(f"pdf_to_image_bytes error: {e}")
        return None


def preprocess_image(img_bytes: bytes) -> bytes:
    """OpenCV: grayscale + deskew + contrast enhancement for OCR."""
    try:
        import cv2
        import numpy as np
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        # Deskew
        try:
            coords = np.column_stack(np.where(gray < 200))
            if len(coords) > 100:
                angle = cv2.minAreaRect(coords)[-1]
                if angle < -45:
                    angle = 90 + angle
                if abs(angle) > 0.5:
                    h, w = gray.shape
                    M = cv2.getRotationMatrix2D((w // 2, h // 2), angle, 1.0)
                    gray = cv2.warpAffine(gray, M, (w, h),
                                          flags=cv2.INTER_CUBIC,
                                          borderMode=cv2.BORDER_REPLICATE)
        except Exception:
            pass
        denoised = cv2.fastNlMeansDenoising(gray, h=7)
        _, binary = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        ok, enc = cv2.imencode(".png", binary)
        return enc.tobytes() if ok else img_bytes
    except ImportError:
        return img_bytes
    except Exception as e:
        logger.warning(f"preprocess_image error: {e}")
        return img_bytes


def tesseract_ocr(img_bytes: bytes) -> str:
    """Run Tesseract OCR on image bytes, returns plain text."""
    try:
        import pytesseract
        from PIL import Image
        from io import BytesIO
        image = Image.open(BytesIO(img_bytes))
        return pytesseract.image_to_string(image, lang="rus+eng", config="--psm 6 --oem 3")
    except ImportError:
        pass
    # Fallback: subprocess
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            tmp.write(img_bytes)
            tmp_path = tmp.name
        result = subprocess.run(
            ["tesseract", tmp_path, "stdout", "-l", "rus+eng", "--psm", "6", "--oem", "3"],
            capture_output=True, text=True, timeout=120
        )
        os.unlink(tmp_path)
        return result.stdout
    except Exception as e:
        logger.error(f"tesseract_ocr error: {e}")
        return ""


def get_vision_provider(config: dict) -> dict | None:
    """
    Pick a vision-capable LLM provider from config/env, preferring a real
    OpenAI key (gpt-4o-mini) and falling back to StepFun (step-3.7-flash)
    when only that is available. StepFun's step-3.5-flash line does NOT
    support image input ("model doesnt support image input") — only
    step-3.7-flash (and presumably newer) does, verified empirically.
    """
    openai_key = config.get("openaiApiKey") or os.environ.get("OPENAI_API_KEY", "")
    if openai_key and openai_key.startswith("sk-"):
        return {
            "url": "https://api.openai.com/v1/chat/completions",
            "model": "gpt-4o-mini",
            "key": openai_key,
        }

    stepfun_key = (
        config.get("stepfunApiKey")
        or os.environ.get("StepFun", "")
        or os.environ.get("STEPFUN_API_KEY", "")
    )
    if stepfun_key:
        base_url = (config.get("stepfunApiUrl") or "https://api.stepfun.ai/step_plan/v1").rstrip("/")
        return {
            "url": f"{base_url}/chat/completions",
            "model": config.get("stepfunModel") or "step-3.7-flash",
            "key": stepfun_key,
            # step-3.7-flash is a reasoning model: it burns tokens on internal
            # "reasoning" content before emitting the final JSON answer, so it
            # needs a much larger max_tokens budget than a plain model like
            # gpt-4o-mini or it truncates with empty content (verified empirically).
            "max_tokens": 8000,
        }

    return None


def call_vision_api(img_bytes: bytes, fields_prompt: str, provider: dict) -> dict:
    """Call a vision-capable LLM (OpenAI or StepFun) to extract fields from image."""
    import urllib.request
    import urllib.error

    b64 = base64.b64encode(img_bytes).decode()
    payload = {
        "model": provider["model"],
        "max_tokens": provider.get("max_tokens", 2000),
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Это скан российского Акта гидравлического испытания тепловых сетей. "
                        "Извлеки из изображения следующие поля (рукописные и печатные).\n"
                        "Верни результат строго в формате JSON-объекта, где ключи — названия полей ниже.\n"
                        "Если поле не найдено или нечитаемо — укажи null.\n"
                        "Для поля has_gku_signature верни 'да' или 'нет'.\n\n"
                        f"Поля для извлечения:\n{fields_prompt}\n\n"
                        "ВАЖНО: отвечай ТОЛЬКО валидным JSON-объектом, без лишнего текста."
                    )
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"}
                }
            ]
        }]
    }

    req = urllib.request.Request(
        provider["url"],
        data=json.dumps(payload).encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {provider['key']}",
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
            content = data["choices"][0]["message"]["content"]
            cleaned = re.sub(r"```json\s*|\s*```", "", content).strip()
            first = cleaned.find("{")
            last = cleaned.rfind("}")
            if first != -1 and last != -1:
                cleaned = cleaned[first:last + 1]
            return json.loads(cleaned)
    except Exception as e:
        logger.error(f"Vision API error ({provider['model']}): {e}")
        return {}


# ── Regex extractors for printed fields ───────────────────────────────────────

_DATE_RE = re.compile(
    r'\b(\d{1,2}[\./]\d{1,2}[\./]\d{2,4}|'
    r'\d{1,2}\s+(?:январ[яь]|феврал[яь]|март[ае]|апрел[яь]|ма[йя]|июн[яь]|'
    r'июл[яь]|август[ае]|сентябр[яь]|октябр[яь]|ноябр[яь]|декабр[яь])\s+\d{4})\b',
    re.IGNORECASE | re.UNICODE
)
_PRESSURE_RE = re.compile(r'(\d+[.,]\d+|\d+)\s*(?:МПа|кгс/см|кгс\.?/см|атм)', re.IGNORECASE)
_ACT_NUM_RE = re.compile(r'(?:акт|№|No|N)\s*[№#]?\s*(\d+[\-/\w]*)', re.IGNORECASE)


def regex_extract(text: str) -> dict:
    """Fast regex extraction for well-structured printed fields."""
    result = {}

    # Act number
    m = _ACT_NUM_RE.search(text[:500])
    if m:
        result["act_number"] = m.group(1).strip()

    # Dates — find all, first = act_date, look for "испытани" context for test_date
    dates = _DATE_RE.findall(text)
    if dates:
        result["act_date"] = dates[0]
        # Try to find test date near keywords
        for kw in ["испытани", "проведен", "дата испыт"]:
            idx = text.lower().find(kw)
            if idx != -1:
                snippet = text[max(0, idx - 20):idx + 150]
                m2 = _DATE_RE.search(snippet)
                if m2:
                    result["test_date"] = m2.group()
                    break
        if len(dates) > 1 and "test_date" not in result:
            result["test_date"] = dates[1]

    # Pressure
    pressures = _PRESSURE_RE.findall(text)
    if pressures:
        result["test_pressure"] = pressures[0] + " МПа/кгс"

    return result


def merge_fields(regex_fields: dict, vision_fields: dict) -> list:
    """Merge regex and Vision results into field list with confidence scores."""
    merged = []
    for key in FIELD_KEYS:
        vision_val = vision_fields.get(key)
        regex_val = regex_fields.get(key)

        if vision_val and str(vision_val).strip() and str(vision_val) != "null":
            value = str(vision_val).strip()
            confidence = "0.85"
            raw = str(regex_val or "")
        elif regex_val:
            value = str(regex_val).strip()
            confidence = "0.70"
            raw = value
        else:
            value = None
            confidence = "0.0"
            raw = ""

        merged.append({
            "key": key,
            "value": value,
            "confidence": confidence,
            "rawOcr": raw,
        })
    return merged


# ── Main extraction ───────────────────────────────────────────────────────────

def extract(pdf_path: str, config: dict) -> dict:
    vision_provider = get_vision_provider(config)
    use_vision = vision_provider is not None

    if not os.path.exists(pdf_path):
        return {"error": f"File not found: {pdf_path}", "fields": [], "pageCount": 0}

    # Get page count
    try:
        r = subprocess.run(["pdfinfo", pdf_path], capture_output=True, text=True, timeout=10)
        page_count = 0
        for line in r.stdout.splitlines():
            if line.startswith("Pages:"):
                page_count = int(line.split(":")[1].strip())
                break
    except Exception:
        page_count = 1

    if page_count == 0:
        page_count = 1

    # Process first page (primary content of act)
    img_bytes = pdf_to_image_bytes(pdf_path, page_num=1, dpi=250)
    if img_bytes is None:
        return {"error": "Failed to convert PDF to image", "fields": [], "pageCount": page_count}

    processed = preprocess_image(img_bytes)
    ocr_text = tesseract_ocr(processed)

    # Regex extraction from OCR text
    regex_fields = regex_extract(ocr_text)

    # Vision extraction if API key available
    vision_fields = {}
    if use_vision:
        fields_prompt = "\n".join(
            f"- {key}: {label}"
            for key, label in FIELD_LABELS.items()
        )
        vision_fields = call_vision_api(img_bytes, fields_prompt, vision_provider)
        logger.info(f"Vision API ({vision_provider['model']}) returned {len(vision_fields)} fields")
    else:
        logger.info("No vision-capable API key — using Tesseract only")

    fields = merge_fields(regex_fields, vision_fields)

    # Compute average confidence (for fields that have a value)
    conf_values = [float(f["confidence"]) for f in fields if f["value"]]
    avg_conf = round(sum(conf_values) / len(conf_values), 2) if conf_values else 0.0

    return {
        "fields": fields,
        "pageCount": page_count,
        "avgConfidence": avg_conf,
        "ocrText": ocr_text[:2000],
        "usedVision": use_vision,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No PDF path provided", "fields": [], "pageCount": 0}))
        sys.exit(1)

    try:
        config = {}
        try:
            config = json.load(sys.stdin)
        except Exception:
            pass
        result = extract(sys.argv[1], config)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e), "fields": [], "pageCount": 0}))
        sys.exit(1)
