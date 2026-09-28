import { useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ChevronDown, ChevronRight, FolderOpen, Folder, Plus, Pencil, Trash2,
  File, FileText, GripVertical, X, Check, Loader2, Link2, Unlink,
} from 'lucide-react';
import { DOC_RELATION_TYPE_LABELS, DOC_RELATION_TYPES } from '@shared/schema';
import type { DocRelationType } from '@shared/schema';

// ─── types ──────────────────────────────────────────────────────────────────
interface DocFolder {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  color: string;
  order: number;
  createdAt: string;
}

interface MbtDocFile {
  id: string;
  documentId: string;
  filename: string;
  fileType: string;
  analysisStatus: string;
  extractionStatus: string;
  pageCount: number;
  sectionId?: string | null;
  folderId?: string | null;
  isApproved?: boolean;
}

interface FileRelation {
  id: string;
  fileId: string;
  relatedFileId: string;
  relationType: DocRelationType;
  note?: string | null;
  createdAt: string;
  relatedFileName: string;
}

interface Props {
  projectId: string;
  allFiles: MbtDocFile[];
  selectedFileId: string | null;
  onSelectFile: (fileId: string) => void;
}

// ─── colour palette ──────────────────────────────────────────────────────────
const PALETTE = [
  '#6b7280', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6',
];

// ─── small helpers ───────────────────────────────────────────────────────────
function fileLabel(f: MbtDocFile) {
  try {
    return decodeURIComponent(f.filename).replace(/%20/g, ' ');
  } catch {
    return f.filename;
  }
}

function FolderColorDot({ color }: { color: string }) {
  return <span className="h-2.5 w-2.5 rounded-full shrink-0 inline-block" style={{ background: color }} />;
}

// ─── FileRow inside folder tree ──────────────────────────────────────────────
function FolderFileRow({
  file, selected, dragOver,
  onSelect, onDragStart, onDragEnd, onDragOver,
}: {
  file: MbtDocFile;
  selected: boolean;
  dragOver: boolean;
  onSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  return (
    <div
      className={`group flex items-center gap-1.5 py-1 px-2 rounded cursor-pointer text-sm transition-colors
        ${selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60'}
        ${dragOver ? 'ring-1 ring-primary' : ''}`}
      onClick={onSelect}
      draggable
      onDragStart={(e) => { e.stopPropagation(); onDragStart(); }}
      onDragEnd={onDragEnd}
      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); onDragOver(e); }}
    >
      <GripVertical className="h-3 w-3 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-60 cursor-grab" />
      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="truncate flex-1 text-xs" title={fileLabel(file)}>{fileLabel(file)}</span>
      {file.isApproved && (
        <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" title="Одобрен" />
      )}
    </div>
  );
}

