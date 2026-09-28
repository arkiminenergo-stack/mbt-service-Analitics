# КПД — Комплексная проверка документов

## Overview

A specialized service for comprehensive document verification (КПД). Automates processing of document archives (ZIP), converts them to PDF, and uses AI (LLMs) to extract critical artifacts such as seals, signatures, and dates.

## Tech Stack

- **Frontend**: React 18 + TypeScript, Tailwind CSS, Radix UI (Shadcn UI pattern), TanStack Query v5, Wouter routing
- **Backend**: Node.js + Express.js, Passport.js authentication, PostgreSQL via Drizzle ORM
- **AI**: Ollama (local LLMs, default `qwen2.5:7b`) and OpenAI support
- **Document Processing**: Python parser using pdfplumber, pytesseract (OCR), OpenCV, LibreOffice headless conversion
- **Build**: Vite (frontend), esbuild (backend), tsx (dev server)

## Project Structure

```
/client       - React frontend (Vite)
/server       - Express backend
/shared       - Shared TypeScript types and Drizzle schema
/python_server - Python document parser (OCR, pdfplumber)
```

## Running the App

- **Dev**: `npm run dev` (starts Express + Vite on port 5000)
- **Build**: `npm run build`
- **Production**: `node dist/index.js`
- **DB push**: `npm run db:push`

## Configuration

- Requires `DATABASE_URL` environment variable (PostgreSQL)
- Optional: `OPENAI_API_KEY` for OpenAI LLM backend
- Default admin user: `admin@mbt.local` / `admin123` (change after first login)

## Key Features

1. **Project Management**: Group related documents into КПД projects
2. **Document Ingestion**: Upload ZIP archives, auto-extract with CP1251/CP866 filename decoding
3. **AI Analysis**: LLM-based extraction of seals, signatures, and dates
4. **Verification**: Review findings, approve files, export XLSX reports

## Deployment

- Deployment target: autoscale
- Build command: `npm run build`
- Run command: `node dist/index.js`
- Port: 5000
