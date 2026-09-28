#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Document Parser for Office Files
Extracts text from PDF, DOCX, XLSX, PPTX, and TXT files
Supports OCR for scanned PDFs and visual analysis
"""

import os
import sys
import json
import base64
import logging
from typing import Optional, Dict, List, Any
from pathlib import Path
import subprocess

# Ensure UTF-8 encoding for stdout/stderr
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')
if sys.stderr.encoding != 'utf-8':
    sys.stderr.reconfigure(encoding='utf-8')

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try importing optional dependencies
try:
    import pytesseract
    HAS_PYTESSERACT = True
except ImportError:
    HAS_PYTESSERACT = False
    logger.warning("pytesseract not available. OCR features will use subprocess.")

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False
    logger.warning("OpenCV not available. Image preprocessing disabled.")

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    logger.warning("Pillow not available. Image processing limited.")

def get_pdf_page_count(pdf_path: str) -> int:
    """
    Get number of pages in PDF using pdfinfo (from poppler-utils)
    
    Args:
        pdf_path: Path to PDF file
    
    Returns:
        Number of pages or 0 if failed
    """
    try:
        result = subprocess.run(
            ['pdfinfo', pdf_path],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0:
            for line in result.stdout.split('\n'):
                if line.startswith('Pages:'):
                    return int(line.split(':')[1].strip())
        return 0
    except Exception as e:
        logger.warning(f"Failed to get PDF page count: {e}")
        return 0


def convert_pdf_page_to_image(pdf_path: str, page_num: int, dpi: int = 300) -> Optional[bytes]:
    """
    Convert PDF page to PNG image using pdftoppm (from poppler-utils)
    
    Args:
        pdf_path: Path to PDF file
        page_num: Page number (0-indexed)
        dpi: Resolution for rendering (higher = better quality but slower)
    
    Returns:
        PNG image as bytes or None if failed
    """
    import tempfile
    import shutil
    
    try:
        # Create temporary directory for output
        with tempfile.TemporaryDirectory() as temp_dir:
            output_prefix = os.path.join(temp_dir, 'page')
            
            # pdftoppm uses 1-indexed pages
            first_page = page_num + 1
            
            # Convert specific page to PNG (60 second timeout for complex pages)
            result = subprocess.run(
                [
                    'pdftoppm',
                    '-png',
                    '-f', str(first_page),
                    '-l', str(first_page),
                    '-r', str(dpi),
                    pdf_path,
                    output_prefix
                ],
                capture_output=True,
                timeout=60
            )
            
            if result.returncode != 0:
                logger.error(f"pdftoppm failed: {result.stderr.decode()}")
                return None
            
            # pdftoppm creates files like "page-1.png"
            output_file = f"{output_prefix}-{first_page}.png"
            
            if not os.path.exists(output_file):
                logger.error(f"Expected output file not found: {output_file}")
                return None
            
            # Read PNG file as bytes
            with open(output_file, 'rb') as f:
                img_bytes = f.read()
            
            logger.info(f"Converted page {page_num + 1} to PNG ({len(img_bytes)} bytes)")
            return img_bytes
            
    except Exception as e:
        logger.error(f"Error converting PDF page to image: {e}")
        return None


def preprocess_image_for_ocr(image_bytes: bytes) -> bytes:
    """
    Preprocess image for better OCR accuracy.
    Applies: grayscale, deskew, denoising, binarization.
    Returns original bytes if preprocessing fails.
    """
    if not HAS_OPENCV or not HAS_PIL:
        return image_bytes
    
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Deskew: detect rotation angle and correct it
        try:
            coords = np.column_stack(np.where(gray < 200))
            if len(coords) > 100:
                angle = cv2.minAreaRect(coords)[-1]
                if angle < -45:
                    angle = 90 + angle
                if abs(angle) > 0.5:  # Only correct if angle > 0.5 degrees
                    (h, w) = gray.shape
                    center = (w // 2, h // 2)
                    M = cv2.getRotationMatrix2D(center, angle, 1.0)
                    gray = cv2.warpAffine(gray, M, (w, h),
                                          flags=cv2.INTER_CUBIC,
                                          borderMode=cv2.BORDER_REPLICATE)
                    logger.info(f"Deskewed image by {angle:.2f} degrees")
        except Exception as e:
            logger.debug(f"Deskew failed (non-critical): {e}")
        
        # Denoise (light — preserve text sharpness)
        denoised = cv2.fastNlMeansDenoising(gray, h=7)
        
        # Otsu binarization (better than adaptive for uniform backgrounds)
        _, binary = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
        
        success, encoded = cv2.imencode('.png', binary)
        if success:
            return encoded.tobytes()
        return image_bytes
    except Exception as e:
        logger.warning(f"Image preprocessing failed: {e}. Using original image.")
        return image_bytes


def _detect_and_correct_rotation(image: 'Image') -> 'Image':
    """
    Detect page rotation via Tesseract OSD and return corrected PIL Image.
    Handles 90°, 180°, 270° rotations that simple deskew cannot fix.
    """
    if not HAS_PYTESSERACT:
        return image
    try:
        osd = pytesseract.image_to_osd(image, config='--psm 0 --oem 3')
        rotate_line = [l for l in osd.splitlines() if 'Rotate' in l]
        if rotate_line:
            angle = int(rotate_line[0].split(':')[1].strip())
            if angle != 0:
                logger.info(f"OSD detected rotation: {angle}°, correcting...")
                return image.rotate(-angle, expand=True)
    except Exception as e:
        logger.debug(f"OSD rotation detection skipped: {e}")
    return image


def _merge_to_searchable_pdf(page_pdf_bytes_list: list, source_path: str) -> Optional[str]:
    """
    Merge per-page searchable PDFs (from pytesseract) into a single PDF file.
    The result preserves each page as an image with an invisible OCR text layer,
    enabling text search and highlight in PDF viewers (PDF.js, Adobe, etc.).

    Returns the output file path, or None if merge failed.
    """
    try:
        from pypdf import PdfReader, PdfWriter
        from io import BytesIO as _BytesIO

        writer = PdfWriter()
        for page_bytes in page_pdf_bytes_list:
            reader = PdfReader(_BytesIO(page_bytes))
            for page in reader.pages:
                writer.add_page(page)

        base = os.path.splitext(source_path)[0]
        out_path = f"{base}_searchable.pdf"
        with open(out_path, 'wb') as f:
            writer.write(f)

        logger.info(f"Searchable PDF saved: {out_path} ({len(page_pdf_bytes_list)} pages)")
        return out_path
    except Exception as e:
        logger.error(f"Failed to merge searchable PDF: {e}")
        return None


def ocr_image(image_bytes: bytes, lang: str = 'eng+rus') -> str:
    """
    Perform OCR on image using Tesseract.
    Rotation is expected to be corrected upstream via _detect_and_correct_rotation.
    """
    tesseract_config = '--psm 3 --oem 3'

    if HAS_PYTESSERACT and HAS_PIL:
        try:
            from io import BytesIO
            image = Image.open(BytesIO(image_bytes))
            text = pytesseract.image_to_string(image, lang=lang, config=tesseract_config)
            return text.strip()
        except Exception as e:
            logger.warning(f"pytesseract failed: {e}. Trying subprocess...")

    # Fallback to subprocess tesseract
    try:
        import tempfile
        with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as tmp:
            tmp.write(image_bytes)
            tmp_path = tmp.name
        try:
            result = subprocess.run(
                ['tesseract', tmp_path, 'stdout', '-l', lang, '--psm', '3', '--oem', '3'],
                capture_output=True, text=True, timeout=180
            )
            return result.stdout.strip()
        finally:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
    except subprocess.TimeoutExpired:
        logger.warning("OCR timeout exceeded (180s), skipping page")
        return ""
    except Exception as e:
        logger.error(f"OCR failed: {e}")
        return ""


def extract_text_from_pdf_with_pages(file_path: str) -> Dict[str, Any]:
    """
    Extract text from PDF with page-by-page details and text coordinates
    
    Args:
        file_path: Path to PDF file
    
    Returns:
        {
            'pages': [
                {
                    'pageNumber': int,
                    'text': str,
                    'spans': [{'x': float, 'y': float, 'width': float, 'height': float, 'text': str}],
                    'extractionMethod': 'text' | 'ocr' | 'hybrid'
                }
            ],
            'totalPages': int,
            'method': str
        }
    """
    try:
        import pdfplumber
        
        pages_data = []
        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                page_data = {
                    'pageNumber': page_num,
                    'text': '',
                    'spans': [],
                    'extractionMethod': 'text'
                }
                
                # Extract text only (word-coordinate extraction skipped — not used downstream)
                text = page.extract_text()
                if text:
                    page_data['text'] = text
                
                pages_data.append(page_data)
        
        return {
            'pages': pages_data,
            'totalPages': len(pages_data),
            'method': 'text'
        }
    except ImportError:
        logger.warning("pdfplumber not installed. Install with: pip install pdfplumber")
        return {
            'pages': [],
            'totalPages': 0,
            'method': 'error',
            'error': 'pdfplumber library not installed'
        }
    except Exception as e:
        logger.error(f"Error extracting PDF with pages: {e}")
        return {
            'pages': [],
            'totalPages': 0,
            'method': 'error',
            'error': str(e)
        }


def _cyrillic_ratio(text: str) -> float:
    """Return fraction of Cyrillic characters in text."""
    if not text:
        return 0.0
    cyrillic = sum(1 for c in text if '\u0400' <= c <= '\u04FF')
    return cyrillic / len(text)

def _garbled_ratio(text: str) -> float:
    """Return fraction of likely-garbled characters (control chars, replacement chars, box-drawing)."""
    if not text:
        return 0.0
    garbled = sum(
        1 for c in text
        if (ord(c) < 0x20 and c not in '\n\r\t')
        or c == '\uFFFD'
        or '\u2580' <= c <= '\u259F'
        or '\u2500' <= c <= '\u257F'
    )
    return garbled / len(text)

def _try_reencode_text(text: str) -> str:
    """
    If extracted text looks like it was mis-decoded (high garbled ratio,
    low Cyrillic), try to re-interpret raw bytes as CP1251 or CP866.
    Returns the best-decoded version, or original if already good.
    """
    garbled = _garbled_ratio(text)
    cyrillic = _cyrillic_ratio(text)

    if garbled < 0.05 and cyrillic > 0.05:
        return text

    if garbled < 0.20 and cyrillic > 0.15:
        return text

    logger.warning(
        f"PDF text may be mis-encoded (garbled={garbled:.2%}, cyrillic={cyrillic:.2%}). "
        f"Attempting re-encoding..."
    )

    best_text = text
    best_score = cyrillic - garbled * 2

    for enc in ('cp1251', 'cp866', 'latin-1'):
        try:
            raw_bytes = text.encode('latin-1', errors='replace')
            candidate = raw_bytes.decode(enc, errors='replace')
            c_ratio = _cyrillic_ratio(candidate)
            g_ratio = _garbled_ratio(candidate)
            score = c_ratio - g_ratio * 2
            if score > best_score:
                best_score = score
                best_text = candidate
                logger.info(
                    f"Re-encoding with {enc} improved score: "
                    f"cyrillic={c_ratio:.2%}, garbled={g_ratio:.2%}"
                )
        except Exception as e:
            logger.debug(f"Re-encoding attempt {enc} failed: {e}")

    if best_text is not text:
        logger.info("Text re-encoding applied.")
    else:
        logger.warning("Re-encoding did not improve text quality; keeping original.")

    return best_text


def extract_text_from_pdf_basic(file_path: str) -> str:
    """
    Extract text from machine-readable PDF using pdfplumber.
    Attempts automatic re-encoding if extracted text appears garbled (CP1251/CP866 PDFs).
    
    Args:
        file_path: Path to PDF file
    
    Returns:
        Extracted text with --- Page N --- markers
    """
    try:
        import pdfplumber
        
        text_parts = []
        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text()
                if text:
                    fixed = _try_reencode_text(text)
                    text_parts.append(f"--- Page {page_num} ---\n{fixed}")
        
        return "\n\n".join(text_parts)
    except ImportError:
        logger.warning("pdfplumber not installed. Install with: pip install pdfplumber")
        return "[PDF parsing requires pdfplumber library]"
    except Exception as e:
        logger.error(f"Error extracting PDF text: {e}")
        return f"[Error extracting PDF: {str(e)}]"


def extract_text_from_pdf(file_path: str, use_ocr: bool = True, advanced: bool = False) -> Dict[str, Any]:
    """
    Advanced PDF text extraction with 3-level approach:
    1. Basic text extraction (fast, for machine-readable PDFs)
    2. OCR for scanned PDFs (medium speed)
    3. Visual analysis preparation (returns images for Qwen3-VL)
    
    Args:
        file_path: Path to PDF file
        use_ocr: Enable OCR for scanned PDFs
        advanced: Return additional metadata and images for visual analysis
    
    Returns:
        {
            'text': str,              # Extracted text
            'method': str,            # 'text' | 'ocr' | 'hybrid'
            'page_images': List[str], # Base64 encoded page images (if advanced=True)
            'confidence': float,      # Extraction confidence (0-1)
            'page_count': int         # Number of pages
        }
    """
    result = {
        'text': '',
        'method': 'text',
        'page_images': [],
        'confidence': 1.0,
        'page_count': 0
    }
    
    try:
        # First, try basic text extraction
        basic_text = extract_text_from_pdf_basic(file_path)
        result['text'] = basic_text
        
        # Check if we got meaningful text
        text_density = len(basic_text.strip()) / max(os.path.getsize(file_path) / 1024, 1)  # chars per KB
        has_good_text = text_density > 10 and len(basic_text.strip()) > 50
        
        if not has_good_text and use_ocr:
            # PDF appears to be scanned, try OCR
            logger.info(f"Low text density ({text_density:.1f} chars/KB). Attempting OCR...")
            logger.info(f"Advanced mode: {advanced}")  # DEBUG
            result['method'] = 'ocr'
            result['confidence'] = 0.7
            
            # Always attempt OCR/Vision processing (don't require PyMuPDF)
            try:
                page_count = get_pdf_page_count(file_path)
                result['page_count'] = page_count
                
                if page_count == 0:
                    logger.warning("Could not determine PDF page count")
                    page_count = 1  # Assume at least 1 page
                
                # Limit OCR to first 50 pages to prevent hanging on very large documents
                MAX_OCR_PAGES = 50
                pages_to_process = min(page_count, MAX_OCR_PAGES)
                if page_count > MAX_OCR_PAGES:
                    logger.warning(f"PDF has {page_count} pages, limiting OCR to first {MAX_OCR_PAGES} pages")
                
                from io import BytesIO as _PageBytesIO

                ocr_texts = []
                searchable_pages = []  # per-page searchable PDF bytes

                for page_num in range(pages_to_process):
                    logger.info(f"OCR processing page {page_num + 1}/{page_count}...")

                    # Convert page to image — 300 DPI for reliable OCR on complex documents
                    img_bytes = convert_pdf_page_to_image(file_path, page_num, dpi=300)
                    if not img_bytes:
                        logger.warning(f"Failed to convert page {page_num + 1} to image")
                        continue

                    # Store raw image for visual analysis (before any modification)
                    if advanced:
                        img_b64 = base64.b64encode(img_bytes).decode('utf-8')
                        result['page_images'].append(img_b64)

                    # ── Step 1: Detect and correct rotation (90°/180°/270°) ──────────────
                    if HAS_PIL and HAS_PYTESSERACT:
                        try:
                            pil_img = Image.open(_PageBytesIO(img_bytes))
                            pil_img = _detect_and_correct_rotation(pil_img)

                            # ── Step 2: Generate searchable PDF page ──────────────────────
                            # pytesseract embeds an invisible OCR text layer over the image,
                            # enabling highlight in PDF.js / Adobe without losing scan visuals.
                            try:
                                page_pdf_bytes = pytesseract.image_to_pdf_or_hocr(
                                    pil_img, extension='pdf',
                                    lang='eng+rus', config='--psm 3 --oem 3'
                                )
                                searchable_pages.append(page_pdf_bytes)
                                logger.info(f"Searchable PDF page {page_num + 1} generated ({len(page_pdf_bytes)} bytes)")
                            except Exception as e:
                                logger.warning(f"Searchable PDF page {page_num + 1} failed: {e}")

                            # Convert corrected (but un-preprocessed) image back to bytes
                            buf = _PageBytesIO()
                            pil_img.save(buf, format='PNG')
                            img_bytes = buf.getvalue()
                        except Exception as e:
                            logger.warning(f"Rotation/searchable-PDF step failed for page {page_num + 1}: {e}")

                    # ── Step 3: Preprocess for better OCR text accuracy ───────────────────
                    if HAS_OPENCV:
                        img_bytes = preprocess_image_for_ocr(img_bytes)

                    # ── Step 4: Extract text ──────────────────────────────────────────────
                    page_text = ocr_image(img_bytes, lang='eng+rus')
                    if page_text:
                        logger.info(f"OCR extracted {len(page_text)} chars from page {page_num + 1}")
                        ocr_texts.append(f"--- Page {page_num + 1} ---\n{page_text}")
                    else:
                        logger.warning(f"OCR produced no text for page {page_num + 1}")

                # ── Merge per-page PDFs into one searchable PDF ───────────────────────────
                if searchable_pages:
                    searchable_path = _merge_to_searchable_pdf(searchable_pages, file_path)
                    if searchable_path:
                        result['searchable_pdf_path'] = searchable_path

                logger.info(
                    f"OCR completed. pages={len(ocr_texts)}, "
                    f"searchable_pdf={'yes' if searchable_pages else 'no'}"
                )

                if ocr_texts:
                    result['text'] = "\n\n".join(ocr_texts)
                    result['method'] = 'ocr'
                else:
                    logger.warning("OCR produced no text. Marking for visual analysis.")
                    if result['page_images']:
                        result['method'] = 'vision'
                        result['confidence'] = 0.3
                    else:
                        result['method'] = 'hybrid'
            except Exception as e:
                logger.error(f"OCR processing failed: {e}")
                result['method'] = 'text'
                result['confidence'] = 0.5
        
        # If advanced mode and we haven't generated images yet, do it now
        if advanced and not result['page_images']:
            try:
                page_count = get_pdf_page_count(file_path)
                if page_count > 0:
                    result['page_count'] = page_count
                    for page_num in range(min(page_count, 5)):  # Limit to first 5 pages
                        img_bytes = convert_pdf_page_to_image(file_path, page_num, dpi=200)
                        if img_bytes:
                            img_b64 = base64.b64encode(img_bytes).decode('utf-8')
                            result['page_images'].append(img_b64)
            except Exception as e:
                logger.warning(f"Failed to generate page images: {e}")
        
        # Determine final method: if we have images but no/poor text, mark as "vision"
        if result['page_images'] and len(result['page_images']) > 0:
            # If text is empty/placeholder or very low confidence, this should be vision
            text_is_poor = (
                not result['text'].strip() or
                result['text'].startswith('[Error') or
                result['text'].startswith('[PDF parsing') or
                len(result['text'].strip()) < 50
            )
            
            # Mark as vision if we have images but poor/no text (regardless of current method)
            if text_is_poor and result['method'] in ['text', 'hybrid', 'ocr']:
                # We have images but no good text - mark as vision for Qwen3-VL processing
                result['method'] = 'vision'
                result['confidence'] = 0.3  # Low confidence since we need vision analysis
                logger.info(f"Marked as 'vision' method - images available but text extraction failed")
        
        return result
        
    except Exception as e:
        logger.error(f"PDF extraction failed: {e}")
        return {
            'text': f"[Error extracting PDF: {str(e)}]",
            'method': 'error',
            'page_images': [],
            'confidence': 0.0,
            'page_count': 0
        }



def get_docx_page_count(file_path: str, text_length: int = 0) -> int:
    """
    Get page count from DOCX file using multiple methods:
    1. Read from app.xml metadata (set by Word/LibreOffice) - accurate if available
    2. Count page breaks in document body - reliable if breaks present
    3. Estimate from text length - fallback method
    
    Note: For DOCX files, accurate page count is difficult to determine without rendering.
    This function returns best-effort estimates.
    
    Args:
        file_path: Path to DOCX file
        text_length: Length of extracted text (for estimation)
    
    Returns:
        Number of pages (minimum 1, or 0 if no data available)
    """
    page_count_from_metadata = 0
    page_count_from_breaks = 0
    page_count_from_text = 0
    
    # Method 1: Read from app.xml metadata
    try:
        import zipfile
        import xml.etree.ElementTree as ET
        
        with zipfile.ZipFile(file_path, 'r') as zip_ref:
            if 'docProps/app.xml' in zip_ref.namelist():
                xml_content = zip_ref.read('docProps/app.xml')
                root = ET.fromstring(xml_content)
                
                # Search for Pages element with namespace
                namespaces = {
                    'ep': 'http://schemas.openxmlformats.org/officeDocument/2006/extended-properties'
                }
                pages_elem = root.find('.//ep:Pages', namespaces)
                
                if pages_elem is not None and pages_elem.text:
                    page_count_from_metadata = max(0, int(pages_elem.text))
                    
    except Exception as e:
        logger.debug(f"Could not read page count from metadata: {e}")
    
    # Method 2: Count page breaks in document (DISABLED - too slow for large docs)
    # For large documents (>500 paragraphs), this can take minutes
    # Skip this method and rely on metadata or text estimation instead
    try:
        # OPTIMIZATION: Skip page break counting for performance
        logger.debug("Skipping page break counting (performance optimization)")
    except Exception as e:
        logger.debug(f"Could not count page breaks: {e}")
    
    # Method 3: Estimate from text length
    # Average: ~2500 chars/page for Russian text with tables
    if text_length > 0:
        page_count_from_text = max(1, round(text_length / 2500))
    
    # Determine final count using priority logic:
    # 1. If metadata > 0, use it (reliable - Word/LibreOffice sets accurate page count)
    # 2. If page breaks > 0, use them (more accurate than text estimation)
    # 3. Otherwise use text estimation as fallback
    # 4. Return 0 if no method available (indicates unknown page count)
    if page_count_from_metadata > 0:
        final_count = page_count_from_metadata
        logger.info(f"Using metadata page count: {final_count}")
    elif page_count_from_breaks > 0:
        final_count = page_count_from_breaks
        logger.info(f"Using page break count: {final_count} (text_est={page_count_from_text})")
    elif page_count_from_text > 0:
        final_count = page_count_from_text
        logger.info(f"Using text-based estimate: {final_count} (~{text_length} chars / 2500 chars/page)")
    else:
        final_count = 0
        logger.info(f"Unable to determine page count (no metadata, breaks, or text)")
    
    logger.info(f"Page count determination: metadata={page_count_from_metadata}, breaks={page_count_from_breaks}, text_est={page_count_from_text}, final={final_count}")
    
    return final_count

def extract_text_from_docx(file_path: str) -> Dict[str, Any]:
    """
    Extract text from DOCX file with metadata and detailed error handling
    
    Returns:
        Dict with 'text', 'page_count', and 'error_type' keys
    """
    try:
        from docx import Document
        
        logger.info(f"Opening DOCX file: {file_path}")
        
        # Check if file exists and is accessible
        if not os.path.exists(file_path):
            logger.error(f"DOCX file not found: {file_path}")
            return {
                'text': "[Ошибка: Файл не найден. Возможно, проблема с кодировкой имени файла.]",
                'page_count': 0,
                'error_type': 'file_not_found'
            }
        
        # Check file size
        file_size = os.path.getsize(file_path)
        logger.info(f"DOCX file size: {file_size} bytes")
        
        if file_size == 0:
            logger.error("DOCX file is empty (0 bytes)")
            return {
                'text': "[Ошибка: Файл пустой (0 байт)]",
                'page_count': 0,
                'error_type': 'empty_file'
            }
        
        # Try to open the document
        try:
            doc = Document(file_path)
        except Exception as open_error:
            logger.error(f"Failed to open DOCX file: {open_error}")
            error_msg = str(open_error)
            
            # Provide specific error messages based on error type
            if 'BadZipFile' in error_msg or 'zipfile' in error_msg.lower():
                return {
                    'text': "[Ошибка: Файл поврежден или имеет неверную структуру DOCX (не является корректным ZIP-архивом)]",
                    'page_count': 0,
                    'error_type': 'corrupted_structure'
                }
            elif 'PermissionError' in error_msg:
                return {
                    'text': "[Ошибка: Нет доступа к файлу (проблема с правами доступа)]",
                    'page_count': 0,
                    'error_type': 'permission_denied'
                }
            else:
                return {
                    'text': f"[Ошибка открытия DOCX: {error_msg}]",
                    'page_count': 0,
                    'error_type': 'open_failed'
                }
        
        text_parts = []
        
        # Extract paragraphs with error handling
        paragraph_count = 0
        try:
            for para in doc.paragraphs:
                try:
                    if para.text and para.text.strip():
                        text_parts.append(para.text)
                        paragraph_count += 1
                except Exception as e:
                    logger.warning(f"Skipping paragraph due to error: {e}")
                    continue
        except Exception as e:
            logger.warning(f"Error extracting paragraphs: {e}")
        
        logger.info(f"Extracted {paragraph_count} paragraphs from DOCX")
        
        # Extract tables with error handling and strict limits (performance optimization)
        table_count = 0
        MAX_TABLES = 30  # Limit number of tables (large docs can have 50+ tables!)
        MAX_ROWS_PER_TABLE = 100  # Limit rows per table (some tables have 500+ rows!)
        MAX_TOTAL_CHARS = 500000  # Stop if we've extracted 500k chars (~200k tokens)
        
        try:
            logger.info(f"Starting table extraction (max {MAX_TABLES} tables, {MAX_ROWS_PER_TABLE} rows each, {MAX_TOTAL_CHARS} char limit)")
            total_chars = sum(len(p) for p in text_parts)
            
            for table_idx, table in enumerate(doc.tables):
                # Check character limit BEFORE processing table
                if total_chars >= MAX_TOTAL_CHARS:
                    logger.warning(f"Reached character limit ({MAX_TOTAL_CHARS}), stopping table extraction at table {table_idx}")
                    break
                    
                if table_idx >= MAX_TABLES:
                    logger.warning(f"Reached table limit ({MAX_TABLES}), skipping remaining tables")
                    break
                
                # Progress logging every 5 tables
                if table_idx > 0 and table_idx % 5 == 0:
                    logger.info(f"Progress: Processed {table_idx} tables, {table_count} rows, {total_chars} chars")
                    
                try:
                    for row_idx, row in enumerate(table.rows):
                        # Check character limit INSIDE row loop (critical!)
                        if total_chars >= MAX_TOTAL_CHARS:
                            logger.warning(f"Reached character limit ({MAX_TOTAL_CHARS}) inside table {table_idx}, stopping extraction")
                            break
                            
                        if row_idx >= MAX_ROWS_PER_TABLE:
                            logger.warning(f"Reached row limit ({MAX_ROWS_PER_TABLE}) for table {table_idx}, skipping remaining rows")
                            break
                            
                        try:
                            row_text = " | ".join(cell.text.strip() if cell.text else "" for cell in row.cells)
                            if row_text.strip():
                                text_parts.append(row_text)
                                table_count += 1
                                total_chars += len(row_text)
                        except Exception as e:
                            logger.warning(f"Skipping table {table_idx} row {row_idx} due to error: {e}")
                            continue
                    
                    # If we broke out due to char limit, also break outer loop
                    if total_chars >= MAX_TOTAL_CHARS:
                        break
                        
                except Exception as e:
                    logger.warning(f"Skipping table {table_idx} due to error: {e}")
                    continue
        except Exception as e:
            logger.warning(f"Error extracting tables: {e}")
        
        logger.info(f"Extracted {table_count} table rows from DOCX (total {total_chars} chars)")
        
        # Join text before calculating page count
        total_text = "\n".join(text_parts) if text_parts else ""
        
        # Get page count using metadata, breaks, and text length
        page_count = get_docx_page_count(file_path, len(total_text))
        
        if not text_parts:
            logger.warning("DOCX document appears empty - no paragraphs or tables with text")
            return {
                'text': "[Документ не содержит текста. Возможно, документ содержит только изображения или пустые элементы.]",
                'page_count': page_count,
                'error_type': 'no_text_content'
            }
        
        logger.info(f"Total DOCX text extracted: {len(total_text)} characters, pages: {page_count}")
        
        return {
            'text': total_text,
            'page_count': page_count
        }
    except ImportError:
        logger.error("python-docx not installed. Install with: pip install python-docx")
        return {
            'text': "[DOCX parsing requires python-docx library]",
            'page_count': 0,
            'error_type': 'library_missing'
        }
    except Exception as e:
        logger.error(f"Unexpected error extracting DOCX text: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            'text': f"[Неожиданная ошибка при обработке DOCX: {str(e)}]",
            'page_count': 0,
            'error_type': 'unexpected_error'
        }

def analyze_xlsx_complexity(sheet) -> float:
    """
    Analyze table complexity to determine best extraction method
    
    Args:
        sheet: openpyxl worksheet object
    
    Returns:
        Complexity score (0.0-1.0). Higher = more complex, better for vision processing
    """
    try:
        total_cells = sheet.max_row * sheet.max_column
        if total_cells == 0:
            return 0.0
        
        # Count non-empty cells
        non_empty = 0
        for row in sheet.iter_rows(values_only=True):
            for cell in row:
                if cell is not None and str(cell).strip():
                    non_empty += 1
        
        # Calculate density (ratio of filled cells)
        density = non_empty / total_cells if total_cells > 0 else 0
        
        # Check for merged cells (indicates complex layout)
        has_merges = len(sheet.merged_cells.ranges) > 0
        merge_factor = 0.3 if has_merges else 0.0
        
        # Low density + merged cells = high complexity (better for vision)
        # High density = simple table (better for text)
        complexity = (1 - density) * 0.7 + merge_factor
        
        logger.info(f"XLSX complexity analysis: density={density:.2f}, has_merges={has_merges}, complexity={complexity:.2f}")
        
        return complexity
    except Exception as e:
        logger.warning(f"Failed to analyze XLSX complexity: {e}")
        return 0.5  # Medium complexity as fallback


def extract_xlsx_smart_text(file_path: str) -> str:
    """
    Smart text extraction from XLSX with empty column removal and structured formatting
    
    Args:
        file_path: Path to XLSX file
    
    Returns:
        Formatted text with minimal noise
    """
    try:
        import openpyxl
        
        workbook = openpyxl.load_workbook(file_path, data_only=True)
        all_sheets_text = []
        
        for sheet_name in workbook.sheetnames:
            sheet = workbook[sheet_name]
            sheet_text = [f"=== Sheet: {sheet_name} ==="]
            
            # First pass: identify non-empty columns
            non_empty_cols = set()
            all_rows = list(sheet.iter_rows(values_only=True))
            
            for row in all_rows:
                for col_idx, cell in enumerate(row):
                    if cell is not None and str(cell).strip():
                        non_empty_cols.add(col_idx)
            
            if not non_empty_cols:
                sheet_text.append("(Empty sheet)")
                all_sheets_text.append("\n".join(sheet_text))
                continue
            
            sorted_cols = sorted(non_empty_cols)
            logger.info(f"Sheet '{sheet_name}': {len(sorted_cols)} non-empty columns out of {sheet.max_column}")
            
            # Second pass: extract data from non-empty columns only
            # Try to detect header row and format as structured data
            header_row = None
            data_rows = []
            
            for row_idx, row in enumerate(all_rows):
                # Filter to non-empty columns only
                filtered_cells = [row[i] if i < len(row) else None for i in sorted_cols]
                
                # Skip completely empty rows
                if not any(cell is not None and str(cell).strip() for cell in filtered_cells):
                    continue
                
                # Convert cells to strings
                cell_values = [str(cell).strip() if cell is not None else "" for cell in filtered_cells]
                
                # First meaningful row might be header
                if header_row is None and any(cell_values):
                    # Check if this looks like a header (mostly text, few numbers)
                    non_numeric = sum(1 for v in cell_values if v and not v.replace('.', '').replace(',', '').replace('-', '').isdigit())
                    if non_numeric > len(cell_values) / 2:
                        header_row = cell_values
                        continue
                
                data_rows.append(cell_values)
            
            # Format output
            if header_row:
                # Structured format with headers
                sheet_text.append("\nHeaders: " + " | ".join(header_row))
                sheet_text.append("-" * 50)
                
                for row_values in data_rows:
                    # Create key-value pairs for better LLM understanding
                    row_items = []
                    for header, value in zip(header_row, row_values):
                        if value:  # Only include non-empty values
                            row_items.append(f"{header}: {value}")
                    
                    if row_items:
                        sheet_text.append(" | ".join(row_items))
            else:
                # Simple format without headers
                for row_values in data_rows:
                    # Filter out empty values to reduce noise
                    non_empty_values = [v for v in row_values if v]
                    if non_empty_values:
                        sheet_text.append(" | ".join(non_empty_values))
            
            all_sheets_text.append("\n".join(sheet_text))
        
        return "\n\n".join(all_sheets_text)
        
    except ImportError:
        logger.warning("openpyxl not installed. Install with: pip install openpyxl")
        return "[XLSX parsing requires openpyxl library]"
    except Exception as e:
        logger.error(f"Error in smart XLSX extraction: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return f"[Error extracting XLSX: {str(e)}]"


def generate_xlsx_image(file_path: str) -> Optional[List[str]]:
    """
    Generate visual representation of XLSX file for vision models
    Uses pandas and matplotlib to render table as image
    
    Args:
        file_path: Path to XLSX file
    
    Returns:
        List of base64 encoded PNG images (one per sheet) or None if failed
    """
    try:
        import pandas as pd
        import io
        
        # Check if PIL is available
        if not HAS_PIL:
            logger.warning("PIL not available, cannot generate XLSX images")
            return None
        
        # Try importing matplotlib
        try:
            import matplotlib.pyplot as plt
            import matplotlib.patches as mpatches
        except ImportError:
            logger.warning("matplotlib not available for XLSX image generation")
            return None
        
        images = []
        excel_file = pd.ExcelFile(file_path)
        
        for sheet_name in excel_file.sheet_names[:3]:  # Limit to first 3 sheets
            try:
                # Read sheet
                df = pd.read_excel(file_path, sheet_name=sheet_name, header=None)
                
                # Limit size for rendering
                max_rows = 50
                max_cols = 15
                if len(df) > max_rows:
                    df = df.head(max_rows)
                if len(df.columns) > max_cols:
                    df = df.iloc[:, :max_cols]
                
                # Create figure
                fig, ax = plt.subplots(figsize=(14, max(8, len(df) * 0.3)))
                ax.axis('tight')
                ax.axis('off')
                
                # Add title
                ax.text(0.5, 0.98, f"Sheet: {sheet_name}", 
                       horizontalalignment='center',
                       verticalalignment='top',
                       transform=ax.transAxes,
                       fontsize=12, fontweight='bold')
                
                # Create table
                table_data = df.fillna('').astype(str).values.tolist()
                table = ax.table(cellText=table_data, 
                               loc='center',
                               cellLoc='left',
                               bbox=[0, 0, 1, 0.95])
                
                table.auto_set_font_size(False)
                table.set_fontsize(8)
                table.scale(1, 1.5)
                
                # Save to bytes
                buf = io.BytesIO()
                plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
                plt.close(fig)
                buf.seek(0)
                
                # Encode to base64
                img_b64 = base64.b64encode(buf.read()).decode('utf-8')
                images.append(img_b64)
                logger.info(f"Generated image for sheet '{sheet_name}' ({len(img_b64)} chars)")
                
            except Exception as e:
                logger.warning(f"Failed to generate image for sheet '{sheet_name}': {e}")
                continue
        
        return images if images else None
        
    except Exception as e:
        logger.error(f"Failed to generate XLSX images: {e}")
        return None


def extract_text_from_xlsx(file_path: str, advanced: bool = False) -> Dict[str, Any]:
    """
    Extract text from XLSX file with intelligent method selection
    
    Args:
        file_path: Path to XLSX file
        advanced: If True, may generate images for vision processing
    
    Returns:
        Dict with 'text', 'method', 'page_images', 'confidence', 'page_count'
    """
    try:
        import openpyxl
        
        workbook = openpyxl.load_workbook(file_path, data_only=True)
        sheet = workbook.active
        
        # Analyze table complexity
        complexity = analyze_xlsx_complexity(sheet)
        
        # Decision logic:
        # - High complexity (>0.6) + advanced mode -> try vision
        # - Otherwise -> smart text extraction
        use_vision = advanced and complexity > 0.6
        
        result = {
            'text': '',
            'method': 'text',
            'page_images': [],
            'confidence': 1.0,
            'page_count': len(workbook.sheetnames)
        }
        
        if use_vision:
            logger.info(f"XLSX complexity {complexity:.2f} -> attempting vision generation")
            images = generate_xlsx_image(file_path)
            
            if images and len(images) > 0:
                # Successfully generated images
                result['page_images'] = images
                result['method'] = 'vision'
                result['confidence'] = 0.8
                # Still extract text as fallback
                result['text'] = extract_xlsx_smart_text(file_path)
                logger.info(f"Generated {len(images)} images for XLSX vision processing")
            else:
                # Vision failed, fall back to text
                logger.info("Vision generation failed, using smart text extraction")
                result['text'] = extract_xlsx_smart_text(file_path)
                result['method'] = 'text'
                result['confidence'] = 1.0
        else:
            # Use smart text extraction
            logger.info(f"XLSX complexity {complexity:.2f} -> using smart text extraction")
            result['text'] = extract_xlsx_smart_text(file_path)
            result['method'] = 'text'
            result['confidence'] = 1.0
        
        return result
        
    except ImportError:
        logger.warning("openpyxl not installed. Install with: pip install openpyxl")
        return {
            'text': "[XLSX parsing requires openpyxl library]",
            'method': 'error',
            'page_images': [],
            'confidence': 0.0,
            'page_count': 0
        }
    except Exception as e:
        logger.error(f"Error extracting XLSX text: {e}")
        import traceback
        logger.error(f"Traceback: {traceback.format_exc()}")
        return {
            'text': f"[Error extracting XLSX: {str(e)}]",
            'method': 'error',
            'page_images': [],
            'confidence': 0.0,
            'page_count': 0
        }

def extract_text_from_pptx(file_path: str) -> str:
    """Extract text from PPTX file"""
    try:
        from pptx import Presentation
        
        prs = Presentation(file_path)
        text_parts = []
        
        for slide_num, slide in enumerate(prs.slides, 1):
            text_parts.append(f"--- Slide {slide_num} ---")
            
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text.strip():
                    text_parts.append(shape.text)
        
        return "\n".join(text_parts)
    except ImportError:
        logger.warning("python-pptx not installed. Install with: pip install python-pptx")
        return "[PPTX parsing requires python-pptx library]"
    except Exception as e:
        logger.error(f"Error extracting PPTX text: {e}")
        return f"[Error extracting PPTX: {str(e)}]"

def extract_text_from_txt(file_path: str) -> str:
    """Extract text from TXT file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except UnicodeDecodeError:
        # Try with different encoding
        try:
            with open(file_path, 'r', encoding='latin-1') as f:
                return f.read()
        except Exception as e:
            logger.error(f"Error reading TXT file: {e}")
            return f"[Error reading TXT: {str(e)}]"
    except Exception as e:
        logger.error(f"Error extracting TXT text: {e}")
        return f"[Error extracting TXT: {str(e)}]"

