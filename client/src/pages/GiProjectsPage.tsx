import { useState } from 'react';
import { Link } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Droplets, Plus, Trash2, ArrowRight, Loader2, Pencil } from 'lucide-react';

interface GiProject {
  id: string;
  userId: string;
  name: string;
  address: string | null;
  year: number | null;
  status: string;
  renameTemplate: string | null;
  createdAt: string;
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'archived') {
    return <Badge variant="secondary">Архив</Badge>;
  }
  return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Активный</Badge>;
}

export default function GiProjectsPage() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [editProject, setEditProject] = useState<GiProject | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', address: '', year: '', renameTemplate: '{act_date}_{heat_source}' });

  const { data: projects = [], isLoading } = useQuery<GiProject[]>({
    queryKey: ['/api/gi/projects'],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest('POST', '/api/gi/projects', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/gi/projects'] });
      setShowCreate(false);
      resetForm();
      toast({ title: 'Проект создан' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => apiRequest('PATCH', `/api/gi/projects/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/gi/projects'] });
      setEditProject(null);
      resetForm();
      toast({ title: 'Проект обновлён' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest('DELETE', `/api/gi/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/gi/projects'] });
      setDeleteId(null);
      toast({ title: 'Проект удалён' });
    },
    onError: (e: any) => toast({ title: 'Ошибка', description: e.message, variant: 'destructive' }),
  });

  function resetForm() {
    setForm({ name: '', address: '', year: '', renameTemplate: '{act_date}_{heat_source}' });
  }

  function openEdit(p: GiProject) {
    setEditProject(p);
    setForm({ name: p.name, address: p.address || '', year: String(p.year || ''), renameTemplate: p.renameTemplate || '{act_date}_{heat_source}' });
  }

  function handleSubmit(isEdit: boolean) {
    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      year: form.year ? parseInt(form.year) : null,
      renameTemplate: form.renameTemplate || null,
    };
    if (!payload.name) return toast({ title: 'Введите название', variant: 'destructive' });
    if (isEdit && editProject) {
      updateMutation.mutate({ id: editProject.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card px-6 py-4">
        <div className="flex items-center justify-between max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <Droplets className="h-6 w-6 text-blue-500" />
            <div>
              <h1 className="text-xl font-semibold">Акты гидроиспытаний</h1>
              <p className="text-sm text-muted-foreground">Массовая обработка актов ГИ</p>
            </div>
          </div>
          <Button onClick={() => { resetForm(); setShowCreate(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Новый проект
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-24 text-muted-foreground">
            <Droplets className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium">Нет проектов</p>
            <p className="text-sm mt-1">Создайте первый проект для обработки актов ГИ</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Название</TableHead>
                <TableHead>Адрес / Объект</TableHead>
                <TableHead>Год</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead>Создан</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium">
                    <Link href={`/gi/${p.id}`}>
                      <a className="hover:underline text-primary">{p.name}</a>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.address || '—'}</TableCell>
                  <TableCell>{p.year || '—'}</TableCell>
                  <TableCell><StatusBadge status={p.status} /></TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(p.createdAt).toLocaleDateString('ru-RU')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => setDeleteId(p.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Link href={`/gi/${p.id}`}>
                        <Button variant="outline" size="sm">
                          Открыть <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </main>

      {/* Create / Edit dialog */}
      <Dialog open={showCreate || !!editProject} onOpenChange={v => { if (!v) { setShowCreate(false); setEditProject(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editProject ? 'Редактировать проект' : 'Новый проект ГИ'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Название *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Котельная №12, ТК-3..." />
            </div>
            <div>
              <Label>Адрес / Объект</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="ул. Ленина, 10" />
            </div>
            <div>
              <Label>Год</Label>
              <Input type="number" value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} placeholder="2024" />
            </div>
            <div>
              <Label>Шаблон переименования</Label>
              <Input value={form.renameTemplate} onChange={e => setForm(f => ({ ...f, renameTemplate: e.target.value }))} placeholder="{act_date}_{heat_source}" />
              <p className="text-xs text-muted-foreground mt-1">Переменные: {'{act_date}'}, {'{heat_source}'}, {'{act_number}'}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowCreate(false); setEditProject(null); }}>Отмена</Button>
            <Button disabled={isPending} onClick={() => handleSubmit(!!editProject)}>
              {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {editProject ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={v => { if (!v) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить проект?</AlertDialogTitle>
            <AlertDialogDescription>Все файлы и данные проекта будут удалены. Это действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} className="bg-destructive text-destructive-foreground">
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
