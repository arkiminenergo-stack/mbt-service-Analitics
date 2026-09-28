import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Loader2, FileSpreadsheet, Download, AlertCircle, CheckCircle2, Play, Settings2 } from 'lucide-react';

interface JobProgress {
  chunk: number;
  totalChunks: number;
  pagesDone: number;
  totalPages: number;
  rowsSoFar: number;
}

interface JobStatus {
  jobId: string;
  status: 'running' | 'done' | 'error';
  progress: JobProgress;
  totalRows: number;
  columns: string[];
  error?: string;
}

interface Props {
  fileId: string;
  filename: string;
}

export function StatementExtractionPanel({ fileId, filename }: Props) {
  const [startPage, setStartPage] = useState('1');
  const [endPage, setEndPage] = useState('');
  const [chunkSize, setChunkSize] = useState('300');
  const [showSettings, setShowSettings] = useState(false);

  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stop polling on unmount
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Start polling when jobId is set
  useEffect(() => {
    if (!jobId) return;
    if (pollRef.current) clearInterval(pollRef.current);

    const poll = async () => {
      try {
        const res = await fetch(`/api/mbt/extract-statement/status/${jobId}`, { credentials: 'include' });
        if (!res.ok) return;
        const data: JobStatus = await res.json();
        setJobStatus(data);
        if (data.status === 'done' || data.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch { /* network hiccup — keep polling */ }
    };

    poll(); // immediate first check
    pollRef.current = setInterval(poll, 2000);
  }, [jobId]);

  async function startExtraction() {
    setStarting(true);
    setError(null);
    setJobId(null);
    setJobStatus(null);
    try {
      const body: Record<string, any> = {
        startPage: parseInt(startPage) || 1,
        chunkSize: parseInt(chunkSize) || 300,
      };
      if (endPage.trim()) body.endPage = parseInt(endPage);

      const res = await fetch(`/api/mbt/files/${fileId}/extract-statement/start`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Ошибка запуска');
      setJobId(data.jobId);
    } catch (e: any) {
      setError(e.message || 'Ошибка запуска задания');
    } finally {
      setStarting(false);
    }
  }

  async function downloadXlsx() {
    if (!jobId) return;
    setDownloading(true);
    try {
      const res = await fetch(`/api/mbt/extract-statement/download/${jobId}`, { credentials: 'include' });
      if (!res.ok) throw new Error('Ошибка скачивания');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?([^;\r\n]+)/i);
      const name = nameMatch
        ? decodeURIComponent(nameMatch[1].replace(/"/g, ''))
        : `Выписка_${fileId}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e: any) {
      setError(e.message || 'Ошибка скачивания');
    } finally {
      setDownloading(false);
    }
  }

  function reset() {
    if (pollRef.current) clearInterval(pollRef.current);
    setJobId(null);
    setJobStatus(null);
    setError(null);
  }

  const isRunning = jobStatus?.status === 'running' || starting;
  const isDone    = jobStatus?.status === 'done';
  const isError   = jobStatus?.status === 'error';

  const pct = jobStatus?.progress?.totalPages
    ? Math.round((jobStatus.progress.pagesDone / jobStatus.progress.totalPages) * 100)
    : 0;

  // ── Idle state ───────────────────────────────────────────────────────────────
  if (!jobId && !starting) {
    return (
      <div className="flex flex-col gap-4 p-5 h-full">
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center h-11 w-11 rounded-full bg-green-50 border border-green-200 shrink-0">
            <FileSpreadsheet className="h-5 w-5 text-green-700" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Извлечение банковской выписки</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Таблица из PDF с видимыми линиями конвертируется в Excel со всеми оригинальными столбцами.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Страница начала</Label>
            <Input
              type="number"
              min="1"
              value={startPage}
              onChange={e => setStartPage(e.target.value)}
              className="h-8 text-sm"
              placeholder="1"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Страница конца <span className="text-muted-foreground">(пусто = до конца)</span></Label>
            <Input
              type="number"
              min="1"
              value={endPage}
              onChange={e => setEndPage(e.target.value)}
              className="h-8 text-sm"
              placeholder="1709"
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
          >
            <Settings2 className="h-3 w-3" />
            {showSettings ? 'Скрыть настройки' : 'Расширенные настройки'}
          </button>
        </div>

        {showSettings && (
          <div className="space-y-1 border rounded-md p-3 bg-muted/30">
            <Label className="text-xs">Размер чанка (страниц за раз)</Label>
            <Input
              type="number"
              min="50"
              max="1000"
              step="50"
              value={chunkSize}
              onChange={e => setChunkSize(e.target.value)}
              className="h-8 text-sm w-32"
            />
            <p className="text-xs text-muted-foreground">
              Прогресс обновляется после каждого чанка. По умолчанию 300 стр.
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        <Button onClick={startExtraction} className="gap-2 w-full mt-auto" disabled={starting}>
          <Play className="h-4 w-4" />
          Начать извлечение
        </Button>

        <p className="text-xs text-center text-muted-foreground">
          Для файла ~1700 стр. ожидается ~2 мин. Прогресс отображается в реальном времени.
        </p>
      </div>
    );
  }

  // ── Running / Done / Error ───────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 p-5 h-full">
      <div className="flex items-start gap-3">
        <div className={`flex items-center justify-center h-11 w-11 rounded-full shrink-0 border ${
          isDone  ? 'bg-green-50 border-green-200' :
          isError ? 'bg-red-50 border-red-200' :
                    'bg-blue-50 border-blue-200'
        }`}>
          {isDone  ? <CheckCircle2 className="h-5 w-5 text-green-600" /> :
           isError ? <AlertCircle  className="h-5 w-5 text-red-500" /> :
                     <Loader2     className="h-5 w-5 text-blue-500 animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            {isDone  ? 'Выписка извлечена' :
             isError ? 'Ошибка извлечения' :
                       'Извлечение в процессе…'}
          </p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{filename}</p>
        </div>
        <Badge variant="outline" className={`text-xs shrink-0 ${
          isDone  ? 'border-green-300 text-green-700 bg-green-50' :
          isError ? 'border-red-300 text-red-700 bg-red-50' :
                    'border-blue-300 text-blue-700 bg-blue-50'
        }`}>
          {isDone ? 'Готово' : isError ? 'Ошибка' : 'Обработка'}
        </Badge>
      </div>

      {/* Progress bar */}
      {isRunning && (
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>
              {jobStatus?.progress?.chunk
                ? `Чанк ${jobStatus.progress.chunk} из ${jobStatus.progress.totalChunks}`
                : 'Запуск…'}
            </span>
            <span>
              {jobStatus?.progress?.pagesDone
                ? `${jobStatus.progress.pagesDone} / ${jobStatus.progress.totalPages} стр.`
                : ''}
            </span>
          </div>
          <Progress value={pct} className="h-2" />
          <div className="text-xs text-muted-foreground text-right">
            {jobStatus?.progress?.rowsSoFar
              ? `Строк: ${jobStatus.progress.rowsSoFar.toLocaleString('ru-RU')}`
              : ''}
          </div>
        </div>
      )}

      {/* Done summary */}
      {isDone && jobStatus && (
        <div className="rounded-md border bg-green-50/50 p-3 space-y-1.5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted-foreground">Строк данных:</span>
            <span className="font-medium">{jobStatus.totalRows.toLocaleString('ru-RU')}</span>
            <span className="text-muted-foreground">Колонок:</span>
            <span className="font-medium">{jobStatus.columns.length}</span>
            <span className="text-muted-foreground">Страниц обработано:</span>
            <span className="font-medium">{jobStatus.progress.totalPages}</span>
          </div>
          {jobStatus.columns.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground mb-1">Обнаруженные столбцы:</p>
              <div className="flex flex-wrap gap-1">
                {jobStatus.columns.map((col, i) => (
                  <Badge key={i} variant="secondary" className="text-xs px-1.5 py-0">
                    {col || `Кол.${i+1}`}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{jobStatus?.error || 'Неизвестная ошибка'}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        {isDone && (
          <Button
            onClick={downloadXlsx}
            disabled={downloading}
            className="gap-2 flex-1 bg-green-600 hover:bg-green-700"
          >
            {downloading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />}
            Скачать Excel
          </Button>
        )}
        <Button
          variant="outline"
          onClick={reset}
          disabled={isRunning}
          className="gap-2"
        >
          {isRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
          {isDone || isError ? 'Начать заново' : 'Отмена'}
        </Button>
      </div>
    </div>
  );
}