def extract_text(file_path: str, use_ocr: bool = True, advanced: bool = False) -> Optional[Dict[str, Any]]:
    """
    Extract text from various document formats
    
    Args:
        file_path: Path to the document file
        use_ocr: Enable OCR for scanned PDFs (default: True)
        advanced: Return advanced metadata including images (default: False)
    
    Returns:
        For PDFs: Dict with text, method, images, etc.
        For other formats: Dict with text and basic metadata
        None if format not supported
    """
    if not os.path.exists(file_path):
        logger.error(f"File not found: {file_path}")
        return None
    
    ext = Path(file_path).suffix.lower()
    
    # PDF gets special treatment with advanced options
    if ext == '.pdf':
        logger.info(f"Extracting text from PDF file (OCR={use_ocr}, Advanced={advanced}): {file_path}")
        return extract_text_from_pdf(file_path, use_ocr=use_ocr, advanced=advanced)
    
    # XLSX gets special treatment with advanced options (like PDF)
    if ext in ['.xlsx', '.xls']:
        logger.info(f"Extracting text from XLSX file (Advanced={advanced}): {file_path}")
        return extract_text_from_xlsx(file_path, advanced=advanced)
    
    # Other formats use simple extraction
    simple_extractors = {
        '.docx': extract_text_from_docx,
        '.doc': extract_text_from_docx,
        '.pptx': extract_text_from_pptx,
        '.ppt': extract_text_from_pptx,
        '.txt': extract_text_from_txt,
    }
    
    extractor = simple_extractors.get(ext)
    if extractor:
        logger.info(f"Extracting text from {ext} file: {file_path}")
        result = extractor(file_path)
        
        # Handle different return types (DOCX returns dict, others return string)
        if isinstance(result, dict):
            # DOCX/XLSX return dict with text, method, page_images, etc.
            # Ensure all required fields are present
            return {
                'text': result.get('text', ''),
                'method': result.get('method', 'text'),
                'page_images': result.get('page_images', []),
                'confidence': result.get('confidence', 1.0),
                'page_count': result.get('page_count', 1),
                'searchable_pdf_path': result.get('searchable_pdf_path'),
            }
        else:
            # Other formats return string
            return {
                'text': result,
                'method': 'text',
                'page_images': [],
                'confidence': 1.0,
                'page_count': 1
            }
    else:
        logger.warning(f"Unsupported file format: {ext}")
        return {
            'text': f"[Unsupported format: {ext}]",
            'method': 'error',
            'page_images': [],
            'confidence': 0.0,
            'page_count': 0
        }


