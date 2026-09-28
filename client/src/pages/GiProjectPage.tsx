import { useState, useRef, useCallback, useEffect } from 'react';
import { Link, useParams } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ArrowLeft, Upload, Play, CheckCheck, Download, Trash2,
  Loader2, FileText, Droplets, RefreshCw, Check, X, FileSignature,
  Tags, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { GI_FIELD_KEYS, GI_FIELD_LABELS, GI_FILE_STATUS_LABELS } from '@shared/schema';
import type { GiFieldKey } from '@shared/schema';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface GiProject {
  id: string; name: string; address: string | null; year: number | null;
  status: string; renameTemplate: string | null;
}
interface GiActFile {
  id: string; projectId: string; originalFilename: string;
  renamedFilename: string | null; filePath: string; pdfPath: string | null;
  status: string; pageCount: number | null; confidenceAvg: string | null;
  errorMessage: string | null; processedAt: string | null; createdAt: string;
}
interface GiActField {
  id: string; fileId: string; fieldKey: string; fieldValue: string | null;
  confidence: string | null; rawOcrText: string | null; isVerified: boolean;
  verifiedBy: string | null; updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending:      'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  processing:   'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  done:         'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  error:        'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  needs_review: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
};

function ConfBadge({ conf }: { conf: string | null }) {
  if (!conf) return <span className="text-muted-foreground text-xs">—</span>;
  const pct = Math.round(parseFloat(conf) * 100);
  const color = pct >= 80 ? 'text-green-600' : pct >= 60 ? 'text-yellow-600' : 'text-red-600';
  return <span className={`text-xs font-medium ${color}`}>{pct}%</span>;
}

