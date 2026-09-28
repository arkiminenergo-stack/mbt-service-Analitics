---
name: MBT Этапы прогресс
description: Реализованные и следующие этапы MBT сервиса
---

## Реализовано

- Этап 1-3: базовая архитектура, загрузка документов, AI анализ
- Этап 4: manualOverrides + reviewer sign-off + history tabs; PATCH /api/mbt/conclusions/:id; export
- Этап 5: getMbtAnalytics(); GET /api/mbt/analytics; MbtAnalyticsTab с recharts BarChart+PieChart
- Этап 6: файловый апрув (mbtFileAnnotations, approveMutation, /approve route, FileStatusBadge) — СУЩЕСТВУЕТ
- Этап 7 (DONE): Журнал активности — mbt_activity_log таблица; logActivity/getActivityLog в storage; GET /api/mbt/projects/:id/activity; ActivityLogPanel.tsx; кнопка «Журнал» в шапке проекта; логирование в: check_run, conclusion_signed/unsigned, override_set, file_approved/rejected, document_uploaded

- Агент-помощник (DONE): ProjectAssistantDialog (Sheet Drawer) + POST /api/mbt/projects/:id/assistant + server/services/projectAssistant.ts (системный промпт МБТ-домена, actions: create_section/create_template/create_folder/run_check, JSON structured output, extractJSON парсер, executeActions оркестратор). Кнопка «Помощник» в шапке каждого проекта.

## Следующее

- Этап 8: Задачи/замечания (task tracker per project)
- Этап 9: Массовый экспорт (batch export XLSX по нескольким проектам)
- Этап 10: Email-уведомления

**Why:** записывать для передачи между сессиями, чтобы не повторять реализованное