// ─── FolderNode (recursive) ──────────────────────────────────────────────────
function FolderNode({
  folder, allFolders, filesInFolder,
  depth, selectedFileId, draggedFileId, dragOverFolderId,
  onSelectFile, onDragStartFile, onDragEndFile, onDropInFolder,
  onDragOverFolder, onCreateChild, onRename, onDelete, onChangeColor,
}: {
  folder: DocFolder;
  allFolders: DocFolder[];
  filesInFolder: Record<string, MbtDocFile[]>;
  depth: number;
  selectedFileId: string | null;
  draggedFileId: string | null;
  dragOverFolderId: string | null;
  onSelectFile: (id: string) => void;
  onDragStartFile: (id: string) => void;
  onDragEndFile: () => void;
  onDropInFolder: (folderId: string | null) => void;
  onDragOverFolder: (id: string) => void;
  onCreateChild: (parentId: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onChangeColor: (id: string, color: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editVal, setEditVal] = useState(folder.name);
  const [colorOpen, setColorOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const children = allFolders.filter(f => f.parentId === folder.id);
  const files = filesInFolder[folder.id] || [];
  const isOver = dragOverFolderId === folder.id;

  function commitRename() {
    if (editVal.trim() && editVal !== folder.name) {
      onRename(folder.id, editVal.trim());
    }
    setEditing(false);
  }

  return (
    <div style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      {/* Header row */}
      <div
        className={`group flex items-center gap-1 py-1.5 px-1 rounded-md cursor-pointer transition-colors
          ${isOver && draggedFileId ? 'bg-primary/10 ring-1 ring-primary' : 'hover:bg-muted/60'}`}
        onClick={() => !editing && setExpanded(e => !e)}
        onDragOver={(e) => { e.preventDefault(); onDragOverFolder(folder.id); }}
        onDrop={(e) => { e.preventDefault(); onDropInFolder(folder.id); }}
      >
        {expanded
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}

        <FolderColorDot color={folder.color || '#6b7280'} />

        {expanded
          ? <FolderOpen className="h-3.5 w-3.5 shrink-0" style={{ color: folder.color || '#6b7280' }} />
          : <Folder className="h-3.5 w-3.5 shrink-0" style={{ color: folder.color || '#6b7280' }} />}

        {editing ? (
          <input
            ref={inputRef}
            className="flex-1 text-sm bg-transparent border-b border-primary outline-none"
            value={editVal}
            autoFocus
            onChange={e => setEditVal(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(false); }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span
            className="text-sm font-medium flex-1 truncate"
            onDoubleClick={(e) => { e.stopPropagation(); setEditing(true); setEditVal(folder.name); }}
          >
            {folder.name}
          </span>
        )}

        <Badge variant="secondary" className="text-[10px] shrink-0">{files.length + children.reduce((s, c) => s + (filesInFolder[c.id]?.length || 0), 0)}</Badge>

        {/* action buttons (visible on hover) */}
        <div className="shrink-0 flex items-center gap-0.5 invisible group-hover:visible">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-0.5 rounded hover:bg-muted"
                onClick={(e) => { e.stopPropagation(); onCreateChild(folder.id); }}
              >
                <Plus className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Создать подпапку</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-0.5 rounded hover:bg-muted"
                onClick={(e) => { e.stopPropagation(); setEditing(true); setEditVal(folder.name); }}
              >
                <Pencil className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Переименовать</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-0.5 rounded hover:bg-muted"
                onClick={(e) => { e.stopPropagation(); setColorOpen(!colorOpen); }}
              >
                <span className="h-3 w-3 rounded-full inline-block" style={{ background: folder.color || '#6b7280' }} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Цвет</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onDelete(folder.id); }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Удалить папку</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Color picker */}
      {colorOpen && (
        <div className="flex flex-wrap gap-1 px-6 pb-1" onClick={e => e.stopPropagation()}>
          {PALETTE.map(c => (
            <button
              key={c}
              className={`h-4 w-4 rounded-full transition-transform hover:scale-110 ${folder.color === c ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
              style={{ background: c }}
              onClick={() => { onChangeColor(folder.id, c); setColorOpen(false); }}
            />
          ))}
        </div>
      )}

      {/* Children */}
      {expanded && (
        <div>
          {children.map(child => (
            <FolderNode
              key={child.id}
              folder={child}
              allFolders={allFolders}
              filesInFolder={filesInFolder}
              depth={depth + 1}
              selectedFileId={selectedFileId}
              draggedFileId={draggedFileId}
              dragOverFolderId={dragOverFolderId}
              onSelectFile={onSelectFile}
              onDragStartFile={onDragStartFile}
              onDragEndFile={onDragEndFile}
              onDropInFolder={onDropInFolder}
              onDragOverFolder={onDragOverFolder}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onDelete={onDelete}
              onChangeColor={onChangeColor}
            />
          ))}
          {files.map(f => (
            <FolderFileRow
              key={f.id}
              file={f}
              selected={selectedFileId === f.id}
              dragOver={false}
              onSelect={() => onSelectFile(f.id)}
              onDragStart={() => onDragStartFile(f.id)}
              onDragEnd={onDragEndFile}
              onDragOver={() => {}}
            />
          ))}
          {files.length === 0 && children.length === 0 && (
            <div className="px-4 py-1 text-xs text-muted-foreground italic">Пустая папка</div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Relations panel ─────────────────────────────────────────────────────────
function RelationsPanel({ fileId, allFiles, projectId }: {
  fileId: string;
  allFiles: MbtDocFile[];
  projectId: string;
}) {
  const { toast } = useToast();
  const [relatedFileId, setRelatedFileId] = useState<string>('');
  const [relationType, setRelationType] = useState<string>('reference');
  const [note, setNote] = useState('');
  const [showForm, setShowForm] = useState(false);

  const { data: relations = [], isLoading } = useQuery<FileRelation[]>({
    queryKey: ['/api/mbt/files', fileId, 'relations'],
    queryFn: () => apiRequest('GET', `/api/mbt/files/${fileId}/relations`).then(r => r.json()),
    enabled: !!fileId,
  });

  const addMutation = useMutation({
    mutationFn: () => apiRequest('POST', `/api/mbt/files/${fileId}/relations`, {
      relatedFileId, relationType, note: note || null,
    }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/files', fileId, 'relations'] });
      setShowForm(false);
      setRelatedFileId('');
      setNote('');
      toast({ title: 'Связь добавлена' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/mbt/file-relations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/files', fileId, 'relations'] });
    },
  });

  const otherFiles = allFiles.filter(f => f.id !== fileId);

  return (
    <div className="border-t pt-2 mt-2 px-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Link2 className="h-3 w-3" /> Связи между документами
        </span>
        <button
          className="text-xs text-primary hover:underline flex items-center gap-0.5"
          onClick={() => setShowForm(s => !s)}
        >
          {showForm ? <X className="h-3 w-3" /> : <Plus className="h-3 w-3" />}
          {showForm ? 'Отмена' : 'Добавить'}
        </button>
      </div>

      {showForm && (
        <div className="space-y-1.5 mb-2 bg-muted/40 rounded-md p-2">
          <Select value={relatedFileId} onValueChange={setRelatedFileId}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="Выберите документ..." />
            </SelectTrigger>
            <SelectContent>
              {otherFiles.map(f => (
                <SelectItem key={f.id} value={f.id}>
                  <span className="text-xs truncate max-w-[200px]">{fileLabel(f)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={relationType} onValueChange={setRelationType}>
            <SelectTrigger className="h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_RELATION_TYPES.map(t => (
                <SelectItem key={t} value={t}>{DOC_RELATION_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            className="h-7 text-xs"
            placeholder="Примечание (необязательно)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <Button
            size="sm"
            className="w-full h-7 text-xs"
            onClick={() => addMutation.mutate()}
            disabled={!relatedFileId || addMutation.isPending}
          >
            {addMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
            Добавить связь
          </Button>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : relations.length === 0 ? (
        <div className="text-xs text-muted-foreground italic py-1 px-1">Нет связей</div>
      ) : (
        <div className="space-y-1">
          {relations.map(rel => (
            <div key={rel.id} className="flex items-start gap-1.5 group">
              <div className="flex-1 min-w-0">
                <span className="text-xs text-primary/80 font-medium">{DOC_RELATION_TYPE_LABELS[rel.relationType]}</span>
                <span className="text-xs text-muted-foreground mx-1">→</span>
                <span className="text-xs truncate" title={rel.relatedFileName}>
                  {decodeURIComponent(rel.relatedFileName).replace(/%20/g, ' ')}
                </span>
                {rel.note && (
                  <div className="text-[10px] text-muted-foreground italic">{rel.note}</div>
                )}
              </div>
              <button
                className="shrink-0 invisible group-hover:visible p-0.5 rounded hover:text-destructive"
                onClick={() => deleteMutation.mutate(rel.id)}
              >
                <Unlink className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
export function ProjectFolderTree({ projectId, allFiles, selectedFileId, onSelectFile }: Props) {
  const { toast } = useToast();

  const [draggedFileId, setDraggedFileId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingUnder, setCreatingUnder] = useState<string | null | 'root'>('root');
  const [showNewForm, setShowNewForm] = useState(false);

  const { data: folders = [], isLoading: foldersLoading } = useQuery<DocFolder[]>({
    queryKey: ['/api/mbt/projects', projectId, 'folders'],
    queryFn: () => apiRequest('GET', `/api/mbt/projects/${projectId}/folders`).then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId: string | null }) =>
      apiRequest('POST', `/api/mbt/projects/${projectId}/folders`, { name, parentId }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'folders'] });
      setNewFolderName('');
      setShowNewForm(false);
      toast({ title: 'Папка создана' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiRequest('PATCH', `/api/mbt/folders/${id}`, { name }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'folders'] }),
  });

  const colorMutation = useMutation({
    mutationFn: ({ id, color }: { id: string; color: string }) =>
      apiRequest('PATCH', `/api/mbt/folders/${id}`, { color }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'folders'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/mbt/folders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'folders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'documents'] });
      toast({ title: 'Папка удалена' });
    },
  });

  const assignMutation = useMutation({
    mutationFn: ({ fileId, folderId }: { fileId: string; folderId: string | null }) =>
      apiRequest('PATCH', `/api/mbt/files/${fileId}/folder`, { folderId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'documents'] });
      const allFilesKey = ['/api/mbt/projects', projectId, 'documents'];
      queryClient.invalidateQueries({ queryKey: allFilesKey });
    },
  });

  // Build filesInFolder map
  const filesInFolder: Record<string, MbtDocFile[]> = {};
  const rootFiles: MbtDocFile[] = [];

  for (const f of allFiles) {
    if (f.folderId) {
      if (!filesInFolder[f.folderId]) filesInFolder[f.folderId] = [];
      filesInFolder[f.folderId].push(f);
    } else {
      rootFiles.push(f);
    }
  }

  const rootFolders = folders.filter(f => !f.parentId);

  function handleDropInFolder(folderId: string | null) {
    if (!draggedFileId) return;
    assignMutation.mutate({ fileId: draggedFileId, folderId });
    setDraggedFileId(null);
    setDragOverFolderId(null);
  }

  function handleCreateFolder(parentId: string | null) {
    if (!newFolderName.trim()) return;
    createMutation.mutate({ name: newFolderName, parentId });
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b shrink-0">
        <span className="text-xs font-medium text-muted-foreground">Дерево папок</span>
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => { setShowNewForm(s => !s); setCreatingUnder(null); }}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Создать папку в корне</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* New folder form */}
      {showNewForm && (
        <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30">
          <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <Input
            className="h-6 text-xs flex-1"
            placeholder="Название папки..."
            value={newFolderName}
            autoFocus
            onChange={e => setNewFolderName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleCreateFolder(creatingUnder === 'root' ? null : creatingUnder);
              if (e.key === 'Escape') { setShowNewForm(false); setNewFolderName(''); }
            }}
          />
          <button
            className="shrink-0 text-primary hover:text-primary/80"
            onClick={() => handleCreateFolder(creatingUnder === 'root' ? null : creatingUnder)}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button className="shrink-0 text-muted-foreground" onClick={() => { setShowNewForm(false); setNewFolderName(''); }}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0 px-1">
        {foldersLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="py-1 space-y-0.5">
            {/* Folder tree */}
            {rootFolders.map(folder => (
              <FolderNode
                key={folder.id}
                folder={folder}
                allFolders={folders}
                filesInFolder={filesInFolder}
                depth={0}
                selectedFileId={selectedFileId}
                draggedFileId={draggedFileId}
                dragOverFolderId={dragOverFolderId}
                onSelectFile={onSelectFile}
                onDragStartFile={setDraggedFileId}
                onDragEndFile={() => { setDraggedFileId(null); setDragOverFolderId(null); }}
                onDropInFolder={handleDropInFolder}
                onDragOverFolder={setDragOverFolderId}
                onCreateChild={(parentId) => {
                  setCreatingUnder(parentId);
                  setShowNewForm(true);
                }}
                onRename={(id, name) => renameMutation.mutate({ id, name })}
                onDelete={(id) => setDeleteConfirmId(id)}
                onChangeColor={(id, color) => colorMutation.mutate({ id, color })}
              />
            ))}

            {/* Divider */}
            {rootFolders.length > 0 && rootFiles.length > 0 && (
              <div className="border-t my-1.5 mx-1" />
            )}

            {/* Root-level (unfoldered) files */}
            {rootFiles.length > 0 && (
              <div>
                <div
                  className={`flex items-center gap-1.5 py-1 px-1 rounded text-xs text-muted-foreground
                    ${dragOverFolderId === '__root__' && draggedFileId ? 'bg-primary/10 ring-1 ring-primary' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverFolderId('__root__'); }}
                  onDrop={(e) => { e.preventDefault(); handleDropInFolder(null); }}
                >
                  <File className="h-3.5 w-3.5" />
                  <span>Без папки ({rootFiles.length})</span>
                </div>
                {rootFiles.map(f => (
                  <FolderFileRow
                    key={f.id}
                    file={f}
                    selected={selectedFileId === f.id}
                    dragOver={false}
                    onSelect={() => onSelectFile(f.id)}
                    onDragStart={() => setDraggedFileId(f.id)}
                    onDragEnd={() => { setDraggedFileId(null); setDragOverFolderId(null); }}
                    onDragOver={() => {}}
                  />
                ))}
              </div>
            )}

            {rootFolders.length === 0 && rootFiles.length === 0 && (
              <div className="text-center py-8 text-sm text-muted-foreground">
                <Folder className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>Нет папок</p>
                <p className="text-xs mt-1">Нажмите «+» чтобы создать папку</p>
              </div>
            )}
          </div>
        )}

        {/* Relations panel for selected file */}
        {selectedFileId && (
          <RelationsPanel
            fileId={selectedFileId}
            allFiles={allFiles}
            projectId={projectId}
          />
        )}
      </ScrollArea>

      {/* Delete confirm dialog */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(o) => !o && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить папку?</AlertDialogTitle>
            <AlertDialogDescription>
              Файлы внутри папки переместятся в корень. Подпапки станут корневыми. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteConfirmId) deleteMutation.mutate(deleteConfirmId); setDeleteConfirmId(null); }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
