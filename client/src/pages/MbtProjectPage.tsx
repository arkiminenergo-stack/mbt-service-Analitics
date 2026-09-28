import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from 'react';
import { Link, useParams } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, Upload, Loader2, FileArchive, File, ChevronDown, ChevronRight,
  Trash2, Sparkles, CheckCircle2, XCircle, ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon, Banknote, AlertCircle, Layers, Plus,
  Shuffle, GripVertical, X, Settings2, FolderOpen, Folder, Pencil, Check, FileSpreadsheet,
  FileText, Bot, Scissors, ScanText, Download,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { MBT_FINDING_LABELS, MBT_FINDING_COLORS } from '@shared/schema';
import { AnalysisTemplateDialog, type AnalysisTemplate } from '@/components/AnalysisTemplateDialog';
import { ProjectCheckTab } from '@/components/ProjectCheckTab';
import { ProjectFolderTree } from '@/components/ProjectFolderTree';
import { ActivityLogPanel } from '@/components/ActivityLogPanel';
import { ProjectAssistantDialog } from '@/components/ProjectAssistantDialog';
import { PaymentOrdersPanel } from '@/components/PaymentOrdersPanel';
import { StatementExtractionPanel } from '@/components/StatementExtractionPanel';
import { ParsingModePanel, type SelectedSpan, type ParsingResult } from '@/components/ParsingModePanel';
import { BboxZoneOverlay, type BboxZone } from '@/components/BboxZoneOverlay';
import { BboxParsingPanel, type BboxParsingResult } from '@/components/BboxParsingPanel';
import type { ParsingColumn, ParsingMapping } from '@shared/schema';
import { PdfSplitDialog } from '@/components/PdfSplitDialog';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/esm/Page/TextLayer.css';
import 'react-pdf/dist/esm/Page/AnnotationLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const DEFAULT_PARSING_COLUMNS: ParsingColumn[] = [
  { id: 'c1', name: 'Дата',        color: '#dbeafe', isNumeric: false, previewValue: '' },
  { id: 'c2', name: 'Номер',       color: '#dcfce7', isNumeric: false, previewValue: '' },
  { id: 'c3', name: 'Плательщик',  color: '#fef3c7', isNumeric: false, previewValue: '' },
  { id: 'c4', name: 'Сумма',       color: '#fee2e2', isNumeric: true,  previewValue: '' },
  { id: 'c5', name: 'Назначение',  color: '#ede9fe', isNumeric: false, previewValue: '' },
];

interface MbtProject {
  id: string;
  name: string;
}

interface MbtDocument {
  id: string;
  projectId: string;
  filename: string;
  originalName: string;
  status: string;
  uploadedAt: string;
}

interface MbtDocFile {
  id: string;
  documentId: string;
  filename: string;
  originalName: string;
  fileType: string;
  analysisStatus: string;
  extractionStatus: string;
  pageCount: number;
  sectionId?: string | null;
  folderId?: string | null;
  isApproved?: boolean;
}

interface MbtMarkButton {
  id: string;
  projectId: string;
  sectionId?: string | null;
  key: string;
  label: string;
  order: number;
}

interface MbtAnnotation {
  id: string;
  fileId: string;
  type: 'mark' | 'approve' | 'unapprove';
  buttonKey?: string | null;
  page?: number | null;
  createdBy: string;
  createdAt: string;
  note?: string | null;
}

interface MbtSectionRule {
  id: string;
  sectionId: string;
  type: string;
  value: string;
}

interface MbtSection {
  id: string;
  projectId: string;
  name: string;
  order: number;
  createdAt: string;
  rules: MbtSectionRule[];
}

interface Finding {
  type: 'seal' | 'signature' | 'date';
  textFragment: string;
  page: number;
  description: string;
}

interface Analysis {
  id: string;
  fileId: string;
  status: string;
  findings: Finding[];
  findingsCount: number;
  errorMessage?: string;
  progress?: number;
  progressStage?: string;
}

interface HighlightPosition {
  finding: Finding;
  topPercent: number;
}

const CHUNK_SIZE = 5 * 1024 * 1024;
const RULE_TYPE_LABELS: Record<string, string> = {
  filename: 'Имя файла содержит',
  has_artifact: 'Находки анализа содержат слова',
};

