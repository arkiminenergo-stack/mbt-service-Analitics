import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  CheckCircle2, XCircle, FileCheck, FileX, Upload, ShieldCheck,
  ShieldOff, Pencil, RefreshCw, Loader2, ClipboardList,
} from 'lucide-react';
import { MBT_ACTIVITY_ACTION_LABELS, type MbtActivityAction } from '@shared/schema';

interface ActivityEntry {
  id: string;
  projectId: string;
  userId: string | null;
  action: MbtActivityAction;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  meta: Record<string, any> | null;
  createdAt: string;
  userEmail: string | null;
}

const ACTION_ICON: Record<MbtActivityAction, React.ReactNode> = {
  check_run: <ClipboardList className="h-4 w-4 text-blue-500" />,
  conclusion_signed: <ShieldCheck className="h-4 w-4 text-green-600" />,
  conclusion_unsigned: <ShieldOff className="h-4 w-4 text-amber-500" />,
  file_approved: <FileCheck className="h-4 w-4 text-green-600" />,
  file_rejected: <FileX className="h-4 w-4 text-red-500" />,
  document_uploaded: <Upload className="h-4 w-4 text-indigo-500" />,
  override_set: <Pencil className="h-4 w-4 text-purple-500" />,
  reviewer_note_updated: <Pencil className="h-4 w-4 text-amber-500" />,
};

const ACTION_COLOR: Record<MbtActivityAction, string> = {
  check_run: 'bg-blue-50 border-blue-200',
  conclusion_signed: 'bg-green-50 border-green-200',
  conclusion_unsigned: 'bg-amber-50 border-amber-200',
  file_approved: 'bg-green-50 border-green-200',
  file_rejected: 'bg-red-50 border-red-200',
  document_uploaded: 'bg-indigo-50 border-indigo-200',
  override_set: 'bg-purple-50 border-purple-200',
  reviewer_note_updated: 'bg-amber-50 border-amber-200',
};

function formatRelative(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'только что';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} мин. назад`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} ч. назад`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) return `${diffDay} д. назад`;
  return date.toLocaleDateString('ru-RU');
}

function formatAbsolute(dateStr: string): string {
  return new Date(dateStr).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function userInitial(email: string | null): string {
  if (!email) return '?';
  return email[0].toUpperCase();
}

function userShort(email: string | null): string {
  if (!email) return 'Система';
  const local = email.split('@')[0];
  return local.length > 16 ? local.slice(0, 14) + '…' : local;
}

function metaSummary(action: MbtActivityAction, meta: Record<string, any> | null): string | null {
  if (!meta) return null;
  if (action === 'check_run') {
    const score = meta.completenessScore ?? null;
    const crit = meta.criticalIssues ?? 0;
    return score !== null
      ? `Комплектность: ${score}%, критических: ${crit}`
      : null;
  }
  if (action === 'override_set' && meta.finalStatus) {
    const labels: Record<string, string> = { approved: 'Одобрено', revision: 'Требует доработки', rejected: 'Отказано', pending: 'На рассмотрении' };
    return `Статус: ${labels[meta.finalStatus] ?? meta.finalStatus}`;
  }
  if (action === 'document_uploaded' && meta.fileSize) {
    const mb = (meta.fileSize / 1024 / 1024).toFixed(2);
    return `Размер: ${mb} МБ`;
  }
  return null;
}

const ALL_ACTIONS = 'all';

interface Props {
  projectId: string;
}

export function ActivityLogPanel({ projectId }: Props) {
  const [filterAction, setFilterAction] = useState<string>(ALL_ACTIONS);

  const { data: entries = [], isLoading, refetch, isFetching } = useQuery<ActivityEntry[]>({
    queryKey: ['/api/mbt/projects', projectId, 'activity'],
    queryFn: async () => {
      const res = await fetch(`/api/mbt/projects/${projectId}/activity?limit=200`, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch activity');
      return res.json();
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const filtered = filterAction === ALL_ACTIONS
    ? entries
    : entries.filter(e => e.action === filterAction);

  const uniqueActions = [...new Set(entries.map(e => e.action))];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b shrink-0">
        <h2 className="text-sm font-semibold">Журнал активности</h2>
        <div className="flex items-center gap-2">
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="h-7 text-xs w-44">
              <SelectValue placeholder="Все события" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_ACTIONS}>Все события</SelectItem>
              {uniqueActions.map(a => (
                <SelectItem key={a} value={a}>{MBT_ACTIVITY_ACTION_LABELS[a]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => refetch()} disabled={isFetching}>
                {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Обновить</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <ClipboardList className="h-10 w-10 opacity-30" />
          <p className="text-sm">{filterAction === ALL_ACTIONS ? 'Событий пока нет' : 'Нет событий этого типа'}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-2">
            {filtered.map((entry, idx) => {
              const summary = metaSummary(entry.action, entry.meta);
              const colorClass = ACTION_COLOR[entry.action] ?? 'bg-muted border-border';
              const icon = ACTION_ICON[entry.action] ?? <CheckCircle2 className="h-4 w-4" />;

              return (
                <div
                  key={entry.id}
                  className={`relative flex gap-3 rounded-lg border px-3 py-2.5 text-sm ${colorClass}`}
                >
                  <div className="flex-none mt-0.5">{icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium leading-snug">
                        {MBT_ACTIVITY_ACTION_LABELS[entry.action]}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0 cursor-default">
                            {formatRelative(entry.createdAt)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">{formatAbsolute(entry.createdAt)}</TooltipContent>
                      </Tooltip>
                    </div>

                    {entry.entityLabel && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={entry.entityLabel}>
                        {entry.entityLabel}
                      </p>
                    )}

                    {summary && (
                      <p className="text-xs text-muted-foreground mt-0.5">{summary}</p>
                    )}

                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-[9px] font-bold text-muted-foreground border">
                        {userInitial(entry.userEmail)}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{userShort(entry.userEmail)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}

      <div className="px-4 py-2 border-t text-xs text-muted-foreground shrink-0">
        {filtered.length} {filtered.length === 1 ? 'событие' : filtered.length < 5 ? 'события' : 'событий'}
        {filterAction !== ALL_ACTIONS && ` · фильтр: ${MBT_ACTIVITY_ACTION_LABELS[filterAction as MbtActivityAction]}`}
      </div>
    </div>
  );
}