if __name__ == "__main__":
    import sys
    import argparse
    
    parser = argparse.ArgumentParser(description="Extract text from documents with OCR support")
    parser.add_argument('file_path', help="Path to the document file")
    parser.add_argument('--no-ocr', action='store_true', help="Disable OCR for scanned PDFs")
    parser.add_argument('--advanced', action='store_true', help="Return advanced metadata and images")
    parser.add_argument('--json', action='store_true', help="Output as JSON")
    parser.add_argument('--pages', action='store_true', help="Extract text page-by-page with coordinates (PDF only)")
    
    args = parser.parse_args()
    
    # Check if --pages flag is used (for page-by-page extraction)
    if args.pages:
        if not args.file_path.lower().endswith('.pdf'):
            print(json.dumps({'error': '--pages flag is only supported for PDF files'}, ensure_ascii=False))
            sys.exit(1)
        
        result = extract_text_from_pdf_with_pages(args.file_path)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        result = extract_text(
            args.file_path,
            use_ocr=not args.no_ocr,
            advanced=args.advanced
        )
        
        if result:
            if args.json:
                # Output as JSON for programmatic use
                output = {
                    'text': result['text'],
                    'method': result['method'],
                    'confidence': result['confidence'],
                    'page_count': result['page_count'],
                    'has_images': len(result['page_images']) > 0,
                    'image_count': len(result['page_images']),
                    'page_images': result['page_images'],  # Include actual base64 images
                    'searchable_pdf_path': result.get('searchable_pdf_path'),
                }
                print(json.dumps(output, ensure_ascii=False, indent=2))
            else:
                # Human-readable output
                print(result['text'])
        else:
            sys.exit(1)
