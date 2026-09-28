import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Banknote, RefreshCw, AlertCircle, TrendingUp, Hash, Download } from 'lucide-react';

interface PaymentOrder {
  type: string;
  number: string;
  date: string;
  amount: number;
  amount_formatted: string;
  purpose: string;
  page?: number | null;
}

interface ExtractionResult {
  payments: PaymentOrder[];
  total_count: number;
  total_amount: number;
  total_amount_formatted: string;
  error?: string;
}

interface Props {
  fileId: string;
  filename: string;
}

export function PaymentOrdersPanel({ fileId, filename }: Props) {
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [exporting, setExporting] = useState(false);

  async function downloadXlsx() {
    setExporting(true);
    try {
      const res = await fetch(`/api/mbt/files/${fileId}/extract-payments/xlsx`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Ошибка сервера');
      const blob = await res.blob();
      const disposition = res.headers.get('Content-Disposition') || '';
      const nameMatch = disposition.match(/filename\*?=(?:UTF-8'')?([^;\r\n]+)/i);
      const name = nameMatch
        ? decodeURIComponent(nameMatch[1].replace(/"/g, ''))
        : `Реестр_ПП_${fileId}.xlsx`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setExporting(false);
    }
  }

  const extractMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/mbt/files/${fileId}/extract-payments`, {});
      return res.json() as Promise<ExtractionResult>;
    },
    onSuccess: (data) => setResult(data),
  });

  // ── Not yet extracted ───────────────────────────────────────────────────────
  if (!result && !extractMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 py-16 text-center px-6">
        <div className="flex items-center justify-center h-14 w-14 rounded-full bg-blue-50 border border-blue-200">
          <Banknote className="h-7 w-7 text-blue-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">Извлечение платёжных документов</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Система найдёт и структурирует все платёжные поручения (ПП) и платёжные ордера (ПО): номер, дату, сумму и назначение.
          </p>
        </div>
        <Button onClick={() => extractMutation.mutate()} className="gap-2">
          <Banknote className="h-4 w-4" />
          Извлечь платёжные документы
        </Button>
      </div>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (extractMutation.isPending) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        <p className="text-sm text-muted-foreground">Анализируем документ…</p>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (extractMutation.isError || result?.error) {
    const msg = extractMutation.error instanceof Error
      ? extractMutation.error.message
      : result?.error ?? 'Неизвестная ошибка';
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 py-16 px-6 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-destructive">Ошибка извлечения</p>
        <p className="text-xs text-muted-foreground max-w-xs">{msg}</p>
        <Button variant="outline" size="sm" onClick={() => extractMutation.mutate()} className="gap-1">
          <RefreshCw className="h-3.5 w-3.5" />
          Повторить
        </Button>
      </div>
    );
  }

  if (!result) return null;

  const { payments, total_count, total_amount_formatted } = result;

  const ppCount = payments.filter(p => p.type === 'ПП').length;
  const poCount = payments.filter(p => p.type === 'ПО').length;
  const poAmount = payments
    .filter(p => p.type === 'ПО')
    .reduce((s, p) => s + p.amount, 0);

  function formatAmt(v: number) {
    const int = Math.floor(v);
    const frac = Math.round((v - int) * 100);
    const s = int.toLocaleString('ru-RU').replace(/,/g, ' ');
    return `${s},${String(frac).padStart(2, '0')}`;
  }

  // ── Results ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-4 flex-wrap shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-100 border border-blue-200">
            <Hash className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground leading-none">Всего документов</p>
            <p className="text-lg font-bold leading-tight text-foreground">
              {total_count}
              {ppCount > 0 && poCount > 0 && (
                <span className="text-xs font-normal text-muted-foreground ml-1.5">
                  ({ppCount} ПП, {poCount} ПО)
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center h-8 w-8 rounded-full bg-green-100 border border-green-200">
            <TrendingUp className="h-4 w-4 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground leading-none">Общая сумма</p>
            <p className="text-lg font-bold leading-tight text-foreground">
              {total_amount_formatted} <span className="text-sm font-normal text-muted-foreground">руб.</span>
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => extractMutation.mutate()}
            disabled={extractMutation.isPending}
            className="gap-1 text-xs h-7"
          >
            <RefreshCw className="h-3 w-3" />
            Обновить
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadXlsx}
            disabled={exporting}
            className="gap-1 text-xs h-7 border-green-300 text-green-700 hover:bg-green-50"
          >
            {exporting
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Download className="h-3 w-3" />}
            Excel
          </Button>
        </div>
      </div>

      {/* Table */}
      {payments.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 gap-2 py-12 text-center px-6">
          <AlertCircle className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Платёжные документы не найдены.</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Возможно, документ является сканом или имеет нестандартный формат.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background border-b z-10">
                <tr>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap w-12">
                    Стр.
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap w-12">
                    Тип
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap w-16">
                    №
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap w-28">
                    Дата
                  </th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap w-36">
                    Сумма, руб.
                  </th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Назначение платежа
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.map((pp, idx) => (
                  <tr
                    key={idx}
                    className="border-b last:border-0 hover:bg-muted/40 transition-colors"
                  >
                    <td className="px-3 py-2.5 text-center font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {pp.page ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Badge
                        variant="outline"
                        className={
                          pp.type === 'ПО'
                            ? 'text-xs px-1.5 py-0 border-orange-300 text-orange-700 bg-orange-50'
                            : 'text-xs px-1.5 py-0 border-blue-300 text-blue-700 bg-blue-50'
                        }
                      >
                        {pp.type}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-sm font-medium text-foreground whitespace-nowrap">
                      {pp.number}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-muted-foreground whitespace-nowrap">
                      {pp.date}
                    </td>
                    <td className="px-3 py-2.5 text-sm font-medium text-right tabular-nums whitespace-nowrap">
                      {pp.amount_formatted}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-muted-foreground leading-snug max-w-xs">
                      <span className="line-clamp-2" title={pp.purpose}>
                        {pp.purpose}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* Totals footer */}
              <tfoot>
                <tr className="border-t-2 bg-muted/20">
                  <td colSpan={4} className="px-3 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Итого: {total_count} докум.
                    {ppCount > 0 && poCount > 0 && (
                      <span className="ml-1 font-normal normal-case">({ppCount} ПП + {poCount} ПО)</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-bold text-right tabular-nums">
                    {total_amount_formatted}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