export default function GiProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [reviewFile, setReviewFile] = useState<GiActFile | null>(null);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [pollingEnabled, setPollingEnabled] = useState(false);
  const [reviewNumPages, setReviewNumPages] = useState(0);
  const [reviewCurrentPage, setReviewCurrentPage] = useState(1);

  useEffect(() => {
    setReviewNumPages(0);
    setReviewCurrentPage(1);
  }, [reviewFile?.id]);

  const { data: project } = useQuery<GiProject>({
    queryKey: [`/api/gi/projects/${projectId}`],
  });

  const { data: files = [], isLoading: filesLoading } = useQuery<GiActFile[]>({
    queryKey: [`/api/gi/projects/${projectId}/files`],
    refetchInterval: pollingEnabled ? 3000 : false,
  });

  useEffect(() => {
    const processing = files.some((f: GiActFile) => f.status === 'processing');
    setPollingEnabled(processing);
  }, [files]);

  const { data: reviewFields = [], isLoading: fieldsLoading } = useQuery<GiActField[]>({
    queryKey: [`/api/gi/files/${reviewFile?.id}/fields`],
    enabled: !!reviewFile,
  });

  const uploadMutation = useMutation({
    mutationFn: async (uploadFiles: File[]) => {
      for (const file of uploadFiles) {
        const form = new FormData();
        form.append('file', file);
        const r = await fetch(`/api/gi/projects/${projectId}/upload`, {
          method: 'POST', body: form, credentials: 'include',
        });
        if (!r.ok) throw new Error(`Upload failed: ${r.statusText}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gi/projects/${projectId}/files`] });
      toast({ title: 'Файлы загружены' });
    },
    onError: (e: any) => toast({ title: 'Ошибка загрузки', description: e.message, variant: 'destructive' }),
  });

  const processAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/gi/projects/${projectId}/process-all`);
      return res.json() as Promise<{ queued: number }>;
    },
    onSuccess: (data) => {
      toast({ title: `Запущено ${data.queued} файлов` });
      setPollingEnabled(true);
      queryClient.invalidateQueries({ queryKey: [`/api/gi/projects/${projectId}/files`] });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const processSingleMutation = useMutation({
    mutationFn: (fileId: string) => apiRequest('POST', `/api/gi/files/${fileId}/process`),
    onSuccess: () => {
      setPollingEnabled(true);
      queryClient.invalidateQueries({ queryKey: [`/api/gi/projects/${projectId}/files`] });
    },
  });

  const renameAllMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/gi/projects/${projectId}/rename-all`);
      return res.json() as Promise<{ renamed: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/gi/projects/${projectId}/files`] });
      toast({ title: `Переименовано ${data.renamed} файлов` });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const renameSingleMutation = useMutation({
    mutationFn: (fileId: string) => apiRequest('POST', `/api/gi/files/${fileId}/rename`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gi/projects/${projectId}/files`] });
      toast({ title: 'Файл переименован' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const updateFieldMutation = useMutation({
    mutationFn: ({ fieldId, value }: { fieldId: string; value: string }) =>
      apiRequest('PATCH', `/api/gi/fields/${fieldId}`, { fieldValue: value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gi/files/${reviewFile?.id}/fields`] });
    },
  });

  const verifyFileMutation = useMutation({
    mutationFn: (fileId: string) => apiRequest('POST', `/api/gi/files/${fileId}/verify`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gi/projects/${projectId}/files`] });
      queryClient.invalidateQueries({ queryKey: [`/api/gi/files/${reviewFile?.id}/fields`] });
      toast({ title: 'Файл подтверждён' });
      setReviewFile(null);
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (fileId: string) => apiRequest('DELETE', `/api/gi/files/${fileId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/gi/projects/${projectId}/files`] });
      setDeleteFileId(null);
      toast({ title: 'Файл удалён' });
    },
  });

  const handleFileUpload = useCallback((fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    uploadMutation.mutate(Array.from(fileList));
  }, [uploadMutation]);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFileUpload(e.dataTransfer.files);
  }

  function openReview(file: GiActFile) {
    setReviewFile(file);
    setEditFields({});
  }

  function handleFieldEdit(fieldId: string, newVal: string) {
    setEditFields(prev => ({ ...prev, [fieldId]: newVal }));
  }

  function saveField(field: GiActField) {
    const val = editFields[field.id] ?? field.fieldValue ?? '';
    updateFieldMutation.mutate({ fieldId: field.id, value: val });
    setEditFields(prev => { const n = { ...prev }; delete n[field.id]; return n; });
  }

  const pendingCount = files.filter(f => ['pending', 'error', 'needs_review'].includes(f.status)).length;
  const processingCount = files.filter(f => f.status === 'processing').length;
  const doneCount = files.filter(f => f.status === 'done').length;
  const processableCount = files.filter(f => ['done', 'needs_review'].includes(f.status)).length;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/gi">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <Droplets className="h-5 w-5 text-blue-500" />
            <div>
              <h1 className="text-lg font-semibold">{project?.name ?? '...'}</h1>
              <p className="text-xs text-muted-foreground">
                {project?.address ?? ''}{project?.year ? ` · ${project.year}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-muted-foreground">
              {files.length} файлов · {doneCount} готово
              {processingCount > 0 && <span className="text-blue-500"> · {processingCount} обраб.</span>}
            </span>
            <Button
              variant="outline" size="sm"
              disabled={processableCount === 0 || renameAllMutation.isPending}
              onClick={() => renameAllMutation.mutate()}
              title="Переименовать все готовые файлы по шаблону"
            >
              {renameAllMutation.isPending
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Tags className="h-4 w-4 mr-2" />}
              Переименовать все
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={`/api/gi/projects/${projectId}/export`} download>
                <Download className="h-4 w-4 mr-2" />
                XLSX
              </a>
            </Button>
            <Button
              size="sm"
              disabled={pendingCount === 0 || processAllMutation.isPending}
              onClick={() => processAllMutation.mutate()}
            >
              {processAllMutation.isPending
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Play className="h-4 w-4 mr-2" />}
              Запустить все ({pendingCount})
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Drop zone */}
        <div
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer
            ${dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
          <p className="font-medium">Загрузите ZIP-архив или PDF-файлы</p>
          <p className="text-sm text-muted-foreground mt-1">Перетащите файлы или нажмите для выбора</p>
          {uploadMutation.isPending && (
            <div className="flex items-center justify-center gap-2 mt-3 text-blue-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Загрузка...</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".zip,.pdf,.jpg,.jpeg,.png,.tif,.tiff"
            onChange={e => handleFileUpload(e.target.files)}
          />
        </div>

        {/* File table */}
        {filesLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : files.length === 0 ? (
          <p className="text-center text-muted-foreground py-12">Нет загруженных файлов</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Файл</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Достоверность</TableHead>
                <TableHead>Страниц</TableHead>
                <TableHead>Обработан</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map(f => (
                <TableRow key={f.id} className={f.status === 'needs_review' ? 'bg-yellow-50 dark:bg-yellow-900/10' : ''}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate max-w-xs">
                          {f.renamedFilename || f.originalFilename}
                        </p>
                        {f.renamedFilename && f.renamedFilename !== f.originalFilename && (
                          <p className="text-xs text-muted-foreground truncate max-w-xs">→ {f.originalFilename}</p>
                        )}
                        {f.errorMessage && (
                          <p className="text-xs text-red-500 mt-0.5 truncate max-w-xs">{f.errorMessage}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLORS[f.status] || ''}>
                      {GI_FILE_STATUS_LABELS[f.status as keyof typeof GI_FILE_STATUS_LABELS] || f.status}
                    </Badge>
                  </TableCell>
                  <TableCell><ConfBadge conf={f.confidenceAvg} /></TableCell>
                  <TableCell className="text-muted-foreground text-sm">{f.pageCount ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {f.processedAt ? new Date(f.processedAt).toLocaleString('ru-RU') : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {/* Reprocess */}
                      {['pending', 'error', 'needs_review'].includes(f.status) && (
                        <Button variant="ghost" size="icon" title="Обработать"
                          onClick={() => processSingleMutation.mutate(f.id)}
                          disabled={f.status === 'processing'}>
                          {f.status === 'processing'
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <RefreshCw className="h-4 w-4" />}
                        </Button>
                      )}
                      {/* Rename by template */}
                      {['done', 'needs_review'].includes(f.status) && (
                        <Button variant="ghost" size="icon" title="Переименовать по шаблону"
                          onClick={() => renameSingleMutation.mutate(f.id)}>
                          <FileSignature className="h-4 w-4" />
                        </Button>
                      )}
                      {/* Review / verify */}
                      {(f.status === 'done' || f.status === 'needs_review') && (
                        <Button variant="ghost" size="icon" title="Просмотр и верификация"
                          onClick={() => openReview(f)}>
                          <CheckCheck className="h-4 w-4" />
                        </Button>
                      )}
                      {/* Delete */}
                      <Button variant="ghost" size="icon" className="text-destructive"
                        onClick={() => setDeleteFileId(f.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </main>

      {/* Review / verification dialog with PDF preview */}
      <Dialog open={!!reviewFile} onOpenChange={v => { if (!v) setReviewFile(null); }}>
        <DialogContent className="max-w-6xl w-[95vw] max-h-[92vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-5 pb-3 border-b flex-shrink-0">
            <DialogTitle className="text-base">
              Верификация: {reviewFile?.renamedFilename || reviewFile?.originalFilename}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left: PDF preview */}
            <div className="w-1/2 border-r bg-muted/20 flex flex-col flex-shrink-0">
              <div className="flex items-center justify-between px-4 py-2 border-b">
                <p className="text-xs font-medium text-muted-foreground">Скан документа</p>
                {reviewNumPages > 1 && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      disabled={reviewCurrentPage <= 1}
                      onClick={() => setReviewCurrentPage(p => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {reviewCurrentPage} / {reviewNumPages}
                    </span>
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      disabled={reviewCurrentPage >= reviewNumPages}
                      onClick={() => setReviewCurrentPage(p => Math.min(reviewNumPages, p + 1))}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-auto flex justify-center py-4">
                {reviewFile && (
                  <Document
                    key={reviewFile.id}
                    file={`/api/gi/files/${reviewFile.id}/view`}
                    onLoadSuccess={({ numPages }) => { setReviewNumPages(numPages); setReviewCurrentPage(1); }}
                    loading={
                      <div className="flex justify-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                      </div>
                    }
                    error={
                      <p className="text-sm text-destructive text-center py-12">
                        Не удалось загрузить скан документа
                      </p>
                    }
                  >
                    <Page
                      pageNumber={reviewCurrentPage}
                      width={520}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                    />
                  </Document>
                )}
              </div>
            </div>

            {/* Right: extracted fields */}
            <div className="w-1/2 flex flex-col overflow-hidden">
              <p className="text-xs font-medium text-muted-foreground px-4 py-2 border-b">Извлечённые поля</p>
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
                {fieldsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : reviewFields.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8 text-sm">Поля не найдены</p>
                ) : (
                  GI_FIELD_KEYS.map(key => {
                    const field = reviewFields.find(f => f.fieldKey === key);
                    if (!field) return null;
                    const editVal = editFields[field.id] ?? field.fieldValue ?? '';
                    const isDirty = field.id in editFields;
                    const lowConf = field.confidence && parseFloat(field.confidence) < 0.7;
                    return (
                      <div key={key} className={`rounded-lg border p-2.5 ${
                        field.isVerified
                          ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800'
                          : lowConf
                            ? 'bg-yellow-50 dark:bg-yellow-900/10 border-yellow-200'
                            : ''
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-muted-foreground">
                            {GI_FIELD_LABELS[key as GiFieldKey]}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <ConfBadge conf={field.confidence} />
                            {field.isVerified && <Check className="h-3.5 w-3.5 text-green-600" />}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Input
                            className="text-sm h-7 px-2"
                            value={editVal}
                            onChange={e => handleFieldEdit(field.id, e.target.value)}
                            placeholder="—"
                          />
                          {isDirty && (
                            <>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => saveField(field)}>
                                <Check className="h-3.5 w-3.5 text-green-600" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7"
                                onClick={() => setEditFields(p => { const n = {...p}; delete n[field.id]; return n; })}>
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                        {field.rawOcrText && field.rawOcrText !== field.fieldValue && (
                          <p className="text-xs text-muted-foreground mt-1 truncate">
                            OCR: {field.rawOcrText.slice(0, 80)}
                          </p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="flex justify-end gap-2 px-4 py-3 border-t flex-shrink-0">
                <Button variant="outline" size="sm" onClick={() => setReviewFile(null)}>Закрыть</Button>
                <Button
                  size="sm"
                  disabled={verifyFileMutation.isPending}
                  onClick={() => reviewFile && verifyFileMutation.mutate(reviewFile.id)}
                >
                  {verifyFileMutation.isPending
                    ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    : <CheckCheck className="h-4 w-4 mr-1.5" />}
                  Подтвердить все поля
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete file confirm */}
      <AlertDialog open={!!deleteFileId} onOpenChange={v => { if (!v) setDeleteFileId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить файл?</AlertDialogTitle>
            <AlertDialogDescription>Файл и все его данные будут удалены безвозвратно.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteFileId && deleteMutation.mutate(deleteFileId)}
            >Удалить</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
