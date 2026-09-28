import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  CheckCircle2, XCircle, AlertCircle, Info, Loader2,
  TrendingUp, FolderKanban, ClipboardCheck, UserCheck, BarChart3,
  ArrowRight, FileX, AlertTriangle,
} from 'lucide-react';

interface Analytics {
  totalProjects: number;
  totalConclusions: number;
  projectsChecked: number;
  avgCompleteness: number;
  verifiedCount: number;
  byStatus: Record<string, number>;
  projectStats: Array<{
    projectId: string;
    projectName: string;
    district: string | null;
    latestStatus: string | null;
    latestFinalStatus: string | null;
    completenessScore: number | null;
    criticalIssues: number | null;
    nonCriticalIssues: number | null;
    isReviewed: boolean;
    checkedAt: string | null;
  }>;
  missingItems: Array<{ itemName: string; missingCount: number }>;
  recentConclusions: Array<{
    projectId: string;
    projectName: string;
    status: string;
    finalStatus: string | null;
    completenessScore: number | null;
    isReviewed: boolean;
    createdAt: string;
  }>;
}

const STATUS_CFG = {
  approved: { label: 'Одобрено', color: '#16a34a', bg: 'bg-green-100 text-green-800 border-green-300', icon: CheckCircle2 },
  revision: { label: 'Доработка', color: '#d97706', bg: 'bg-amber-100 text-amber-800 border-amber-300', icon: AlertCircle },
  rejected: { label: 'Отказано', color: '#dc2626', bg: 'bg-red-100 text-red-800 border-red-300', icon: XCircle },
  pending: { label: 'На рассмотрении', color: '#2563eb', bg: 'bg-blue-100 text-blue-800 border-blue-300', icon: Info },
};

const PIE_COLORS = ['#16a34a', '#d97706', '#dc2626', '#2563eb'];

// Simple completeness gauge bar
function CompletenessBar({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs w-8 text-right tabular-nums font-medium">{score}%</span>
    </div>
  );
}

// Custom Recharts tooltip
function CustomBarTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border rounded-md shadow-md px-3 py-2 text-xs max-w-[200px]">
      <p className="font-medium mb-1 truncate">{label}</p>
      <p className="text-muted-foreground">Комплектность: <span className="font-semibold text-foreground">{payload[0].value}%</span></p>
    </div>
  );
}

