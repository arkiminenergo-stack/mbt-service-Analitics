# MBT Service — Межбюджетные Трансферты

Standalone сервис для анализа документов по межбюджетным трансфертам (МБТ).

## Возможности

- Загрузка ZIP-архивов с документами (PDF, DOCX, XLSX)
- Автоматическая распаковка и конвертация в PDF
- AI-анализ документов: поиск печатей, подписей, дат
- Поддержка Ollama (локальные LLM) и OpenAI
- Разбивка документов на разделы по правилам маршрутизации
- Простановка отметок и согласование файлов
- Экспорт отчёта в XLSX

## Требования

### Системные зависимости

```bash
# Debian/Ubuntu
sudo apt-get install -y poppler-utils libreoffice python3 python3-pip

# Python пакеты
pip3 install pdfplumber
```

### Переменные окружения

Создайте файл `.env` или задайте переменные в Replit Secrets:

| Переменная | Обязательная | Описание |
|---|---|---|
| `DATABASE_URL` | Да | PostgreSQL connection string |
| `SESSION_SECRET` | Да | Секрет для сессий (любая длинная строка) |
| `ADMIN_EMAIL` | Нет | Email администратора (по умолчанию: admin@mbt.local) |
| `ADMIN_PASSWORD` | Нет | Пароль администратора (по умолчанию: admin123) |
| `OLLAMA_API_URL` | Нет | URL Ollama API (напр. http://localhost:11434) |
| `OLLAMA_API_KEY` | Нет | API key для Ollama (если требуется) |
| `OLLAMA_MODEL` | Нет | Модель Ollama (по умолчанию: qwen2.5:7b) |
| `OPENAI_API_KEY` | Нет | OpenAI API key (если используете OpenAI) |

## Установка и запуск

```bash
# 1. Установить зависимости
npm install

# 2. Применить схему БД
npm run db:push

# 3. Запустить в режиме разработки
npm run dev
```

Сервис запустится на порту 5000.

## Первый вход

По умолчанию создаётся администратор:
- Email: `admin@mbt.local` (или значение `ADMIN_EMAIL`)
- Пароль: `admin123` (или значение `ADMIN_PASSWORD`)

**Важно:** Смените пароль после первого входа!

## Производственный запуск

```bash
npm run build
npm start
```
