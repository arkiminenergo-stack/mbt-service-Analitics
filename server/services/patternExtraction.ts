// Avoid circular import — define MbtFinding locally (same shape as in mbtDocumentAnalysis)
export interface MbtFinding {
  type: string;
  textFragment: string;
  page: number;
  description: string;
}

const MONTHS_RU = '(?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)';

const DATE_PATTERNS: Array<{ source: string; flags: string; description: string }> = [
  { source: `\\d{1,2}\\s+${MONTHS_RU}\\s+\\d{4}\\s*(?:г|года|\\.)?`, flags: 'gi', description: 'словесная дата' },
  { source: '«\\s*\\d{1,2}\\s*»\\s*(?:«[^»]+»|\\S+)\\s*\\d{4}', flags: 'g', description: 'дата в кавычках' },
  { source: '\\d{2}\\.\\d{2}\\.\\d{4}(?:\\s+\\d{2}:\\d{2}(?::\\d{2})?)?', flags: 'g', description: 'дата ДД.ММ.ГГГГ' },
  { source: '\\d{2}\\.\\d{2}\\.\\d{2}(?!\\d)', flags: 'g', description: 'дата ДД.ММ.ГГ' },
  { source: `«\\s*_+\\s*»\\s+_+\\s+20[_\\d]{2}\\s*г\\.?`, flags: 'gi', description: 'шаблон даты' },
  { source: '\\d{4}-\\d{2}-\\d{2}', flags: 'g', description: 'дата ГГГГ-ММ-ДД' },
  { source: 'за\\s+период\\s+[^\\n]{5,50}', flags: 'gi', description: 'период' },
  { source: 'по\\s+состоянию\\s+на\\s+\\d{2}\\.\\d{2}\\.\\d{4}', flags: 'gi', description: 'дата на момент' },
  { source: 'от\\s+\\d{2}\\.\\d{2}\\.\\d{4}', flags: 'gi', description: 'дата документа' },
];

const SEAL_PATTERNS: Array<{ source: string; flags: string; description: string }> = [
  { source: 'М\\.\\s*П\\.', flags: 'g', description: 'место печати' },
  { source: 'Место\\s+печати', flags: 'gi', description: 'место печати' },
  { source: 'гербовая\\s+печать', flags: 'gi', description: 'гербовая печать' },
  { source: 'круглая\\s+печать', flags: 'gi', description: 'круглая печать' },
  { source: 'печать\\s+организации', flags: 'gi', description: 'печать организации' },
  { source: 'оттиск\\s+печати', flags: 'gi', description: 'оттиск печати' },
  { source: 'заверено\\s+печатью', flags: 'gi', description: 'заверено печатью' },
  { source: 'скреплено\\s+печатью', flags: 'gi', description: 'скреплено печатью' },
  { source: 'Документ\\s+подписан\\s+электронной\\s+подписью', flags: 'gi', description: 'ЭП как аналог печати' },
  { source: 'СВЕДЕНИЯ\\s+О\\s+СЕРТИФИКАТЕ\\s+ЭП', flags: 'gi', description: 'ЭП как аналог печати' },
];

// Types that can be extracted via regex without calling LLM
export const PATTERN_SUPPORTED_TYPES = new Set(['date', 'seal']);

function extractWithPatterns(
  text: string,
  patterns: Array<{ source: string; flags: string; description: string }>,
  type: string,
  pageNumber: number
): MbtFinding[] {
  const findings: MbtFinding[] = [];
  const seen = new Set<string>();

  for (const pat of patterns) {
    const re = new RegExp(pat.source, pat.flags);
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const fragment = match[0].replace(/\s+/g, ' ').trim();
      if (fragment.length >= 3 && fragment.length <= 100 && !seen.has(fragment)) {
        seen.add(fragment);
        findings.push({
          type,
          textFragment: fragment.length > 80 ? fragment.substring(0, 77) + '...' : fragment,
          page: pageNumber,
          description: pat.description,
        });
      }
    }
  }

  return findings;
}

export function extractByPattern(
  text: string,
  type: string,
  pageNumber: number
): MbtFinding[] {
  if (type === 'date') return extractWithPatterns(text, DATE_PATTERNS, 'date', pageNumber);
  if (type === 'seal') return extractWithPatterns(text, SEAL_PATTERNS, 'seal', pageNumber);
  return [];
}

export function extractAllPatternTypes(text: string, pageNumber: number): Record<string, MbtFinding[]> {
  return {
    date: extractByPattern(text, 'date', pageNumber),
    seal: extractByPattern(text, 'seal', pageNumber),
  };
}