export function MbtAnalyticsTab() {
  const { data, isLoading } = useQuery<Analytics>({
    queryKey: ['/api/mbt/analytics'],
    queryFn: () => apiRequest('GET', '/api/mbt/analytics').then(r => r.json()),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const pieData = Object.entries(data.byStatus).map(([key, value]) => ({
    name: STATUS_CFG[key as keyof typeof STATUS_CFG]?.label ?? key,
    value,
    color: STATUS_CFG[key as keyof typeof STATUS_CFG]?.color ?? '#94a3b8',
  }));

  const barData = data.projectStats
    .filter(p => p.completenessScore !== null)
    .sort((a, b) => (b.completenessScore ?? 0) - (a.completenessScore ?? 0))
    .map(p => ({
      name: p.projectName.length > 18 ? p.projectName.slice(0, 18) + '…' : p.projectName,
      fullName: p.projectName,
      score: p.completenessScore ?? 0,
      projectId: p.projectId,
    }));

  const needAttention = data.projectStats.filter(
    p => (p.criticalIssues !== null && p.criticalIssues > 0) || (p.completenessScore !== null && p.completenessScore < 60)
  );

  const unchecked = data.projectStats.filter(p => p.latestStatus === null);

  const coveragePercent = data.totalProjects > 0
    ? Math.round((data.projectsChecked / data.totalProjects) * 100)
    : 0;

  return (
    <div className="space-y-6 pb-6">
      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <FolderKanban className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Проектов</span>
            </div>
            <p className="text-3xl font-bold">{data.totalProjects}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.projectsChecked} проверено ({coveragePercent}%)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Ср. комплектность</span>
            </div>
            <p className={`text-3xl font-bold ${data.avgCompleteness >= 80 ? 'text-green-600' : data.avgCompleteness >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
              {data.avgCompleteness}%
            </p>
            <p className="text-xs text-muted-foreground mt-1">по проверенным проектам</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Прогонов проверки</span>
            </div>
            <p className="text-3xl font-bold">{data.totalConclusions}</p>
            <p className="text-xs text-muted-foreground mt-1">всего заключений</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 mb-2">
              <UserCheck className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Верифицировано</span>
            </div>
            <p className="text-3xl font-bold text-blue-600">{data.verifiedCount}</p>
            <p className="text-xs text-muted-foreground mt-1">
              из {data.projectsChecked} проверенных
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Status breakdown badges ── */}
      {Object.keys(data.byStatus).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.byStatus).map(([status, count]) => {
            const cfg = STATUS_CFG[status as keyof typeof STATUS_CFG];
            if (!cfg) return null;
            const Icon = cfg.icon;
            return (
              <Badge key={status} className={`${cfg.bg} gap-1.5 px-3 py-1 text-sm border`}>
                <Icon className="h-3.5 w-3.5" />
                {cfg.label}: {count}
              </Badge>
            );
          })}
          {unchecked.length > 0 && (
            <Badge variant="secondary" className="gap-1.5 px-3 py-1 text-sm">
              <FileX className="h-3.5 w-3.5" />
              Не проверено: {unchecked.length}
            </Badge>
          )}
        </div>
      )}

      {/* ── Charts row ── */}
      {(barData.length > 0 || pieData.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Bar chart */}
          {barData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" />
                  Комплектность по проектам
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <ResponsiveContainer width="100%" height={Math.max(180, barData.length * 28)}>
                  <BarChart
                    data={barData}
                    layout="vertical"
                    margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} tickFormatter={v => `${v}%`} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip content={<CustomBarTooltip />} />
                    <Bar dataKey="score" radius={[0, 3, 3, 0]}>
                      {barData.map((entry, idx) => (
                        <Cell
                          key={idx}
                          fill={entry.score >= 80 ? '#16a34a' : entry.score >= 50 ? '#d97706' : '#dc2626'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Pie chart */}
          {pieData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                  Распределение заключений
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 flex items-center justify-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any, name: any) => [value + ' проектов', name]} />
                    <Legend iconType="circle" iconSize={10} formatter={(v) => <span className="text-xs">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Attention needed ── */}
      {needAttention.length > 0 && (
        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Требуют внимания
              <Badge className="bg-amber-100 text-amber-800 border-amber-300 ml-1">{needAttention.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ScrollArea className="max-h-60">
              <div className="space-y-1">
                {needAttention.map(p => {
                  const effStatus = (p.latestFinalStatus ?? p.latestStatus ?? 'pending') as keyof typeof STATUS_CFG;
                  const cfg = STATUS_CFG[effStatus] ?? STATUS_CFG.pending;
                  return (
                    <Link key={p.projectId} href={`/mbt/${p.projectId}`}>
                      <div className="flex items-center gap-3 py-2 px-2 rounded-md hover:bg-muted/40 cursor-pointer transition-colors">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{p.projectName}</span>
                            {p.district && <span className="text-xs text-muted-foreground shrink-0">{p.district}</span>}
                          </div>
                          {p.completenessScore !== null && (
                            <div className="mt-1 max-w-[200px]">
                              <CompletenessBar score={p.completenessScore} />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {(p.criticalIssues ?? 0) > 0 && (
                            <Badge variant="destructive" className="text-xs">{p.criticalIssues} крит.</Badge>
                          )}
                          {(p.nonCriticalIssues ?? 0) > 0 && (
                            <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-xs">{p.nonCriticalIssues} некрит.</Badge>
                          )}
                          <Badge className={`${cfg.bg} text-xs border`}>{cfg.label}</Badge>
                          {!p.isReviewed && (
                            <Badge variant="outline" className="text-xs text-muted-foreground">не верифицировано</Badge>
                          )}
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ── Bottom row: missing items + recent activity ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Most commonly missing */}
        {data.missingItems.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileX className="h-4 w-4 text-muted-foreground" />
                Часто отсутствующие документы
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="space-y-2">
                {data.missingItems.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4 text-right shrink-0">{idx + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs truncate">{item.itemName}</span>
                        <span className="text-xs font-medium text-red-600 shrink-0">{item.missingCount}×</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full mt-1 overflow-hidden">
                        <div
                          className="h-full bg-red-400 rounded-full"
                          style={{ width: `${Math.min(100, (item.missingCount / data.projectsChecked) * 100)}%` }}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Recent checks */}
        {data.recentConclusions.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
                Последние проверки
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ScrollArea className="max-h-56">
                <div className="space-y-1">
                  {data.recentConclusions.map((c, idx) => {
                    const effStatus = (c.finalStatus ?? c.status) as keyof typeof STATUS_CFG;
                    const cfg = STATUS_CFG[effStatus] ?? STATUS_CFG.pending;
                    const Icon = cfg.icon;
                    return (
                      <Link key={idx} href={`/mbt/${c.projectId}`}>
                        <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/40 cursor-pointer transition-colors">
                          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: cfg.color }} />
                          <span className="text-xs flex-1 truncate">{c.projectName}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {new Date(c.createdAt).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
                          </span>
                          {c.completenessScore !== null && (
                            <span className="text-xs tabular-nums shrink-0 w-8 text-right">{c.completenessScore}%</span>
                          )}
                          {c.isReviewed && <UserCheck className="h-3 w-3 text-blue-600 shrink-0" />}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Empty state */}
      {data.projectsChecked === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <BarChart3 className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Нет данных для аналитики</p>
          <p className="text-xs mt-1">Запустите проверку хотя бы в одном проекте</p>
        </div>
      )}
    </div>
  );
}
