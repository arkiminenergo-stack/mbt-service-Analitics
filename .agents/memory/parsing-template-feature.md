---
name: Parsing Template Feature
description: Visual span-click parsing mode in MbtProjectPage — key integration decisions and gotchas.
---

## What was built
Full "Visual Parsing Template Builder": users click text spans in a PDF to map them to table columns, save templates to DB (`parsing_templates` table), run against all pages via `python_server/apply_template.py`, export XLSX.

## Key decisions

### Span listener pattern
`activateParsingMode()` attaches `mouseenter/mouseleave/click` listeners directly to `.react-pdf__Page__textContent span` elements, storing refs as `(span as any)._pars`. `deactivateParsingMode()` removes them by reading back those refs. This avoids any conflict with existing `applyHighlights()` which uses `pointerEvents: 'none'` overlay divs.

**Why:** react-pdf renders a new text layer on every page change, so listeners must be re-attached in `onPageRenderSuccess` when `showParsingMode` is true.

### PDF viewer layout change
Changed `<div className="flex h-full">` to `<div className="flex flex-col h-full">` with inner `<div className="flex flex-1 min-h-0 overflow-hidden">` wrapping PDF + ThumbnailNavigator. `ParsingModePanel` is appended below as a `shrink-0` element.

**Why:** Panel must be a fixed-height footer inside the card without disrupting the scrollable PDF area.

### `onPageRenderSuccess` dependency
Must include `showParsingMode` and `activateParsingMode` in its `useCallback` dep array so page changes in parsing mode re-activate spans automatically.

### Python script stdin/stdout
`apply_template.py` reads PDF path from `argv[1]` and template JSON from `stdin`, outputs result JSON to `stdout`. Backend spawns it with `proc.stdin.write(JSON.stringify(template)); proc.stdin.end()`.

### XLSX filename
Format: `{originalName}({templateName}).xlsx`. `originalName` strips `.pdf` extension. Set via `Content-Disposition: attachment; filename*=UTF-8''...` header.