export default function MbtProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { toast } = useToast();

  const [expandedDocs, setExpandedDocs] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [showPaymentOrders, setShowPaymentOrders] = useState(false);
  const [showStatement, setShowStatement] = useState(false);
  const [showParsingMode, setShowParsingMode]   = useState(false);
  const [parsingPhase, setParsingPhase]         = useState<'idle'|'mapping'|'running'|'done'>('idle');
  const [parsingColumns, setParsingColumns]     = useState<ParsingColumn[]>(DEFAULT_PARSING_COLUMNS);
  const [parsingMappings, setParsingMappings]   = useState<ParsingMapping[]>([]);
  const [selectedSpan, setSelectedSpan]         = useState<SelectedSpan | null>(null);
  const [parsingResult, setParsingResult]       = useState<ParsingResult | null>(null);
  const [savedTemplateName, setSavedTemplateName] = useState<string>('шаблон');
  const [parsingSubMode, setParsingSubMode]     = useState<'span' | 'bbox'>('span');
  const [bboxZones, setBboxZones]               = useState<BboxZone[]>([]);
  const [bboxActiveColumnId, setBboxActiveColumnId] = useState<string | null>(null);
  const [bboxFilterPP, setBboxFilterPP]         = useState(true);
  const [bboxPhase, setBboxPhase]               = useState<'mapping' | 'running' | 'done'>('mapping');
  const [bboxResult, setBboxResult]             = useState<BboxParsingResult | null>(null);
  const [bboxSavedName, setBboxSavedName]       = useState('зоны-шаблон');
  const [parsingPageFrom, setParsingPageFrom]   = useState(1);
  const [parsingPageTo, setParsingPageTo]       = useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [deleteDocId, setDeleteDocId] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [highlightPositions, setHighlightPositions] = useState<HighlightPosition[]>([]);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [analysisSettingsOpen, setAnalysisSettingsOpen] = useState(false);
  const [analysisSettings, setAnalysisSettings] = useState({
    findDates: true,
    findSignatures: true,
    findSeals: true,
    useOcr: false,
    skipAnalyzed: false,
  });
  const [checkedFileIds, setCheckedFileIds] = useState<Set<string>>(new Set());
  const [reportScope, setReportScope] = useState<{
    projectId: string;
    documentId?: string;
    sectionId?: string;
    fileId?: string;
    title: string;
  } | null>(null);
  const [draggedFileIds, setDraggedFileIds] = useState<Set<string>>(new Set());
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [lastClickedFileId, setLastClickedFileId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'sections' | 'documents' | 'folders'>('sections');
  const [markButtonsOpen, setMarkButtonsOpen] = useState(false);
  const [hiddenFindingTypes, setHiddenFindingTypes] = useState<Set<string>>(new Set());
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [mainView, setMainView] = useState<'documents' | 'check' | 'activity'>('documents');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    const saved = localStorage.getItem('kpd-left-panel-width');
    return saved ? parseInt(saved, 10) : 384;
  });
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);

  const { data: project } = useQuery<MbtProject>({
    queryKey: ['/api/mbt/projects', projectId],
  });

  const { data: documents = [], isLoading: docsLoading } = useQuery<MbtDocument[]>({
    queryKey: ['/api/mbt/projects', projectId, 'documents'],
    queryFn: async () => {
      const res = await fetch(`/api/mbt/projects/${projectId}/documents`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const allFilesQuery = useQuery<Record<string, MbtDocFile[]>>({
    queryKey: ['/api/mbt/documents-files', projectId, documents.map(d => d.id).join(',')],
    queryFn: async () => {
      const result: Record<string, MbtDocFile[]> = {};
      for (const doc of documents) {
        const res = await fetch(`/api/mbt/documents/${doc.id}/files`, { credentials: 'include' });
        if (res.ok) result[doc.id] = await res.json();
      }
      return result;
    },
    enabled: documents.length > 0,
    refetchInterval: 5000,
  });

  const filesMap = allFilesQuery.data || {};
  const allFiles = useMemo(() => Object.values(filesMap).flat(), [filesMap]);

  const { data: sections = [], isLoading: sectionsLoading } = useQuery<MbtSection[]>({
    queryKey: ['/api/mbt/projects', projectId, 'sections'],
    queryFn: async () => {
      const res = await fetch(`/api/mbt/projects/${projectId}/sections`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch sections');
      return res.json();
    },
  });

  const { data: currentAnalysis, refetch: refetchAnalysis } = useQuery<Analysis | null>({
    queryKey: ['/api/mbt/files', selectedFileId, 'analysis'],
    queryFn: async () => {
      if (!selectedFileId) return null;
      const res = await fetch(`/api/mbt/files/${selectedFileId}/analysis`, { credentials: 'include' });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedFileId,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && data.status === 'processing') return 3000;
      return false;
    },
  });

  const { data: annotations = [] } = useQuery<MbtAnnotation[]>({
    queryKey: ['/api/mbt/files', selectedFileId, 'annotations'],
    queryFn: async () => {
      if (!selectedFileId) return [];
      const res = await fetch(`/api/mbt/files/${selectedFileId}/annotations`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!selectedFileId,
  });

  const { data: markButtons = [] } = useQuery<MbtMarkButton[]>({
    queryKey: ['/api/mbt/projects', projectId, 'mark-buttons'],
    queryFn: async () => {
      const res = await fetch(`/api/mbt/projects/${projectId}/mark-buttons`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!projectId,
  });

  const { data: analysisTemplates = [] } = useQuery<AnalysisTemplate[]>({
    queryKey: ['/api/mbt/analysis-templates', projectId],
    queryFn: async () => {
      const url = projectId
        ? `/api/mbt/analysis-templates?projectId=${projectId}`
        : '/api/mbt/analysis-templates';
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const selectedTemplate = useMemo(
    () => analysisTemplates.find(t => t.id === selectedTemplateId) ?? null,
    [analysisTemplates, selectedTemplateId]
  );

  const findingColors = useMemo<Record<string, string>>(() => {
    if (selectedTemplate && selectedTemplate.parameters.length > 0) {
      return Object.fromEntries(selectedTemplate.parameters.map(p => [p.key, p.color]));
    }
    return MBT_FINDING_COLORS;
  }, [selectedTemplate]);

  const findingLabels = useMemo<Record<string, string>>(() => {
    if (selectedTemplate && selectedTemplate.parameters.length > 0) {
      return Object.fromEntries(selectedTemplate.parameters.map(p => [p.key, p.label]));
    }
    return MBT_FINDING_LABELS;
  }, [selectedTemplate]);

  const selectedFile = useMemo(() => allFiles.find(f => f.id === selectedFileId), [allFiles, selectedFileId]);
  const selectedSection = useMemo(() => selectedFile?.sectionId ? sections.find(s => s.id === selectedFile.sectionId) : null, [selectedFile, sections]);

  const activeMarkButtons = useMemo(() => {
    if (!selectedSection) return markButtons.filter(b => !b.sectionId);
    return markButtons.filter(b => !b.sectionId || b.sectionId === selectedSection.id);
  }, [markButtons, selectedSection]);

  const activeMarkKeys = useMemo(() =>
    new Set(
      annotations
        .filter(a => a.type === 'mark' && a.page === currentPage)
        .map(a => a.buttonKey)
        .filter(Boolean) as string[]
    ),
    [annotations, currentPage]
  );

  // Страницы с ручными отметками (для миниатюр)
  const markedPages = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const a of annotations) {
      if (a.type === 'mark' && a.page != null && a.buttonKey) {
        if (!map.has(a.page)) map.set(a.page, []);
        map.get(a.page)!.push(a.buttonKey);
      }
    }
    return map;
  }, [annotations]);

  const analyzeMutation = useMutation({
    mutationFn: async (fileId: string) => {
      const payload = selectedTemplateId
        ? { ...analysisSettings, templateId: selectedTemplateId }
        : analysisSettings;
      const res = await apiRequest('POST', `/api/mbt/files/${fileId}/analyze`, payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Анализ запущен' });
      setTimeout(() => refetchAnalysis(), 1000);
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const batchAnalyzeMutation = useMutation({
    mutationFn: async (fileIds: string[]) => {
      const { skipAnalyzed, ...settings } = analysisSettings;
      const payload = selectedTemplateId
        ? { fileIds, skipAnalyzed, ...settings, templateId: selectedTemplateId }
        : { fileIds, skipAnalyzed, ...settings };
      const res = await apiRequest('POST', '/api/mbt/batch-analyze', payload);
      return res.json();
    },
    onSuccess: (data) => {
      const count = data.queued ?? 0;
      toast({ title: count > 0 ? `Анализ запущен для ${count} файлов` : 'Все файлы уже проанализированы' });
      setCheckedFileIds(new Set());
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['/api/mbt/documents-files', projectId] }), 1500);
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const toggleFileCheck = (fileId: string, checked: boolean) => {
    setCheckedFileIds(prev => {
      const next = new Set(prev);
      checked ? next.add(fileId) : next.delete(fileId);
      return next;
    });
  };

  const approveMutation = useMutation({
    mutationFn: async ({ fileId, approved }: { fileId: string; approved: boolean }) => {
      const res = await apiRequest('POST', `/api/mbt/files/${fileId}/approve`, { approved });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/documents-files', projectId] });
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/files', selectedFileId, 'annotations'] });
      toast({ title: selectedFile?.isApproved ? 'Согласование отменено' : 'Файл согласован' });
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const toggleMarkMutation = useMutation({
    mutationFn: async ({ fileId, buttonKey, page }: { fileId: string; buttonKey: string; page: number }) => {
      const res = await apiRequest('POST', `/api/mbt/files/${fileId}/marks/toggle`, { buttonKey, page });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/files', selectedFileId, 'annotations'] });
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const deleteDocMutation = useMutation({
    mutationFn: async (docId: string) => {
      await apiRequest('DELETE', `/api/mbt/documents/${docId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'documents'] });
      setDeleteDocId(null);
      setSelectedFileId(null);
      toast({ title: 'Документ удалён' });
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: async (fileId: string) => {
      await apiRequest('DELETE', `/api/mbt/files/${fileId}`);
    },
    onSuccess: (_, fileId) => {
      // Оптимистично убираем файл из кеша (не ждём рефетч — сервер может вернуть 304)
      queryClient.setQueriesData<Record<string, MbtDocFile[]>>(
        { queryKey: ['/api/mbt/documents-files', projectId] },
        (old) => {
          if (!old) return old;
          const next: Record<string, MbtDocFile[]> = {};
          for (const [docId, files] of Object.entries(old)) {
            next[docId] = files.filter(f => f.id !== fileId);
          }
          return next;
        }
      );
      if (selectedFileId === fileId) setSelectedFileId(null);
      setCheckedFileIds(prev => { const n = new Set(prev); n.delete(fileId); return n; });
    },
    onError: () => toast({ title: 'Ошибка удаления файла', variant: 'destructive' }),
  });

  const updateFileSectionMutation = useMutation({
    mutationFn: async ({ fileId, sectionId }: { fileId: string; sectionId: string | null }) => {
      const res = await apiRequest('PATCH', `/api/mbt/files/${fileId}/section`, { sectionId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/documents-files', projectId] });
    },
  });

  const routeMutation = useMutation({
    mutationFn: async (docId: string) => {
      const res = await apiRequest('POST', `/api/mbt/documents/${docId}/route`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/documents-files', projectId] });
      toast({ title: `Распределено файлов: ${data.routed}` });
    },
    onError: () => toast({ title: 'Ошибка маршрутизации', variant: 'destructive' }),
  });

  const toggleDoc = (docId: string) => {
    setExpandedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };



  const handleFileUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast({ title: 'Ошибка', description: 'Поддерживаются только ZIP-файлы', variant: 'destructive' });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      if (file.size <= CHUNK_SIZE) {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(`/api/mbt/projects/${projectId}/documents/upload`, {
          method: 'POST', body: formData, credentials: 'include',
        });
        if (!res.ok) throw new Error('Upload failed');
      } else {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const initRes = await fetch(`/api/mbt/projects/${projectId}/documents/upload/init`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ filename: file.name, fileSize: file.size, totalChunks }),
        });
        if (!initRes.ok) throw new Error('Init failed');
        const { uploadId } = await initRes.json();

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, file.size);
          const chunk = file.slice(start, end);
          const formData = new FormData();
          formData.append('chunk', chunk);
          formData.append('uploadId', uploadId);
          formData.append('chunkIndex', String(i));

          const chunkRes = await fetch(`/api/mbt/projects/${projectId}/documents/upload/chunk`, {
            method: 'POST', body: formData, credentials: 'include',
          });
          if (!chunkRes.ok) throw new Error(`Chunk ${i} failed`);
          setUploadProgress(Math.round(((i + 1) / totalChunks) * 90));
        }

        const finalRes = await fetch(`/api/mbt/projects/${projectId}/documents/upload/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ uploadId }),
        });
        if (!finalRes.ok) throw new Error('Finalize failed');
      }

      setUploadProgress(100);
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'documents'] });
      toast({ title: 'ZIP-архив загружен' });
      setUploadOpen(false);
    } catch (error: any) {
      toast({ title: 'Ошибка загрузки', description: error.message, variant: 'destructive' });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }, [projectId, toast]);


  const pdfUrl = selectedFileId ? `/api/mbt/files/${selectedFileId}/serve` : null;

  const findings = currentAnalysis?.findings || [];

  const toggleFindingType = useCallback((type: string) => {
    setHiddenFindingTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  // Только видимые находки (не скрытые пользователем)
  const visibleFindings = useMemo(() =>
    findings.filter(f => !hiddenFindingTypes.has(f.type)),
    [findings, hiddenFindingTypes]
  );

  const currentPageFindings = useMemo(() =>
    visibleFindings.filter(f => f.page === currentPage),
    [visibleFindings, currentPage]
  );

  const legendCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const f of findings) counts[f.type] = (counts[f.type] || 0) + 1;
    return counts;
  }, [findings]);

  useEffect(() => {
    setCurrentPage(1);
    setNumPages(0);
    setPdfLoading(true);
    setHighlightPositions([]);
    setHiddenFindingTypes(new Set());
    setShowPaymentOrders(false);
    setShowStatement(false);
    setShowParsingMode(false);
    setParsingPhase('idle');
    setParsingColumns(DEFAULT_PARSING_COLUMNS);
    setParsingMappings([]);
    setParsingResult(null);
    setSelectedSpan(null);
  }, [selectedFileId]);

  const applyHighlights = useCallback(() => {
    if (!textLayerRef.current) return;

    const textLayer = textLayerRef.current.querySelector('.react-pdf__Page__textContent');
    if (!textLayer) return;

    textLayer.querySelectorAll('.mbt-highlight').forEach(el => el.remove());

    if (currentPageFindings.length === 0) {
      setHighlightPositions([]);
      return;
    }

    const spans = textLayer.querySelectorAll('span');
    const pageElement = textLayerRef.current.querySelector('.react-pdf__Page');
    const pageHeight = pageElement?.getBoundingClientRect().height || 1;
    const pageTop = pageElement?.getBoundingClientRect().top || 0;
    const positions: HighlightPosition[] = [];

    for (const finding of currentPageFindings) {
      const fragment = finding.textFragment.trim();
      if (fragment.length < 2) continue;

      let matched = false;
      const searchTerms = [fragment];
      if (fragment.length > 15) {
        searchTerms.push(fragment.substring(0, 15));
      }
      if (fragment.length > 8) {
        searchTerms.push(fragment.substring(0, 8));
      }

      for (const term of searchTerms) {
        if (matched) break;
        for (const span of Array.from(spans)) {
          const text = span.textContent || '';
          const idx = text.indexOf(term);
          if (idx === -1) continue;

          const range = document.createRange();
          const textNode = span.firstChild;
          if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

          try {
            range.setStart(textNode, idx);
            range.setEnd(textNode, Math.min(idx + term.length, text.length));
            const rect = range.getBoundingClientRect();
            const parentRect = textLayer.getBoundingClientRect();

            if (rect.width === 0 || rect.height === 0) continue;

            const highlight = document.createElement('div');
            highlight.className = 'mbt-highlight';
            highlight.dataset.findingType = finding.type;
            highlight.dataset.findingIdx = String(positions.length);
            highlight.style.position = 'absolute';
            highlight.style.left = `${rect.left - parentRect.left}px`;
            highlight.style.top = `${rect.top - parentRect.top}px`;
            highlight.style.width = `${rect.width}px`;
            highlight.style.height = `${rect.height}px`;
            highlight.style.backgroundColor = findingColors[finding.type] || '#ffff00';
            highlight.style.opacity = '0.35';
            highlight.style.pointerEvents = 'none';
            highlight.style.zIndex = '1';
            highlight.style.borderRadius = '2px';
            highlight.title = `${findingLabels[finding.type] || finding.type}: ${finding.description}`;

            textLayer.appendChild(highlight);

            const topPercent = ((rect.top - pageTop) / pageHeight) * 100;
            positions.push({ finding, topPercent: Math.max(0, Math.min(100, topPercent)) });
            matched = true;
          } catch {}
          break;
        }
      }
    }

    setHighlightPositions(positions);
  }, [currentPageFindings, findingColors, findingLabels]);

  useEffect(() => {
    if (currentPageFindings.length > 0) {
      const timer = setTimeout(applyHighlights, 300);
      return () => clearTimeout(timer);
    } else {
      setHighlightPositions([]);
    }
  }, [currentAnalysis, currentPage, applyHighlights]);

  const onPageRenderSuccess = useCallback(() => {
    setPdfLoading(false);
    setTimeout(applyHighlights, 200);
  }, [applyHighlights]);

  const scrollToHighlight = useCallback((idx: number) => {
    if (!textLayerRef.current) return;
    const highlight = textLayerRef.current.querySelector(`.mbt-highlight[data-finding-idx="${idx}"]`) as HTMLElement | null;
    if (!highlight) return;

    const scrollContainer = pdfContainerRef.current;
    if (scrollContainer) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const hlRect = highlight.getBoundingClientRect();
      const scrollTop = scrollContainer.scrollTop + (hlRect.top - containerRect.top) - containerRect.height / 2;
      scrollContainer.scrollTo({ top: scrollTop, behavior: 'smooth' });
    }

    highlight.style.opacity = '0.7';
    setTimeout(() => { highlight.style.opacity = '0.35'; }, 1500);
  }, []);

  // ── Парсинг: активация span-ов текущей страницы ───────────────────────────
  const activateParsingMode = useCallback(() => {
    if (!textLayerRef.current) return;
    const textLayer = textLayerRef.current.querySelector('.react-pdf__Page__textContent') as HTMLElement | null;
    if (!textLayer) return;

    const COLORS = ['#dbeafe','#dcfce7','#fef3c7','#fce7f3','#ede9fe','#ccfbf1','#fee2e2'];
    const spans  = Array.from(textLayer.querySelectorAll('span')) as HTMLSpanElement[];

    spans.forEach((span, i) => {
      if (!span.textContent?.trim()) return;
      if (span.dataset.parsIdx) return; // уже активирован
      span.dataset.parsIdx    = String(i);
      span.style.cursor       = 'pointer';
      span.style.borderRadius = '2px';
      const color   = COLORS[i % COLORS.length];
      const onEnter = () => { if (!span.dataset.parsSelected) span.style.background = color; };
      const onLeave = () => { if (!span.dataset.parsSelected) span.style.background = ''; };
      const onClick = () => handleParsingSpanClick(span);
      span.addEventListener('mouseenter', onEnter);
      span.addEventListener('mouseleave', onLeave);
      span.addEventListener('click',      onClick);
      (span as any)._pars = { onEnter, onLeave, onClick };
    });

    setParsingPhase('mapping');
  }, [textLayerRef]); // handleParsingSpanClick defined below — stable ref via useCallback

  // ── Парсинг: деактивация span-ов ──────────────────────────────────────────
  const deactivateParsingMode = useCallback(() => {
    if (!textLayerRef.current) return;
    Array.from(textLayerRef.current.querySelectorAll('[data-pars-idx]')).forEach(el => {
      const span = el as HTMLSpanElement;
      const ls   = (span as any)._pars;
      if (ls) {
        span.removeEventListener('mouseenter', ls.onEnter);
        span.removeEventListener('mouseleave', ls.onLeave);
        span.removeEventListener('click',      ls.onClick);
        delete (span as any)._pars;
      }
      span.style.cursor     = '';
      span.style.background = '';
      span.style.boxShadow  = '';
      delete span.dataset.parsIdx;
      delete span.dataset.parsSelected;
    });
    setParsingPhase('idle');
    setSelectedSpan(null);
  }, [textLayerRef]);

  // ── Парсинг: реактивация span-ов при смене страницы (только span-режим) ──
  useEffect(() => {
    if (showParsingMode && parsingPhase === 'mapping' && parsingSubMode === 'span') {
      const timer = setTimeout(activateParsingMode, 300);
      return () => clearTimeout(timer);
    }
  }, [currentPage, showParsingMode, parsingPhase, parsingSubMode, activateParsingMode]);

  // ── Парсинг: клик по span-у ────────────────────────────────────────────────
  const handleParsingSpanClick = useCallback((span: HTMLSpanElement) => {
    if (!textLayerRef.current) return;
    textLayerRef.current.querySelectorAll('[data-pars-selected]').forEach(el => {
      const e = el as HTMLElement;
      e.style.boxShadow  = '';
      e.style.background = '';
      delete e.dataset.parsSelected;
    });
    const text = span.textContent?.trim() ?? '';
    if (!text) return;
    span.dataset.parsSelected = '1';
    span.style.boxShadow  = '0 0 0 2px #6366f1, 0 0 0 4px #6366f130';
    span.style.background = '#e0e7ff';

    const allSpans = Array.from(
      textLayerRef.current.querySelectorAll('[data-pars-idx]')
    ) as HTMLSpanElement[];
    const idx           = allSpans.indexOf(span);
    const contextBefore = allSpans[idx - 1]?.textContent?.trim().slice(-20) ?? '';
    const contextAfter  = allSpans[idx + 1]?.textContent?.trim().slice(0, 20) ?? '';
    setSelectedSpan({ text, contextBefore, contextAfter, el: span });
  }, [textLayerRef]);

  // ── Парсинг: клик по колонке ───────────────────────────────────────────────
  const handleParsingColumnClick = useCallback((columnId: string) => {
    if (parsingSubMode === 'bbox') {
      setBboxActiveColumnId(prev => prev === columnId ? null : columnId);
      return;
    }
    if (!selectedSpan) return;
    setParsingMappings(prev => {
      if (prev.find(m => m.columnId === columnId && m.spanText === selectedSpan.text)) return prev;
      return [...prev, {
        columnId,
        spanText:      selectedSpan.text,
        contextBefore: selectedSpan.contextBefore,
        contextAfter:  selectedSpan.contextAfter,
      }];
    });
    setParsingColumns(cols => cols.map(c =>
      c.id === columnId
        ? { ...c, previewValue: [c.previewValue, selectedSpan.text].filter(Boolean).join(' ') }
        : c
    ));
    selectedSpan.el.style.boxShadow  = '';
    selectedSpan.el.style.background = '';
    delete selectedSpan.el.dataset.parsSelected;
    setSelectedSpan(null);
  }, [selectedSpan, parsingSubMode]);

  // ── Парсинг: сохранить шаблон ──────────────────────────────────────────────
  const handleSaveParsingTemplate = useCallback(async (name: string) => {
    if (!projectId) return;
    try {
      await apiRequest('POST', '/api/mbt/parsing-templates', {
        projectId,
        name,
        sourceFileId: selectedFileId,
        sourcePage:   currentPage,
        columns:      parsingColumns,
        mappings:     parsingMappings,
      });
      setSavedTemplateName(name);
      toast({ title: `✓ Шаблон «${name}» сохранён` });
    } catch {
      toast({ title: 'Ошибка сохранения шаблона', variant: 'destructive' });
    }
  }, [projectId, selectedFileId, currentPage, parsingColumns, parsingMappings, toast]);

  // ── Парсинг: запустить ────────────────────────────────────────────────────
  const handleRunParsingTemplate = useCallback(async () => {
    if (!selectedFileId) return;
    setParsingPhase('running');
    try {
      const res  = await apiRequest('POST', `/api/mbt/files/${selectedFileId}/apply-template`, {
        template:  { columns: parsingColumns, mappings: parsingMappings },
        pageFrom:  parsingPageFrom,
        pageTo:    parsingPageTo ?? numPages,
      });
      const data = await res.json();
      setParsingResult(data);
      setParsingPhase('done');
    } catch {
      toast({ title: 'Ошибка парсинга', variant: 'destructive' });
      setParsingPhase('mapping');
    }
  }, [selectedFileId, parsingColumns, parsingMappings, parsingPageFrom, parsingPageTo, numPages, toast]);

  // ── Парсинг: скачать XLSX ─────────────────────────────────────────────────
  const handleDownloadParsingXlsx = useCallback(async () => {
    if (!selectedFileId) return;
    try {
      const res  = await apiRequest('POST', `/api/mbt/files/${selectedFileId}/apply-template/xlsx`, {
        template:     { columns: parsingColumns, mappings: parsingMappings },
        templateName: savedTemplateName,
        pageFrom:     parsingPageFrom,
        pageTo:       parsingPageTo ?? numPages,
      });
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      // Собираем имя файла на клиенте: оригинальноеНазвание(шаблон).xlsx
      const rawName = selectedFile?.originalName || selectedFile?.filename || 'result';
      const baseName = rawName.replace(/\.pdf$/i, '');
      const safeTpl  = savedTemplateName.replace(/[/\\:*?"<>|]/g, '_');
      a.download = `${baseName}(${safeTpl}).xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Ошибка экспорта', variant: 'destructive' });
    }
  }, [selectedFileId, selectedFile, parsingColumns, parsingMappings, savedTemplateName, parsingPageFrom, parsingPageTo, numPages, toast]);

  // ── Bbox-парсинг: запустить ───────────────────────────────────────────────
  const handleRunBboxTemplate = useCallback(async () => {
    if (!selectedFileId) return;
    setBboxPhase('running');
    try {
      const res = await apiRequest('POST', `/api/mbt/files/${selectedFileId}/apply-bbox-template`, {
        zones:    bboxZones,
        columns:  parsingColumns,
        filterPP: bboxFilterPP,
        pageFrom: parsingPageFrom,
        pageTo:   parsingPageTo ?? numPages,
      });
      const data = await res.json();
      setBboxResult(data);
      setBboxPhase('done');
    } catch {
      toast({ title: 'Ошибка bbox-парсинга', variant: 'destructive' });
      setBboxPhase('mapping');
    }
  }, [selectedFileId, bboxZones, parsingColumns, bboxFilterPP, parsingPageFrom, parsingPageTo, numPages, toast]);

  // ── Bbox-парсинг: скачать XLSX ────────────────────────────────────────────
  const handleDownloadBboxXlsx = useCallback(async () => {
    if (!selectedFileId) return;
    try {
      const res = await apiRequest('POST', `/api/mbt/files/${selectedFileId}/apply-bbox-template/xlsx`, {
        config:       { zones: bboxZones, columns: parsingColumns, filterPP: bboxFilterPP,
                        pageFrom: parsingPageFrom, pageTo: parsingPageTo ?? numPages },
        templateName: bboxSavedName,
      });
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      const rawName  = selectedFile?.originalName || selectedFile?.filename || 'result';
      const baseName = rawName.replace(/\.pdf$/i, '');
      const safeTpl  = bboxSavedName.replace(/[/\\:*?"<>|]/g, '_');
      a.download = `${baseName}(${safeTpl}).xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Ошибка экспорта', variant: 'destructive' });
    }
  }, [selectedFileId, selectedFile, bboxZones, parsingColumns, bboxFilterPP, bboxSavedName, parsingPageFrom, parsingPageTo, numPages, toast]);

  // ── Bbox-парсинг: сохранить шаблон ────────────────────────────────────────
  const handleSaveBboxTemplate = useCallback(async (name: string) => {
    if (!projectId) return;
    try {
      await apiRequest('POST', '/api/mbt/parsing-templates', {
        projectId,
        name,
        sourceFileId: selectedFileId,
        sourcePage:   currentPage,
        columns:      parsingColumns,
        mappings:     [],
      });
      setBboxSavedName(name);
      toast({ title: `✓ Шаблон «${name}» сохранён` });
    } catch {
      toast({ title: 'Ошибка сохранения шаблона', variant: 'destructive' });
    }
  }, [projectId, selectedFileId, currentPage, parsingColumns, toast]);

  const hasFindings = currentAnalysis?.status === 'completed' && findings.length > 0;

  // Files grouped by section
  const filesBySection = useMemo(() => {
    const map: Record<string, MbtDocFile[]> = { __unsorted__: [] };
    sections.forEach(s => { map[s.id] = []; });
    allFiles.forEach(f => {
      const key = f.sectionId && map[f.sectionId] ? f.sectionId : '__unsorted__';
      map[key].push(f);
    });
    return map;
  }, [allFiles, sections]);

  // Плоский упорядоченный список всех файлов (для shift-выделения диапазона)
  const allFilesOrdered = useMemo(() => {
    const result: MbtDocFile[] = [];
    [...sections].sort((a, b) => a.order - b.order).forEach(s => {
      (filesBySection[s.id] || []).forEach(f => result.push(f));
    });
    (filesBySection['__unsorted__'] || []).forEach(f => result.push(f));
    return result;
  }, [sections, filesBySection]);

  // ── Rename mutation ──────────────────────────────────────────────────────────
  const renameMutation = useMutation({
    mutationFn: async ({ fileId, filename }: { fileId: string; filename: string }) => {
      const res = await apiRequest('PATCH', `/api/mbt/files/${fileId}/rename`, { filename });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/documents-files', projectId] });
    },
    onError: () => toast({ title: 'Ошибка переименования', variant: 'destructive' }),
  });

  // ── Drag & drop handlers (multi-file) ────────────────────────────────────────
  const handleDragStart = useCallback((fileId: string) => {
    const ids = checkedFileIds.has(fileId) ? new Set(checkedFileIds) : new Set([fileId]);
    setDraggedFileIds(ids);
  }, [checkedFileIds]);

  const handleDragOver = (e: React.DragEvent, sectionKey: string) => {
    e.preventDefault();
    setDragOverSection(sectionKey);
  };

  const handleDrop = (e: React.DragEvent, sectionKey: string) => {
    e.preventDefault();
    if (draggedFileIds.size === 0) return;
    const targetSectionId = sectionKey === '__unsorted__' ? null : sectionKey;
    draggedFileIds.forEach(fileId => {
      updateFileSectionMutation.mutate({ fileId, sectionId: targetSectionId });
    });
    setDraggedFileIds(new Set());
    setDragOverSection(null);
  };

  const handleDragEnd = () => {
    setDraggedFileIds(new Set());
    setDragOverSection(null);
  };

  // ── Shift-click range selection ───────────────────────────────────────────────
  const handleFileShiftClick = useCallback((fileId: string) => {
    if (!lastClickedFileId) {
      setCheckedFileIds(prev => { const n = new Set(prev); n.add(fileId); return n; });
      setLastClickedFileId(fileId);
      return;
    }
    const ids = allFilesOrdered.map(f => f.id);
    const i1 = ids.indexOf(lastClickedFileId);
    const i2 = ids.indexOf(fileId);
    if (i1 === -1 || i2 === -1) return;
    const [from, to] = i1 <= i2 ? [i1, i2] : [i2, i1];
    const range = ids.slice(from, to + 1);
    setCheckedFileIds(prev => { const n = new Set(prev); range.forEach(id => n.add(id)); return n; });
  }, [lastClickedFileId, allFilesOrdered]);

  // ── Bulk download (all checked files) ────────────────────────────────────────
  const handleBulkDownload = useCallback(async () => {
    const ids = Array.from(checkedFileIds);
    for (let i = 0; i < ids.length; i++) {
      const file = allFiles.find(f => f.id === ids[i]);
      const a = document.createElement('a');
      a.href = `/api/mbt/files/${ids[i]}/serve`;
      a.download = file?.originalName || file?.filename || `file_${i + 1}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      if (i < ids.length - 1) await new Promise(r => setTimeout(r, 300));
    }
  }, [checkedFileIds, allFiles]);

  const docNameById = useMemo(() => {
    const m: Record<string, string> = {};
    documents.forEach(d => { m[d.id] = d.originalName; });
    return m;
  }, [documents]);

  // Route all documents in project
  const handleRouteAll = () => {
    documents.forEach(doc => routeMutation.mutate(doc.id));
  };

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = leftPanelWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = ev.clientX - dragStartXRef.current;
      const newWidth = Math.min(700, Math.max(220, dragStartWidthRef.current + delta));
      setLeftPanelWidth(newWidth);
    };
    const onMouseUp = () => {
      isDraggingRef.current = false;
      setLeftPanelWidth(w => {
        localStorage.setItem('kpd-left-panel-width', String(w));
        return w;
      });
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [leftPanelWidth]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Link href="/mbt">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft />
            </Button>
          </Link>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Banknote className="h-5 w-5 text-muted-foreground shrink-0" />
            <h1 className="text-lg font-semibold truncate" data-testid="text-project-name">
              {project?.name || 'Проект'}
            </h1>
          </div>
          <div className="flex items-center rounded-md border overflow-hidden shrink-0">
            <button
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${mainView === 'documents' ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted/60 text-muted-foreground'}`}
              onClick={() => setMainView('documents')}
            >
              <FileText className="h-3.5 w-3.5" />
              Документы
            </button>
            <button
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors border-l ${mainView === 'check' ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted/60 text-muted-foreground'}`}
              onClick={() => setMainView('check')}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Проверка
            </button>
            <button
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors border-l ${mainView === 'activity' ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted/60 text-muted-foreground'}`}
              onClick={() => setMainView('activity')}
            >
              <Layers className="h-3.5 w-3.5" />
              Журнал
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
            onClick={() => setAssistantOpen(true)}
            data-testid="button-assistant"
          >
            <Bot className="h-3.5 w-3.5" />
            Помощник
          </Button>
        </div>
      </header>

      {mainView === 'check' && (
        <div className="p-4 h-[calc(100vh-57px)] overflow-hidden">
          <ProjectCheckTab projectId={projectId!} />
        </div>
      )}

      {mainView === 'activity' && (
        <div className="h-[calc(100vh-57px)] overflow-hidden max-w-3xl mx-auto w-full p-4">
          <div className="h-full border rounded-lg bg-card overflow-hidden flex flex-col">
            <ActivityLogPanel projectId={projectId!} />
          </div>
        </div>
      )}

      <main className={`flex gap-4 p-4 h-[calc(100vh-57px)] ${mainView !== 'documents' ? 'hidden' : ''}`}>
        {/* Left panel */}
        <div className="h-full flex flex-col gap-4 min-h-0 overflow-hidden shrink-0" style={{ width: leftPanelWidth }}>
          <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
            <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Файлы</CardTitle>
                <div className="flex rounded-md border overflow-hidden">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className={`px-2 py-1 text-xs transition-colors ${viewMode === 'sections' ? 'bg-accent text-accent-foreground' : 'hover-elevate'}`}
                        onClick={() => setViewMode('sections')}
                        data-testid="button-view-sections"
                      >
                        <Layers className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>По разделам</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className={`px-2 py-1 text-xs transition-colors border-l ${viewMode === 'documents' ? 'bg-accent text-accent-foreground' : 'hover-elevate'}`}
                        onClick={() => setViewMode('documents')}
                        data-testid="button-view-documents"
                      >
                        <FileArchive className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>По архивам</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className={`px-2 py-1 text-xs transition-colors border-l ${viewMode === 'folders' ? 'bg-accent text-accent-foreground' : 'hover-elevate'}`}
                        onClick={() => setViewMode('folders')}
                        data-testid="button-view-folders"
                      >
                        <Folder className="h-3 w-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>По папкам</TooltipContent>
                  </Tooltip>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {viewMode === 'sections' && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={handleRouteAll}
                          disabled={routeMutation.isPending || sections.length === 0 || allFiles.length === 0}
                          data-testid="button-route-all"
                        >
                          {routeMutation.isPending
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Shuffle className="h-4 w-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Распределить по разделам</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setSectionsOpen(true)}
                          data-testid="button-manage-sections"
                        >
                          <Settings2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Управление разделами</TooltipContent>
                    </Tooltip>
                  </>
                )}
                {allFiles.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setReportScope({ projectId: project.id, title: project.name })}
                        data-testid="button-report-project"
                      >
                        <FileSpreadsheet className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Отчёт по архиву</TooltipContent>
                  </Tooltip>
                )}
                {checkedFileIds.size > 0 && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleBulkDownload}
                          data-testid="button-bulk-download"
                        >
                          <Download className="h-4 w-4 mr-1" />
                          {checkedFileIds.size}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Скачать выбранные ({checkedFileIds.size})</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            Array.from(checkedFileIds).forEach(id => deleteFileMutation.mutate(id));
                            setCheckedFileIds(new Set());
                          }}
                          data-testid="button-bulk-delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Удалить выбранные ({checkedFileIds.size})</TooltipContent>
                    </Tooltip>
                  </>
                )}
                <Button
                  size="sm"
                  onClick={() => setUploadOpen(true)}
                  data-testid="button-upload-zip"
                >
                  <Upload className="h-4 w-4 mr-1" />
                  ZIP
                </Button>
              </div>
            </CardHeader>

            <CardContent className="flex-1 overflow-hidden p-0">
              {viewMode === 'folders' && (
                <ProjectFolderTree
                  projectId={projectId!}
                  allFiles={allFiles}
                  selectedFileId={selectedFileId}
                  onSelectFile={setSelectedFileId}
                />
              )}
              {viewMode !== 'folders' && checkedFileIds.size > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/40">
                  <span className="text-sm text-muted-foreground flex-1">
                    Выбрано: <strong>{checkedFileIds.size}</strong>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCheckedFileIds(new Set())}
                    data-testid="button-clear-selection"
                  >
                    Снять
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchAnalyzeMutation.mutate([...checkedFileIds])}
                    disabled={batchAnalyzeMutation.isPending}
                    data-testid="button-batch-analyze"
                  >
                    {batchAnalyzeMutation.isPending
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                      : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
                    Анализировать
                  </Button>
                </div>
              )}
              {viewMode !== 'folders' && (<ScrollArea className="h-full px-4 pb-4">
                {docsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : documents.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Нет загруженных документов
                  </div>
                ) : viewMode === 'sections' ? (
                  // ── Sections view ─────────────────────────────────────────
                  <div className="space-y-1 pt-2">
                    {/* Named sections */}
                    {[...sections]
                      .sort((a, b) => a.order - b.order)
                      .map(section => {
                        const sectionFiles = filesBySection[section.id] || [];
                        const isOver = dragOverSection === section.id;
                        const isExpanded = expandedSections.has(section.id);
                        return (
                          <div
                            key={section.id}
                            className={`rounded-md border transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-transparent'}`}
                            onDragOver={(e) => handleDragOver(e, section.id)}
                            onDrop={(e) => handleDrop(e, section.id)}
                            onDragLeave={() => setDragOverSection(null)}
                            data-testid={`section-${section.id}`}
                          >
                            <div
                              className="group flex items-center gap-2 py-2 px-2 cursor-pointer hover-elevate rounded-md"
                              onClick={() => toggleSection(section.id)}
                            >
                              {isExpanded
                                ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                                : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium flex-1 truncate">{section.name}</span>
                              <Badge variant="secondary" className="text-[10px]">{sectionFiles.length}</Badge>
                              {sectionFiles.length > 0 && (
                                <>
                                  <button
                                    className="shrink-0 invisible group-hover:visible opacity-60 hover:!opacity-100 transition-opacity"
                                    onClick={e => { e.stopPropagation(); batchAnalyzeMutation.mutate(sectionFiles.map(f => f.id)); }}
                                    data-testid={`button-analyze-section-${section.id}`}
                                    title="Анализировать все файлы раздела"
                                  >
                                    <Sparkles className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    className="shrink-0 invisible group-hover:visible opacity-60 hover:!opacity-100 transition-opacity"
                                    onClick={e => { e.stopPropagation(); setReportScope({ projectId: project.id, sectionId: section.id, title: section.name }); }}
                                    data-testid={`button-report-section-${section.id}`}
                                    title="Отчёт по разделу"
                                  >
                                    <FileSpreadsheet className="h-3.5 w-3.5" />
                                  </button>
                                </>
                              )}
                            </div>
                            {isExpanded && (
                              <div className="ml-6 pb-1 space-y-0.5">
                                {sectionFiles.length === 0 ? (
                                  <div className="py-2 px-2 text-xs text-muted-foreground italic">
                                    Нет файлов
                                  </div>
                                ) : (
                                  sectionFiles.map(file => (
                                    <FileRow
                                      key={file.id}
                                      file={file}
                                      docName={docNameById[file.documentId]}
                                      selected={selectedFileId === file.id}
                                      checked={checkedFileIds.has(file.id)}
                                      onSelect={() => { setSelectedFileId(file.id); setLastClickedFileId(file.id); }}
                                      onCheck={(v) => toggleFileCheck(file.id, v)}
                                      onShiftClick={() => handleFileShiftClick(file.id)}
                                      onDragStart={() => handleDragStart(file.id)}
                                      onDragEnd={handleDragEnd}
                                      dragging={draggedFileIds.has(file.id)}
                                      onRename={(name) => renameMutation.mutate({ fileId: file.id, filename: name })}
                                      onDelete={() => deleteFileMutation.mutate(file.id)}
                                    />
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}

                    {/* Unsorted */}
                    {(() => {
                      const unsortedFiles = filesBySection['__unsorted__'] || [];
                      const isOver = dragOverSection === '__unsorted__';
                      const isExpanded = expandedSections.has('__unsorted__');
                      return (
                        <div
                          className={`rounded-md border transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-transparent'}`}
                          onDragOver={(e) => handleDragOver(e, '__unsorted__')}
                          onDrop={(e) => handleDrop(e, '__unsorted__')}
                          onDragLeave={() => setDragOverSection(null)}
                          data-testid="section-unsorted"
                        >
                          <div
                            className="group flex items-center gap-2 py-2 px-2 cursor-pointer hover-elevate rounded-md"
                            onClick={() => toggleSection('__unsorted__')}
                          >
                            {isExpanded
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                            <File className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="text-sm font-medium text-muted-foreground flex-1">Нераспределённые</span>
                            <Badge variant="secondary" className="text-[10px]">{unsortedFiles.length}</Badge>
                            {unsortedFiles.length > 0 && (
                              <button
                                className="shrink-0 invisible group-hover:visible opacity-60 hover:!opacity-100 transition-opacity"
                                onClick={e => { e.stopPropagation(); batchAnalyzeMutation.mutate(unsortedFiles.map(f => f.id)); }}
                                title="Анализировать нераспределённые файлы"
                                data-testid="button-analyze-unsorted"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {isExpanded && (
                            <div className="ml-6 pb-1 space-y-0.5">
                              {unsortedFiles.length === 0 ? (
                                <div className="py-2 px-2 text-xs text-muted-foreground italic">
                                  Все файлы распределены
                                </div>
                              ) : (
                                unsortedFiles.map(file => (
                                  <FileRow
                                    key={file.id}
                                    file={file}
                                    docName={docNameById[file.documentId]}
                                    selected={selectedFileId === file.id}
                                    checked={checkedFileIds.has(file.id)}
                                    onSelect={() => { setSelectedFileId(file.id); setLastClickedFileId(file.id); }}
                                    onCheck={(v) => toggleFileCheck(file.id, v)}
                                    onShiftClick={() => handleFileShiftClick(file.id)}
                                    onDragStart={() => handleDragStart(file.id)}
                                    onDragEnd={handleDragEnd}
                                    dragging={draggedFileIds.has(file.id)}
                                    onRename={(name) => renameMutation.mutate({ fileId: file.id, filename: name })}
                                    onDelete={() => deleteFileMutation.mutate(file.id)}
                                  />
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  // ── Documents view (original) ────────────────────────────
                  <div className="space-y-1 pt-2">
                    {documents.map(doc => (
                      <div key={doc.id} data-testid={`doc-${doc.id}`}>
                        <div
                          className="group flex items-center gap-2 py-2 px-2 rounded-md cursor-pointer hover-elevate"
                          onClick={() => toggleDoc(doc.id)}
                        >
                          {expandedDocs.has(doc.id)
                            ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                          <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-sm font-medium truncate flex-1" title={doc.originalName}>
                            {doc.originalName}
                          </span>
                          {doc.status === 'extracting' && (
                            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />
                          )}
                          {doc.status === 'error' && (
                            <XCircle className="h-3 w-3 text-destructive shrink-0" />
                          )}
                          {(filesMap[doc.id] || []).length > 0 && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 invisible group-hover:visible"
                                onClick={(e) => { e.stopPropagation(); batchAnalyzeMutation.mutate((filesMap[doc.id] || []).map(f => f.id)); }}
                                data-testid={`button-analyze-doc-${doc.id}`}
                                title="Анализировать все файлы архива"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 invisible group-hover:visible"
                                onClick={(e) => { e.stopPropagation(); setReportScope({ projectId: project.id, documentId: doc.id, title: doc.originalName }); }}
                                data-testid={`button-report-doc-${doc.id}`}
                                title="Отчёт по архиву"
                              >
                                <FileSpreadsheet className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={(e) => { e.stopPropagation(); setDeleteDocId(doc.id); }}
                            data-testid={`button-delete-doc-${doc.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>

                        {expandedDocs.has(doc.id) && (
                          <div className="ml-6 space-y-0.5">
                            {(filesMap[doc.id] || []).length === 0 && doc.status === 'extracting' ? (
                              <div className="flex items-center gap-2 py-1 px-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Распаковка...
                              </div>
                            ) : (filesMap[doc.id] || []).length === 0 ? (
                              <div className="py-1 px-2 text-xs text-muted-foreground">Нет файлов</div>
                            ) : (
                              (filesMap[doc.id] || []).map(file => (
                                <FileRow
                                  key={file.id}
                                  file={file}
                                  selected={selectedFileId === file.id}
                                  checked={checkedFileIds.has(file.id)}
                                  onSelect={() => { setSelectedFileId(file.id); setLastClickedFileId(file.id); }}
                                  onCheck={(v) => toggleFileCheck(file.id, v)}
                                  onShiftClick={() => handleFileShiftClick(file.id)}
                                  onDragStart={() => {}}
                                  onDragEnd={() => {}}
                                  dragging={false}
                                  onRename={(name) => renameMutation.mutate({ fileId: file.id, filename: name })}
                                  onDelete={() => deleteFileMutation.mutate(file.id)}
                                />
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>)}
            </CardContent>
          </Card>
        </div>

        {/* Resize handle */}
        <div
          className="w-1 shrink-0 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors rounded-full self-stretch relative group"
          onMouseDown={handleResizeMouseDown}
          title="Потяните для изменения ширины"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Right panel: Preview */}
        <Card className="flex flex-col overflow-hidden flex-1 min-w-0">
          {!selectedFileId ? (
            <CardContent className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <File className="h-12 w-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Выберите файл для предпросмотра</p>
              </div>
            </CardContent>
          ) : (
            <>
              <CardHeader className="space-y-0 pb-2 border-b">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 min-w-0">
                    {hasFindings && (
                      <div className="flex items-center gap-1.5 flex-wrap" data-testid="legend-bar">
                        {Object.entries(legendCounts).filter(([, count]) => count > 0).map(([type, count]) => {
                          const hidden = hiddenFindingTypes.has(type);
                          return (
                            <button
                              key={type}
                              onClick={() => toggleFindingType(type)}
                              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border transition-all ${
                                hidden
                                  ? 'opacity-40 border-transparent bg-muted/40'
                                  : 'border-border bg-muted/60 hover-elevate'
                              }`}
                              title={hidden ? `Показать «${findingLabels[type] ?? type}»` : `Скрыть «${findingLabels[type] ?? type}»`}
                              data-testid={`legend-toggle-${type}`}
                            >
                              <div
                                className="w-2.5 h-2.5 rounded-sm shrink-0"
                                style={{ backgroundColor: findingColors[type] ?? '#888', opacity: hidden ? 0.4 : 0.85 }}
                              />
                              <span className={hidden ? 'line-through text-muted-foreground' : ''}>
                                {findingLabels[type] ?? type}
                              </span>
                              <span className="font-medium tabular-nums">{count}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedFileId && (
                      <Button size="sm" variant="outline" asChild>
                        <a
                          href={`/api/mbt/files/${selectedFileId}/serve`}
                          download={selectedFile?.originalName || selectedFile?.filename || 'document.pdf'}
                          title="Скачать файл"
                        >
                          <Download className="h-3.5 w-3.5 mr-1.5" />
                          Скачать
                        </a>
                      </Button>
                    )}
                    {selectedFile?.isApproved ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-green-600 border-green-500"
                        onClick={() => approveMutation.mutate({ fileId: selectedFileId!, approved: false })}
                        disabled={approveMutation.isPending}
                        data-testid="button-unapprove"
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Согласовано
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => approveMutation.mutate({ fileId: selectedFileId!, approved: true })}
                        disabled={approveMutation.isPending}
                        data-testid="button-approve"
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Согласовать
                      </Button>
                    )}
                    {currentAnalysis?.status === 'processing' ? (
                      <Button size="sm" disabled data-testid="button-analyzing" className="min-w-[120px]">
                        <Loader2 className="h-4 w-4 animate-spin mr-2 shrink-0" />
                        <span className="truncate">
                          {currentAnalysis.progressStage ?? 'Анализ...'}
                        </span>
                      </Button>
                    ) : currentAnalysis?.status === 'completed' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => analyzeMutation.mutate(selectedFileId!)}
                        data-testid="button-reanalyze"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        Повторить анализ
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => analyzeMutation.mutate(selectedFileId!)}
                        disabled={analyzeMutation.isPending}
                        data-testid="button-analyze"
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        Анализировать
                      </Button>
                    )}
                    {/* Payment orders toggle button */}
                    <Button
                      size="sm"
                      variant={showPaymentOrders ? 'default' : 'outline'}
                      onClick={() => { setShowPaymentOrders(v => !v); setShowStatement(false); }}
                      className="gap-1.5"
                      title="Извлечь и показать платёжные поручения"
                    >
                      <Banknote className="h-4 w-4" />
                      Реестр ПП
                    </Button>
                    {/* Bank statement extraction button */}
                    <Button
                      size="sm"
                      variant={showStatement ? 'default' : 'outline'}
                      onClick={() => { setShowStatement(v => !v); setShowPaymentOrders(false); }}
                      className="gap-1.5"
                      title="Извлечь банковскую выписку в Excel"
                    >
                      <FileSpreadsheet className="h-4 w-4" />
                      Выписка
                    </Button>
                    {/* Parsing mode button */}
                    <Button
                      size="sm"
                      variant={showParsingMode ? 'default' : 'outline'}
                      onClick={() => {
                        if (showParsingMode) {
                          setShowParsingMode(false);
                          deactivateParsingMode();
                          setShowStatement(false);
                          setShowPaymentOrders(false);
                        } else {
                          setShowParsingMode(true);
                          setShowStatement(false);
                          setShowPaymentOrders(false);
                          setParsingPageFrom(currentPage);
                          setParsingPageTo(null);
                          setTimeout(activateParsingMode, 300);
                        }
                      }}
                      className="gap-1.5"
                      title="Режим визуального парсинга"
                    >
                      <ScanText className="h-4 w-4" />
                      Парсинг
                    </Button>
                    {/* PDF split button — PDF files only */}
                    {selectedFile?.fileType === 'pdf' && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSplitDialogOpen(true)}
                        className="gap-1.5"
                        title="Разделить PDF на части"
                      >
                        <Scissors className="h-4 w-4" />
                        Разделить
                      </Button>
                    )}

                    {currentAnalysis?.status !== 'processing' && (
                      <Popover open={analysisSettingsOpen} onOpenChange={setAnalysisSettingsOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            data-testid="button-analysis-settings"
                            aria-label="Настройки анализа"
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-4" align="end">
                          <p className="text-sm font-medium mb-3">Параметры анализа</p>
                          <div className="space-y-3">
                            {/* Template selector */}
                            <div className="space-y-1.5">
                              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Шаблон</p>
                              <Select
                                value={selectedTemplateId ?? '__none__'}
                                onValueChange={(v) => setSelectedTemplateId(v === '__none__' ? null : v)}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="По умолчанию" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">По умолчанию</SelectItem>
                                  {analysisTemplates.map(tmpl => (
                                    <SelectItem key={tmpl.id} value={tmpl.id}>{tmpl.name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <button
                                className="text-xs text-primary hover:underline"
                                onClick={() => { setAnalysisSettingsOpen(false); setTemplateDialogOpen(true); }}
                              >
                                Управление шаблонами →
                              </button>
                            </div>

                            {/* Parameters: from template or defaults */}
                            <div>
                              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide mb-2">
                                {selectedTemplate ? 'Параметры шаблона' : 'Искать артефакты'}
                              </p>
                              {selectedTemplate ? (
                                <div className="space-y-1.5">
                                  {selectedTemplate.parameters.map(p => (
                                    <div key={p.key} className="flex items-center gap-2">
                                      <div
                                        className="w-3 h-3 rounded-full shrink-0"
                                        style={{ backgroundColor: p.color, opacity: p.enabled ? 1 : 0.3 }}
                                      />
                                      <span className={`text-sm ${!p.enabled ? 'text-muted-foreground line-through' : ''}`}>
                                        {p.label}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {([
                                    { key: 'findDates', label: 'Даты', color: '#22c55e' },
                                    { key: 'findSignatures', label: 'Подписи', color: '#3b82f6' },
                                    { key: 'findSeals', label: 'Печати', color: '#ef4444' },
                                  ] as const).map(({ key, label, color }) => (
                                    <div key={key} className="flex items-center gap-2">
                                      <Checkbox
                                        id={`analysis-setting-${key}`}
                                        checked={analysisSettings[key]}
                                        onCheckedChange={(v) =>
                                          setAnalysisSettings(p => ({ ...p, [key]: !!v }))
                                        }
                                        data-testid={`checkbox-${key}`}
                                      />
                                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                                      <label
                                        htmlFor={`analysis-setting-${key}`}
                                        className="text-sm cursor-pointer"
                                      >
                                        {label}
                                      </label>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="border-t pt-3 space-y-3">
                              <div>
                                <div className="flex items-center justify-between gap-2">
                                  <label
                                    htmlFor="analysis-setting-ocr"
                                    className="text-sm cursor-pointer"
                                  >
                                    OCR (для сканов)
                                  </label>
                                  <Switch
                                    id="analysis-setting-ocr"
                                    checked={analysisSettings.useOcr}
                                    onCheckedChange={(v) =>
                                      setAnalysisSettings(p => ({ ...p, useOcr: v }))
                                    }
                                    data-testid="switch-use-ocr"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Замедляет анализ, но помогает при нераспознанном тексте
                                </p>
                              </div>
                              <div>
                                <div className="flex items-center justify-between gap-2">
                                  <label
                                    htmlFor="analysis-setting-skip"
                                    className="text-sm cursor-pointer"
                                  >
                                    Пропускать готовые
                                  </label>
                                  <Switch
                                    id="analysis-setting-skip"
                                    checked={analysisSettings.skipAnalyzed}
                                    onCheckedChange={(v) =>
                                      setAnalysisSettings(p => ({ ...p, skipAnalyzed: v }))
                                    }
                                    data-testid="switch-skip-analyzed"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Не запускать повторный анализ для уже обработанных файлов
                                </p>
                              </div>
                            </div>
                          </div>
                        </PopoverContent>
                      </Popover>
                    )}
                  </div>
                </div>
              </CardHeader>

              {currentAnalysis?.status === 'error' && (
                <div className="px-4 py-2 bg-destructive/10 border-b flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>Ошибка анализа: {currentAnalysis.errorMessage}</span>
                </div>
              )}

              {currentAnalysis?.status === 'processing' && (
                <div className="border-b bg-muted/30">
                  <div className="px-4 pt-2 pb-1 flex items-center justify-between gap-3">
                    <span className="text-xs text-muted-foreground truncate">
                      {currentAnalysis.progressStage ?? 'Анализ...'}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 font-medium">
                      {currentAnalysis.progress ?? 0}%
                    </span>
                  </div>
                  <div className="h-1 w-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-700 ease-out"
                      style={{ width: `${currentAnalysis.progress ?? 0}%` }}
                    />
                  </div>
                </div>
              )}

              <CardContent className="flex-1 overflow-auto p-0 relative" ref={textLayerRef}>
                {showPaymentOrders && selectedFileId ? (
                  <PaymentOrdersPanel
                    fileId={selectedFileId}
                    filename={selectedFile?.filename ?? ''}
                  />
                ) : showStatement && selectedFileId ? (
                  <StatementExtractionPanel
                    fileId={selectedFileId}
                    filename={selectedFile?.filename ?? ''}
                  />
                ) : (
                  <div className="flex flex-col h-full">
                    <div className="flex flex-1 min-h-0 overflow-hidden">
                      <div className="flex-1 overflow-auto" ref={pdfContainerRef}>
                        {pdfUrl && (
                          <div className="flex flex-col items-center py-4">
                            <Document
                              key={pdfUrl}
                              file={pdfUrl}
                              onLoadSuccess={({ numPages: n }) => { setNumPages(n); setPdfLoading(false); }}
                              onLoadError={() => setPdfLoading(false)}
                              loading={
                                <div className="flex justify-center py-12">
                                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                                </div>
                              }
                            >
                              <div className="relative inline-block">
                                <Page
                                  pageNumber={currentPage}
                                  width={Math.min(780, window.innerWidth - 480)}
                                  renderTextLayer={true}
                                  renderAnnotationLayer={true}
                                  onRenderSuccess={onPageRenderSuccess}
                                />
                                {showParsingMode && parsingSubMode === 'bbox' && bboxPhase === 'mapping' && (
                                  <BboxZoneOverlay
                                    zones={bboxZones}
                                    columns={parsingColumns}
                                    activeColumnId={bboxActiveColumnId}
                                    onZoneAdd={zone => setBboxZones(prev => [...prev, zone])}
                                    onZoneDelete={id => setBboxZones(prev => prev.filter(z => z.id !== id))}
                                  />
                                )}
                              </div>
                            </Document>
                          </div>
                        )}
                      </div>

                      {/* Thumbnail navigator */}
                      {numPages > 0 && pdfUrl && (
                        <ThumbnailNavigator
                          pdfUrl={pdfUrl}
                          numPages={numPages}
                          currentPage={currentPage}
                          onPageSelect={setCurrentPage}
                          allFindings={visibleFindings}
                          markedPages={markedPages}
                          markButtons={markButtons}
                          findingColors={findingColors}
                          findingLabels={findingLabels}
                        />
                      )}
                    </div>

                    {/* Parsing mode panel */}
                    {showParsingMode && parsingPhase !== 'idle' && (
                      <>
                        {/* Mode switcher */}
                        <div className="border-t bg-muted/10 px-3 py-1.5 flex items-center gap-1.5 shrink-0">
                          <span className="text-xs text-muted-foreground mr-1">Режим:</span>
                          <button
                            onClick={() => {
                              setParsingSubMode('span');
                              setBboxActiveColumnId(null);
                              if (parsingPhase === 'mapping') setTimeout(activateParsingMode, 150);
                            }}
                            className={[
                              "px-2.5 py-0.5 text-xs rounded-md border transition-all",
                              parsingSubMode === 'span'
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background border-border hover:bg-muted/50",
                            ].join(" ")}
                          >
                            Текст
                          </button>
                          <button
                            onClick={() => {
                              setParsingSubMode('bbox');
                              deactivateParsingMode();
                              setParsingPhase('mapping');
                            }}
                            className={[
                              "px-2.5 py-0.5 text-xs rounded-md border transition-all",
                              parsingSubMode === 'bbox'
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-background border-border hover:bg-muted/50",
                            ].join(" ")}
                          >
                            Зоны
                          </button>
                        </div>

                        {/* Единая панель для обоих режимов */}
                        <ParsingModePanel
                          columns={parsingColumns}
                          mappings={parsingMappings}
                          selectedSpan={selectedSpan}
                          phase={parsingSubMode === 'bbox' ? bboxPhase : parsingPhase}
                          result={parsingSubMode === 'bbox' ? (bboxResult as any) : parsingResult}
                          sourceFilename={selectedFile?.filename ?? ''}
                          bboxMode={parsingSubMode === 'bbox'}
                          bboxActiveColumnId={parsingSubMode === 'bbox' ? bboxActiveColumnId : null}
                          canRun={parsingSubMode === 'bbox' ? bboxZones.length > 0 : parsingMappings.length > 0}
                          pageFrom={parsingPageFrom}
                          pageTo={parsingPageTo ?? numPages}
                          totalPages={numPages}
                          onPageRangeChange={(from, to) => { setParsingPageFrom(from); setParsingPageTo(to); }}
                          onColumnClick={handleParsingColumnClick}
                          onColumnAdd={() => {
                            const id    = `c${Date.now()}`;
                            const clrs  = ['#dbeafe','#dcfce7','#fef3c7','#fce7f3','#ede9fe','#ccfbf1','#fee2e2'];
                            const color = clrs[parsingColumns.length % clrs.length];
                            setParsingColumns(cols => [...cols, {
                              id, name: `Колонка ${cols.length + 1}`, color, isNumeric: false, previewValue: '',
                            }]);
                          }}
                          onColumnRename={(id, name) =>
                            setParsingColumns(cols => cols.map(c => c.id === id ? { ...c, name } : c))
                          }
                          onColumnDelete={(id) => {
                            setParsingColumns(cols => cols.filter(c => c.id !== id));
                            setParsingMappings(ms => ms.filter(m => m.columnId !== id));
                            setBboxZones(prev => prev.filter(z => z.columnId !== id));
                            if (bboxActiveColumnId === id) setBboxActiveColumnId(null);
                          }}
                          onColumnNumericToggle={(id) =>
                            setParsingColumns(cols => cols.map(c => c.id === id ? { ...c, isNumeric: !c.isNumeric } : c))
                          }
                          onMappingRemove={(columnId, spanText) => {
                            setParsingMappings(ms => ms.filter(
                              m => !(m.columnId === columnId && m.spanText === spanText)
                            ));
                            setParsingColumns(cols => cols.map(c => {
                              if (c.id !== columnId) return c;
                              const remaining = parsingMappings
                                .filter(m => m.columnId === columnId && m.spanText !== spanText)
                                .map(m => m.spanText).join(' ');
                              return { ...c, previewValue: remaining };
                            }));
                          }}
                          onSave={parsingSubMode === 'bbox' ? handleSaveBboxTemplate : handleSaveParsingTemplate}
                          onRun={parsingSubMode === 'bbox' ? handleRunBboxTemplate : handleRunParsingTemplate}
                          onReset={() => {
                            if (parsingSubMode === 'bbox') {
                              setBboxResult(null);
                              setBboxPhase('mapping');
                            } else {
                              setParsingResult(null);
                              setParsingPhase('mapping');
                              setTimeout(activateParsingMode, 150);
                            }
                          }}
                          onDownloadXlsx={parsingSubMode === 'bbox' ? handleDownloadBboxXlsx : handleDownloadParsingXlsx}
                        />
                      </>
                    )}
                  </div>
                )}
              </CardContent>

              {numPages > 0 && (
                <div className="border-t px-4 py-2 flex items-center justify-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage <= 1}
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    data-testid="button-prev-page"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="text-page-info">
                    <span>Стр.</span>
                    <input
                      type="number"
                      min={1}
                      max={numPages}
                      value={currentPage}
                      onChange={e => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v)) setCurrentPage(Math.max(1, Math.min(numPages, v)));
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                      }}
                      className="w-12 text-center border rounded px-1 py-0.5 text-sm bg-background text-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <span>из {numPages}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPage >= numPages}
                    onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                    data-testid="button-next-page"
                  >
                    <ChevronRightIcon className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* Bottom mark buttons panel */}
              {selectedFileId && (
                <div className="border-t px-3 py-2 flex items-center gap-2 flex-wrap bg-muted/20" data-testid="mark-buttons-panel">
                  {numPages > 0 && (
                    <span className="text-xs font-medium text-muted-foreground shrink-0 mr-1">
                      Стр. {currentPage}:
                    </span>
                  )}
                  {activeMarkButtons.length === 0 ? (
                    <span className="text-xs text-muted-foreground italic">Нет кнопок отметок —</span>
                  ) : (
                    activeMarkButtons.map(btn => {
                      const active = activeMarkKeys.has(btn.key);
                      return (
                        <Button
                          key={btn.id}
                          size="sm"
                          variant={active ? 'default' : 'outline'}
                          onClick={() => toggleMarkMutation.mutate({ fileId: selectedFileId, buttonKey: btn.key, page: currentPage })}
                          disabled={toggleMarkMutation.isPending}
                          data-testid={`button-mark-${btn.key}`}
                        >
                          {active && <Check className="h-3.5 w-3.5 mr-1.5" />}
                          {btn.label}
                        </Button>
                      );
                    })
                  )}
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setMarkButtonsOpen(true)}
                    className="ml-auto shrink-0"
                    data-testid="button-manage-marks"
                    title="Настроить кнопки отметок"
                  >
                    <Settings2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </main>

      {/* Upload Dialog */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Загрузить ZIP-архив</DialogTitle>
            <DialogDescription>
              Выберите ZIP-файл с документами (PDF, Word, Excel)
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
              data-testid="input-file-upload"
            />
            {isUploading ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="text-sm">Загрузка... {uploadProgress}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover-elevate"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const file = e.dataTransfer.files?.[0];
                  if (file) handleFileUpload(file);
                }}
                data-testid="dropzone-upload"
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Нажмите или перетащите ZIP-файл
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={isUploading}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Analysis Template Dialog */}
      <AnalysisTemplateDialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        projectId={projectId}
        selectedTemplateId={selectedTemplateId}
        onSelectTemplate={(id) => setSelectedTemplateId(id)}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDocId} onOpenChange={(open) => !open && setDeleteDocId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить документ?</AlertDialogTitle>
            <AlertDialogDescription>
              Документ и все вложенные файлы будут удалены.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteDocId && deleteDocMutation.mutate(deleteDocId)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Sections Management Dialog */}
      <SectionsDialog
        open={sectionsOpen}
        onOpenChange={setSectionsOpen}
        projectId={projectId!}
        sections={sections}
      />

      {/* Mark Buttons Management Dialog */}
      {markButtonsOpen && (
        <MarkButtonsDialog
          open={markButtonsOpen}
          onOpenChange={setMarkButtonsOpen}
          projectId={projectId!}
          sections={sections}
        />
      )}

      {/* Report Preview Dialog */}
      {reportScope && (
        <ReportPreviewDialog
          scope={reportScope}
          onOpenChange={(open) => { if (!open) setReportScope(null); }}
        />
      )}

      {/* Project Assistant Dialog */}
      <ProjectAssistantDialog
        projectId={projectId!}
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
      />

      {/* PDF Split Dialog */}
      {selectedFile && splitDialogOpen && (
        <PdfSplitDialog
          fileId={selectedFile.id}
          fileName={selectedFile.filename}
          documentId={selectedFile.documentId}
          open={splitDialogOpen}
          onOpenChange={setSplitDialogOpen}
          currentPage={currentPage}
          onSplitDone={() => {
            setSplitDialogOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ─── FileRow ─────────────────────────────────────────────────────────────────

interface FileRowProps {
  file: MbtDocFile;
  docName?: string;
  selected: boolean;
  checked: boolean;
  onSelect: () => void;
  onCheck: (checked: boolean) => void;
  onShiftClick?: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  dragging: boolean;
  onRename?: (newName: string) => void;
  onDelete?: () => void;
}

function FileRow({ file, docName, selected, checked, onSelect, onCheck, onShiftClick, onDragStart, onDragEnd, dragging, onRename, onDelete }: FileRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(file.filename);
    setRenaming(true);
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 30);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== file.filename) onRename?.(trimmed);
    setRenaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
    if (e.key === 'Escape') { setRenaming(false); }
  };

  const handleRowClick = (e: React.MouseEvent) => {
    if (renaming) return;
    if (e.shiftKey) { e.preventDefault(); onShiftClick?.(); }
    else onSelect();
  };

  return (
    <div
      draggable={!renaming}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer text-sm transition-colors select-none ${
        selected ? 'bg-accent text-accent-foreground' : 'hover-elevate'
      } ${dragging ? 'opacity-40' : ''}`}
      onClick={handleRowClick}
      data-testid={`file-${file.id}`}
    >
      <div
        className="shrink-0"
        onClick={(e) => { e.stopPropagation(); onCheck(!checked); }}
      >
        <Checkbox
          checked={checked}
          className="h-3.5 w-3.5"
          data-testid={`checkbox-file-${file.id}`}
        />
      </div>
      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 cursor-grab" />
      {file.isApproved ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" title="Согласовано" />
      ) : file.fileType === 'docx' ? (
        <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" title="Word" />
      ) : file.fileType === 'xlsx' ? (
        <FileSpreadsheet className="h-3.5 w-3.5 text-green-600 shrink-0" title="Excel" />
      ) : (
        <File className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      )}
      <div className="flex-1 min-w-0" onDoubleClick={onRename ? startRename : undefined}>
        {renaming ? (
          <input
            ref={inputRef}
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={e => e.stopPropagation()}
            className="w-full bg-background border border-primary rounded px-1 text-sm outline-none"
          />
        ) : (
          <>
            <div className="truncate" title={file.filename}>{file.filename}</div>
            {docName && (
              <div className="text-[10px] text-muted-foreground truncate" title={docName}>{docName}</div>
            )}
          </>
        )}
      </div>
      <FileStatusBadge file={file} />
      {onDelete && (
        <button
          className="shrink-0 invisible group-hover:visible opacity-60 hover:!opacity-100 hover:text-destructive transition-opacity"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Удалить файл"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ─── FileStatusBadge ─────────────────────────────────────────────────────────

function FileStatusBadge({ file }: { file: MbtDocFile }) {
  if (file.analysisStatus === 'processing') {
    return <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />;
  }
  if (file.analysisStatus === 'completed') {
    return <Sparkles className="h-3 w-3 text-blue-500 shrink-0" title="Анализ завершён" />;
  }
  if (file.analysisStatus === 'error') {
    return <XCircle className="h-3 w-3 text-destructive shrink-0" />;
  }
  return null;
}

// ─── SectionsDialog ──────────────────────────────────────────────────────────

const RULE_TYPE_OPTIONS = [
  { value: 'filename', label: 'Имя файла содержит' },
  { value: 'has_artifact', label: 'Находки анализа содержат слова' },
];

interface SectionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  sections: MbtSection[];
}

function SectionsDialog({ open, onOpenChange, projectId, sections }: SectionsDialogProps) {
  const { toast } = useToast();
  const [newName, setNewName] = useState('');
  const [newRuleType, setNewRuleType] = useState('filename');
  const [newRuleValue, setNewRuleValue] = useState('');
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editingSectionName, setEditingSectionName] = useState('');

  const createSectionMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest('POST', `/api/mbt/projects/${projectId}/sections`, {
        name,
        order: sections.length,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'sections'] });
      setNewName('');
      toast({ title: 'Раздел создан' });
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const deleteSectionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/mbt/sections/${id}`);
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'sections'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/documents-files', projectId] });
      if (activeSectionId === id) setActiveSectionId(null);
    },
  });

  const updateSectionMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const res = await apiRequest('PATCH', `/api/mbt/sections/${id}`, { name });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'sections'] });
      setEditingSectionId(null);
      toast({ title: 'Раздел переименован' });
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const createRuleMutation = useMutation({
    mutationFn: async ({ sectionId, type, value }: { sectionId: string; type: string; value: string }) => {
      const res = await apiRequest('POST', `/api/mbt/sections/${sectionId}/rules`, { type, value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'sections'] });
      setNewRuleValue('');
      toast({ title: 'Правило добавлено' });
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const updateRuleMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const res = await apiRequest('PATCH', `/api/mbt/section-rules/${id}`, { value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'sections'] });
      setEditingRuleId(null);
      toast({ title: 'Правило обновлено' });
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/mbt/section-rules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'sections'] });
      if (editingRuleId) setEditingRuleId(null);
    },
  });

  const activeSection = sections.find(s => s.id === activeSectionId) || null;

  const startEdit = (rule: MbtSectionRule) => {
    setEditingRuleId(rule.id);
    setEditingValue(rule.value === 'true' ? '' : rule.value);
  };

  const saveEdit = () => {
    if (!editingRuleId) return;
    updateRuleMutation.mutate({ id: editingRuleId, value: editingValue.trim() || 'true' });
  };

  const cancelEdit = () => setEditingRuleId(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-testid="sections-dialog">
      {/* Header */}
      <div className="h-14 border-b shrink-0 flex items-center justify-between px-6">
        <div>
          <h2 className="text-base font-semibold">Управление разделами</h2>
          <p className="text-xs text-muted-foreground">Разделы и правила автоматической маршрутизации файлов</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)} data-testid="button-close-sections">
          <X className="h-5 w-5" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: section list */}
        <div className="w-72 shrink-0 border-r flex flex-col">
          <div className="p-4 border-b">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Разделы</p>
            <div className="flex gap-2">
              <Input
                placeholder="Название раздела"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) createSectionMutation.mutate(newName.trim()); }}
                className="text-sm"
                data-testid="input-section-name"
              />
              <Button
                size="icon"
                disabled={!newName.trim() || createSectionMutation.isPending}
                onClick={() => createSectionMutation.mutate(newName.trim())}
                data-testid="button-add-section"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-2 space-y-0.5">
              {sections.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">Нет разделов</p>
              ) : (
                [...sections].sort((a, b) => a.order - b.order).map(s => (
                  <div
                    key={s.id}
                    className={`group flex items-center gap-1.5 px-2 py-1.5 rounded-md text-sm ${
                      editingSectionId === s.id
                        ? 'bg-accent/50'
                        : activeSectionId === s.id
                        ? 'bg-accent text-accent-foreground cursor-pointer'
                        : 'hover-elevate cursor-pointer'
                    }`}
                    onClick={() => { if (editingSectionId !== s.id) setActiveSectionId(s.id); }}
                    data-testid={`section-item-${s.id}`}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />

                    {/* Inline edit mode */}
                    {editingSectionId === s.id ? (
                      <div className="flex-1 flex items-center gap-1 min-w-0">
                        <Input
                          value={editingSectionName}
                          onChange={e => setEditingSectionName(e.target.value)}
                          className="h-6 text-sm px-1 py-0"
                          autoFocus
                          onKeyDown={e => {
                            if (e.key === 'Enter' && editingSectionName.trim()) {
                              updateSectionMutation.mutate({ id: s.id, name: editingSectionName.trim() });
                            }
                            if (e.key === 'Escape') setEditingSectionId(null);
                          }}
                          onClick={e => e.stopPropagation()}
                          data-testid={`input-rename-section-${s.id}`}
                        />
                        <button
                          className="shrink-0 text-primary hover:opacity-80"
                          onClick={e => {
                            e.stopPropagation();
                            if (editingSectionName.trim()) {
                              updateSectionMutation.mutate({ id: s.id, name: editingSectionName.trim() });
                            }
                          }}
                          disabled={updateSectionMutation.isPending || !editingSectionName.trim()}
                          data-testid={`button-save-section-${s.id}`}
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="shrink-0 opacity-60 hover:opacity-100"
                          onClick={e => { e.stopPropagation(); setEditingSectionId(null); }}
                          data-testid={`button-cancel-rename-section-${s.id}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="flex-1 truncate">{s.name}</span>
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          {s.rules.length}
                        </Badge>
                        <button
                          className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                          onClick={e => {
                            e.stopPropagation();
                            setEditingSectionId(s.id);
                            setEditingSectionName(s.name);
                          }}
                          data-testid={`button-edit-section-${s.id}`}
                          title="Переименовать"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                          onClick={e => { e.stopPropagation(); deleteSectionMutation.mutate(s.id); }}
                          data-testid={`button-delete-section-${s.id}`}
                          title="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* Right: rules */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!activeSection ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Выберите раздел для настройки правил</p>
              </div>
            </div>
          ) : (
            <>
              {/* Rules header */}
              <div className="px-6 py-4 border-b shrink-0">
                <h3 className="text-sm font-semibold">{activeSection.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Правила маршрутизации — срабатывает первое совпадение</p>
              </div>

              {/* Existing rules */}
              <ScrollArea className="flex-1 px-6 py-4">
                <div className="space-y-2">
                  {activeSection.rules.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Нет правил — файлы не будут автоматически попадать в этот раздел</p>
                  ) : (
                    activeSection.rules.map(rule => (
                      <div key={rule.id} className="border rounded-md p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-[10px] shrink-0">
                            {RULE_TYPE_LABELS[rule.type] || rule.type}
                          </Badge>
                          <div className="flex items-center gap-1 ml-auto">
                            {editingRuleId !== rule.id && (
                              <button
                                className="opacity-50 hover:opacity-100 transition-opacity"
                                onClick={() => startEdit(rule)}
                                data-testid={`button-edit-rule-${rule.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              className="opacity-50 hover:opacity-100 transition-opacity"
                              onClick={() => deleteRuleMutation.mutate(rule.id)}
                              data-testid={`button-delete-rule-${rule.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {editingRuleId === rule.id ? (
                          <div className="flex flex-col gap-2">
                            <Textarea
                              value={editingValue}
                              onChange={e => setEditingValue(e.target.value)}
                              placeholder={rule.type === 'has_artifact'
                                ? 'Ключевые слова (по одному на строку). Пусто = любые находки'
                                : 'Подстроки имён файлов (по одному на строку)'}
                              className="text-xs min-h-[80px] resize-y"
                              onKeyDown={e => { if (e.key === 'Escape') cancelEdit(); }}
                              autoFocus
                              data-testid={`input-edit-rule-${rule.id}`}
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                onClick={saveEdit}
                                disabled={updateRuleMutation.isPending}
                                data-testid={`button-save-rule-${rule.id}`}
                              >
                                <Check className="h-3.5 w-3.5 mr-1" />
                                Сохранить
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit}>Отмена</Button>
                            </div>
                          </div>
                        ) : (
                          rule.value && rule.value !== 'true' ? (
                            <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                              {rule.value}
                            </p>
                          ) : rule.type === 'has_artifact' ? (
                            <p className="text-xs text-muted-foreground italic">Любые завершённые находки анализа</p>
                          ) : null
                        )}
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>

              {/* Add rule form */}
              <div className="border-t px-6 py-4 shrink-0 flex flex-col gap-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Добавить правило</p>
                <div className="flex gap-3 items-start">
                  <Select value={newRuleType} onValueChange={v => { setNewRuleType(v); setNewRuleValue(''); }}>
                    <SelectTrigger className="w-60 shrink-0 text-sm" data-testid="select-rule-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RULE_TYPE_OPTIONS.map(o => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex-1 flex flex-col gap-2">
                    <Textarea
                      placeholder={newRuleType === 'has_artifact'
                        ? 'Ключевые слова для поиска в находках (по одному на строку).\nПусто = файл попадает в раздел при любых завершённых находках.'
                        : 'Подстроки имён файлов (по одному на строку).\nФайл попадает в раздел, если его имя содержит любую из строк.'}
                      value={newRuleValue}
                      onChange={e => setNewRuleValue(e.target.value)}
                      className="text-sm min-h-[80px] resize-y"
                      data-testid="input-rule-value"
                    />
                    <Button
                      onClick={() => createRuleMutation.mutate({
                        sectionId: activeSection.id,
                        type: newRuleType,
                        value: newRuleValue.trim() || 'true',
                      })}
                      disabled={createRuleMutation.isPending}
                      className="self-end"
                      data-testid="button-add-rule"
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Добавить правило
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ThumbnailNavigator ───────────────────────────────────────────────────────

// Палитра цветов для кнопок ручной разметки
const MARK_BUTTON_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444',
  '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6',
];
function markButtonColor(key: string, allKeys: string[]): string {
  const idx = allKeys.indexOf(key);
  return MARK_BUTTON_COLORS[idx % MARK_BUTTON_COLORS.length];
}

interface ThumbnailNavigatorProps {
  pdfUrl: string;
  numPages: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
  allFindings: Finding[];
  markedPages?: Map<number, string[]>;
  markButtons?: MbtMarkButton[];
  findingColors: Record<string, string>;
  findingLabels: Record<string, string>;
}

function ThumbnailNavigator({ pdfUrl, numPages, currentPage, onPageSelect, allFindings, markedPages, markButtons = [], findingColors, findingLabels }: ThumbnailNavigatorProps) {
  const thumbWidth = 72;
  // Порядок всех ключей кнопок для стабильного назначения цветов
  const allButtonKeys = markButtons.map(b => b.key);

  return (
    <div className="w-24 border-l bg-muted/20 flex flex-col overflow-y-auto shrink-0" data-testid="thumbnail-navigator">
      <Document key={pdfUrl} file={pdfUrl} loading={null}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
          const pageFindingTypes = Array.from(new Set(
            allFindings.filter(f => f.page === pageNum).map(f => f.type)
          ));
          const pageMarkKeys = Array.from(new Set(markedPages?.get(pageNum) ?? []));

          return (
            <button
              key={pageNum}
              onClick={() => onPageSelect(pageNum)}
              className={`w-full p-1 flex flex-col items-center gap-0.5 border-b transition-colors ${
                currentPage === pageNum ? 'bg-accent' : 'hover-elevate'
              }`}
              data-testid={`thumbnail-page-${pageNum}`}
            >
              <div className="relative w-full">
                <Page
                  pageNumber={pageNum}
                  width={thumbWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={
                    <div
                      className="bg-muted rounded-sm"
                      style={{ width: thumbWidth, height: Math.round(thumbWidth * 1.41) }}
                    />
                  }
                />
                {/* Полупрозрачный слой, чтобы текст не сливался с маркерами */}
                <div className="absolute inset-0 bg-white/50 dark:bg-black/40 pointer-events-none" />

                {/* Вверху: отметки AI-анализа */}
                {pageFindingTypes.length > 0 && (
                  <div className="absolute top-0.5 left-0.5 right-0.5 flex gap-0.5 flex-wrap">
                    {pageFindingTypes.map(type => (
                      <div
                        key={type}
                        className="w-2 h-2 rounded-full shadow-sm"
                        style={{ backgroundColor: findingColors[type] ?? '#888' }}
                        title={findingLabels[type] ?? type}
                      />
                    ))}
                  </div>
                )}

                {/* Внизу: отметки кнопок пользователя */}
                {pageMarkKeys.length > 0 && (
                  <div className="absolute bottom-0.5 left-0.5 right-0.5 flex gap-0.5 flex-wrap">
                    {pageMarkKeys.map(key => {
                      const btn = markButtons.find(b => b.key === key);
                      return (
                        <div
                          key={key}
                          className="w-2 h-2 rounded-full shadow-sm"
                          style={{ backgroundColor: markButtonColor(key, allButtonKeys) }}
                          title={btn?.label ?? key}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground leading-none">{pageNum}</span>
            </button>
          );
        })}
      </Document>
    </div>
  );
}

// ─── MarkButtonsDialog ────────────────────────────────────────────────────────

interface MarkButtonsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  sections: MbtSection[];
}

function MarkButtonsDialog({ open, onOpenChange, projectId, sections }: MarkButtonsDialogProps) {
  const { toast } = useToast();
  const [newLabel, setNewLabel] = useState('');
  const [newSectionId, setNewSectionId] = useState<string>('__global__');

  const { data: buttons = [], refetch } = useQuery<MbtMarkButton[]>({
    queryKey: ['/api/mbt/projects', projectId, 'mark-buttons', 'all'],
    queryFn: async () => {
      const res = await fetch(`/api/mbt/projects/${projectId}/mark-buttons`, { credentials: 'include' });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async ({ label, sectionId }: { label: string; sectionId: string | null }) => {
      const res = await apiRequest('POST', `/api/mbt/projects/${projectId}/mark-buttons`, {
        label,
        sectionId,
        order: buttons.length,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'mark-buttons'] });
      refetch();
      setNewLabel('');
      toast({ title: 'Кнопка добавлена' });
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/mbt/mark-buttons/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'mark-buttons'] });
      refetch();
    },
    onError: () => toast({ title: 'Ошибка', variant: 'destructive' }),
  });

  const handleCreate = () => {
    if (!newLabel.trim()) return;
    createMutation.mutate({
      label: newLabel.trim(),
      sectionId: newSectionId === '__global__' ? null : newSectionId,
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background" data-testid="mark-buttons-dialog">
      <div className="h-14 border-b shrink-0 flex items-center justify-between px-6">
        <div>
          <h2 className="text-base font-semibold">Кнопки отметок</h2>
          <p className="text-xs text-muted-foreground">Кнопки для ручной разметки документов при проверке</p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 flex flex-col gap-4 max-w-2xl mx-auto w-full">
        <div className="border rounded-md p-4 flex flex-col gap-3">
          <p className="text-sm font-medium">Добавить кнопку</p>
          <div className="flex gap-3">
            <Input
              placeholder="Название кнопки (напр. «Нет подписи»)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
              className="flex-1"
              data-testid="input-button-label"
            />
            <Select value={newSectionId} onValueChange={setNewSectionId}>
              <SelectTrigger className="w-48 shrink-0" data-testid="select-button-section">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__global__">Глобальная (все разделы)</SelectItem>
                {sections.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={handleCreate}
              disabled={!newLabel.trim() || createMutation.isPending}
              data-testid="button-create-mark-button"
            >
              <Plus className="h-4 w-4 mr-2" />
              Добавить
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Глобальные кнопки доступны для всех документов. Кнопки раздела — только для документов в этом разделе.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {buttons.length === 0 ? (
            <p className="text-sm text-muted-foreground italic text-center py-8">Нет кнопок отметок</p>
          ) : (
            buttons.map(btn => {
              const sectionName = btn.sectionId ? sections.find(s => s.id === btn.sectionId)?.name : null;
              return (
                <div key={btn.id} className="flex items-center gap-3 border rounded-md px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{btn.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {sectionName ? `Раздел: ${sectionName}` : 'Глобальная'}
                    </p>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(btn.id)}
                    data-testid={`button-delete-mark-${btn.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ReportPreviewDialog ─────────────────────────────────────────────────────

interface ReportScope {
  projectId: string;
  documentId?: string;
  sectionId?: string;
  fileId?: string;
  title: string;
}

interface ReportRow {
  fileId: string;
  filename: string;
  documentName: string;
  sectionId: string | null;
  sectionName: string | null;
  isApproved: boolean;
  sealCount: number;
  signatureCount: number;
  dateCount: number;
  analysisStatus: string;
  marks: Array<{ key: string; label: string; page: number | null; createdAt: string }>;
}

interface ReportData {
  project: { id: string; name: string };
  sections: { id: string; name: string }[];
  markButtonLabels: Record<string, string>;
  rows: ReportRow[];
}

const ANALYSIS_STATUS_LABELS: Record<string, string> = {
  completed: 'Завершён',
  processing: 'Обрабатывается',
  error: 'Ошибка',
  none: 'Не запускался',
  pending: 'Ожидает',
};

function ReportPreviewDialog({ scope, onOpenChange }: { scope: ReportScope; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);

  const params = new URLSearchParams({ projectId: scope.projectId });
  if (scope.documentId) params.set('documentId', scope.documentId);
  if (scope.sectionId) params.set('sectionId', scope.sectionId);
  if (scope.fileId) params.set('fileId', scope.fileId);

  const { data, isLoading, isError } = useQuery<ReportData>({
    queryKey: ['/api/mbt/report', scope.projectId, scope.documentId, scope.sectionId, scope.fileId],
    queryFn: async () => {
      const res = await fetch(`/api/mbt/report?${params.toString()}`);
      if (!res.ok) throw new Error('Ошибка загрузки отчёта');
      return res.json();
    },
  });

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const xlsxParams = new URLSearchParams(params);
      xlsxParams.set('format', 'xlsx');
      const res = await fetch(`/api/mbt/report?${xlsxParams.toString()}`);
      if (!res.ok) throw new Error('Ошибка генерации XLSX');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = res.headers.get('content-disposition') ?? '';
      const match = cd.match(/filename\*=UTF-8''(.+)/);
      a.download = match ? decodeURIComponent(match[1]) : `КПД_отчёт.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: 'Ошибка', description: 'Не удалось скачать отчёт', variant: 'destructive' });
    } finally {
      setDownloading(false);
    }
  };

  // Group rows by section
  const groupedRows: Array<{ sectionId: string | null; sectionName: string | null; rows: ReportRow[] }> = [];
  if (data) {
    const seen = new Map<string | null, ReportRow[]>();
    for (const row of data.rows) {
      const key = row.sectionId ?? null;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(row);
    }
    for (const [sectionId, rows] of seen.entries()) {
      groupedRows.push({ sectionId, sectionName: rows[0].sectionName, rows });
    }
  }

  const totalApproved = data?.rows.filter(r => r.isApproved).length ?? 0;
  const totalFiles = data?.rows.length ?? 0;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold truncate">Отчёт КПД — {scope.title}</DialogTitle>
              {data && (
                <DialogDescription className="text-xs mt-0.5">
                  {totalFiles} файлов · {totalApproved} согласовано
                  {data.rows.reduce((s, r) => s + r.sealCount, 0) > 0 && ` · ${data.rows.reduce((s, r) => s + r.sealCount, 0)} печатей`}
                  {data.rows.reduce((s, r) => s + r.signatureCount, 0) > 0 && ` · ${data.rows.reduce((s, r) => s + r.signatureCount, 0)} подписей`}
                </DialogDescription>
              )}
            </div>
            <Button
              size="sm"
              onClick={handleDownload}
              disabled={downloading || !data || data.rows.length === 0}
              data-testid="button-download-xlsx"
              className="shrink-0"
            >
              {downloading
                ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />Скачивание…</>
                : <><FileSpreadsheet className="h-4 w-4 mr-1.5" />Скачать XLSX</>
              }
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex items-center justify-center py-16 text-destructive text-sm">
              Ошибка загрузки данных
            </div>
          ) : !data || data.rows.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Нет файлов для отчёта
            </div>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-xs text-muted-foreground sticky top-0">
                  <th className="px-3 py-2 text-left font-medium w-8">№</th>
                  <th className="px-3 py-2 text-left font-medium">Файл</th>
                  <th className="px-3 py-2 text-left font-medium w-32">Раздел</th>
                  <th className="px-3 py-2 text-center font-medium w-20">Согл.</th>
                  <th className="px-3 py-2 text-center font-medium w-16" title="Печатей">Печ.</th>
                  <th className="px-3 py-2 text-center font-medium w-16" title="Подписей">Подп.</th>
                  <th className="px-3 py-2 text-center font-medium w-12" title="Дат">Дат</th>
                  <th className="px-3 py-2 text-left font-medium">Отметки</th>
                  <th className="px-3 py-2 text-left font-medium w-28">Анализ</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map(({ sectionId, sectionName, rows }) => (
                  <Fragment key={sectionId ?? '__unsorted'}>
                    {groupedRows.length > 1 && (
                      <tr className="bg-muted/20">
                        <td colSpan={9} className="px-3 py-1.5 text-xs font-semibold text-muted-foreground">
                          {sectionName ?? 'Нераспределённые'}
                          <span className="ml-2 font-normal">
                            {rows.length} файл{rows.length === 1 ? '' : rows.length < 5 ? 'а' : 'ов'}
                            {' · '}
                            {rows.filter(r => r.isApproved).length} согласовано
                          </span>
                        </td>
                      </tr>
                    )}
                    {rows.map((row, i) => (
                      <tr
                        key={row.fileId}
                        className="border-b last:border-0 hover-elevate"
                        data-testid={`report-row-${row.fileId}`}
                      >
                        <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                        <td className="px-3 py-2 max-w-0">
                          <div className="truncate font-medium" title={row.filename}>{row.filename}</div>
                          {row.documentName && (
                            <div className="text-[10px] text-muted-foreground truncate" title={row.documentName}>{row.documentName}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          <div className="truncate" title={row.sectionName ?? undefined}>{row.sectionName ?? '—'}</div>
                        </td>
                        <td className="px-3 py-2 text-center">
                          {row.isApproved
                            ? <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />
                            : <span className="text-muted-foreground text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {row.sealCount > 0 ? <span className="font-medium">{row.sealCount}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {row.signatureCount > 0 ? <span className="font-medium">{row.signatureCount}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {row.dateCount > 0 ? <span className="font-medium">{row.dateCount}</span> : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-3 py-2">
                          {row.marks.length === 0 ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {row.marks.map((m, mi) => (
                                <Badge key={mi} variant="secondary" className="text-[10px]">
                                  {m.label}{m.page ? ` стр. ${m.page}` : ''}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {ANALYSIS_STATUS_LABELS[row.analysisStatus] ?? row.analysisStatus}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
              {data.rows.length > 1 && (
                <tfoot>
                  <tr className="border-t bg-muted/40 font-medium">
                    <td className="px-3 py-2 text-xs" colSpan={2}>Итого по архиву</td>
                    <td />
                    <td className="px-3 py-2 text-center text-xs">{totalApproved}/{totalFiles}</td>
                    <td className="px-3 py-2 text-center text-xs">{data.rows.reduce((s, r) => s + r.sealCount, 0) || '—'}</td>
                    <td className="px-3 py-2 text-center text-xs">{data.rows.reduce((s, r) => s + r.signatureCount, 0) || '—'}</td>
                    <td className="px-3 py-2 text-center text-xs">{data.rows.reduce((s, r) => s + r.dateCount, 0) || '—'}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
