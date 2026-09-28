---
name: MBT критические паттерны
description: Паттерны и ограничения которые нельзя забывать при работе с MBT сервисом
---

## exceljs
- ВСЕГДА использовать `wb.xlsx.writeBuffer()` + `res.send(buffer)` — НЕ `wb.xlsx.write(res)` (последнее не работает с современными версиями)

## Routes порядок
- Export routes ДОЛЖНЫ идти ДО general /:id routes (иначе Express не матчит правильно)

## recharts
- recharts@3.8.1 установлен через npm install, НЕ как dev dependency
- Был баг: "Cannot read properties of null (reading 'useRef')" из-за того что recharts был extraneous

## logActivity
- Всегда вызывать как fire-and-forget: `storage.logActivity({...}).catch(() => {})` чтобы не блокировать response
- При апруве файла нужно сделать: getMbtDocumentFile → getMbtDocument → получить projectId для лога

## File approval (существует!)
- mbtFileAnnotations таблица, type: "mark"|"approve"|"unapprove"
- storage.approveMbtFile(fileId, approved, userId)
- POST /api/mbt/files/:fileId/approve
- FileStatusBadge ТОЛЬКО показывает AI analysis status, не approval status

## MbtProjectPage
- 2578+ строк, читать только нужные секции
- mainView: 'documents' | 'check' | 'activity' (добавлен в Этап 7)

**Why:** паттерны вызвали баги или занятые несколько попыток при реализации
