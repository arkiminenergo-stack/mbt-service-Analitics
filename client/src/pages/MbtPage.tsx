import { useState, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Banknote, Plus, ArrowLeft, Loader2, Trash2, Search, Pencil, Settings, BarChart3, Droplets } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  MBT_FINANCING_LABELS,
  MBT_ACTIVITIES_LABELS,
  MBT_STATUS_LABELS,
  MBT_FINANCING_METHODS,
  MBT_ACTIVITIES,
  MBT_STATUSES,
} from '@shared/schema';
import { MbtAnalyticsTab } from '@/components/MbtAnalyticsTab';

interface MbtProject {
  id: string;
  userId: string;
  name: string;
  district: string | null;
  year: number | null;
  amountMln: string | null;
  financingMethod: string | null;
  activities: string | null;
  status: string | null;
  section: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  verified: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  sent_to_mef: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  not_agreed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

interface LlmConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  aiProvider: string;
  openaiApiUrl: string;
  openaiModel: string;
  openaiApiKey: string;
  enableChunking: boolean;
  maxContextTokens: number;
}

export default function MbtPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<MbtProject | null>(null);
  const [llmSettingsOpen, setLlmSettingsOpen] = useState(false);
  const [llmForm, setLlmForm] = useState<LlmConfig>({
    aiProvider: 'ollama',
    apiUrl: '', apiKey: '', model: 'qwen2.5:7b',
    openaiApiUrl: 'https://api.openai.com/v1',
    openaiModel: 'gpt-4o',
    openaiApiKey: '',
    enableChunking: true,
    maxContextTokens: 28000,
  });

  const [formName, setFormName] = useState('');
  const [formDistrict, setFormDistrict] = useState('');
  const [formYear, setFormYear] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formFinancing, setFormFinancing] = useState('');
  const [formActivities, setFormActivities] = useState('');
  const [formStatus, setFormStatus] = useState('');
  const [formSection, setFormSection] = useState('');

  const { data: projects = [], isLoading } = useQuery<MbtProject[]>({
    queryKey: ['/api/mbt/projects'],
  });

  const { data: llmConfig } = useQuery<LlmConfig>({
    queryKey: ['/api/ollama/config'],
  });

  useEffect(() => {
    if (llmConfig) {
      setLlmForm({ ...llmConfig });
    }
  }, [llmConfig]);

  const saveLlmMutation = useMutation({
    mutationFn: async (data: LlmConfig) => {
      const res = await apiRequest('POST', '/api/ollama/config', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/ollama/config'] });
      setLlmSettingsOpen(false);
      toast({ title: 'Настройки AI сохранены' });
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest('POST', '/api/mbt/projects', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects'] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: 'Проект создан' });
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest('PATCH', `/api/mbt/projects/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects'] });
      setEditDialogOpen(false);
      setSelectedProject(null);
      resetForm();
      toast({ title: 'Проект обновлён' });
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/mbt/projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects'] });
      setDeleteDialogOpen(false);
      setSelectedProject(null);
      toast({ title: 'Проект удалён' });
    },
    onError: (err: any) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  function resetForm() {
    setFormName('');
    setFormDistrict('');
    setFormYear('');
    setFormAmount('');
    setFormFinancing('');
    setFormActivities('');
    setFormStatus('');
    setFormSection('');
  }

  function openEditDialog(project: MbtProject) {
    setSelectedProject(project);
    setFormName(project.name);
    setFormDistrict(project.district || '');
    setFormYear(project.year?.toString() || '');
    setFormAmount(project.amountMln || '');
    setFormFinancing(project.financingMethod || '');
    setFormActivities(project.activities || '');
    setFormStatus(project.status || '');
    setFormSection(project.section || '');
    setEditDialogOpen(true);
  }

  function getFormData() {
    return {
      name: formName,
      district: formDistrict || undefined,
      year: formYear ? parseInt(formYear) : undefined,
      amountMln: formAmount || undefined,
      financingMethod: formFinancing || undefined,
      activities: formActivities || undefined,
      status: formStatus || undefined,
      section: formSection || undefined,
    };
  }

  const filteredProjects = projects.filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.district && p.district.toLowerCase().includes(q)) ||
      (p.section && p.section.toLowerCase().includes(q)) ||
      (p.year && p.year.toString().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold" data-testid="text-page-title">КПД</h1>
          </div>
          <Badge variant="secondary" data-testid="badge-module">Комплексная проверка документов</Badge>
          <div className="ml-auto flex items-center gap-1">
            <Link href="/gi">
              <Button variant="ghost" size="sm" title="Акты гидроиспытаний" data-testid="button-gi-module">
                <Droplets className="h-4 w-4 mr-1.5 text-blue-500" />
                Акты ГИ
              </Button>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              title="Настройки AI-провайдера"
              onClick={() => setLlmSettingsOpen(true)}
              data-testid="button-llm-settings"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        <Tabs defaultValue="projects">
          <TabsList className="h-9 mb-4">
            <TabsTrigger value="projects" className="text-sm">
              <Banknote className="h-3.5 w-3.5 mr-1.5" />
              Проекты
            </TabsTrigger>
            <TabsTrigger value="analytics" className="text-sm">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Аналитика
            </TabsTrigger>
          </TabsList>

          <TabsContent value="projects" className="space-y-4">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск проектов..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                  data-testid="input-search"
                />
              </div>
              <Button
                onClick={() => { resetForm(); setCreateDialogOpen(true); }}
                data-testid="button-create-project"
              >
                <Plus className="h-4 w-4 mr-2" />
                Создать проект
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {searchQuery ? 'Ничего не найдено' : 'Нет проектов. Создайте первый проект.'}
              </div>
            ) : (
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Название</TableHead>
                      <TableHead className="min-w-[150px]">Городской округ</TableHead>
                      <TableHead className="min-w-[80px]">Год</TableHead>
                      <TableHead className="min-w-[120px]">Сумма, млн. руб.</TableHead>
                      <TableHead className="min-w-[140px]">Способ финансирования</TableHead>
                      <TableHead className="min-w-[130px]">Мероприятия</TableHead>
                      <TableHead className="min-w-[150px]">Статус</TableHead>
                      <TableHead className="min-w-[120px]">Раздел</TableHead>
                      <TableHead className="w-[80px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredProjects.map((project) => (
                      <TableRow
                        key={project.id}
                        className="cursor-pointer hover-elevate"
                        onClick={() => setLocation(`/mbt/${project.id}`)}
                        data-testid={`row-project-${project.id}`}
                      >
                        <TableCell className="font-medium" data-testid={`text-name-${project.id}`}>
                          {project.name}
                        </TableCell>
                        <TableCell data-testid={`text-district-${project.id}`}>
                          {project.district || '—'}
                        </TableCell>
                        <TableCell data-testid={`text-year-${project.id}`}>
                          {project.year || '—'}
                        </TableCell>
                        <TableCell data-testid={`text-amount-${project.id}`}>
                          {project.amountMln || '—'}
                        </TableCell>
                        <TableCell data-testid={`text-financing-${project.id}`}>
                          {project.financingMethod ? MBT_FINANCING_LABELS[project.financingMethod] : '—'}
                        </TableCell>
                        <TableCell data-testid={`text-activities-${project.id}`}>
                          {project.activities ? MBT_ACTIVITIES_LABELS[project.activities] : '—'}
                        </TableCell>
                        <TableCell data-testid={`text-status-${project.id}`}>
                          {project.status ? (
                            <Badge
                              variant="secondary"
                              className={STATUS_COLORS[project.status] || ''}
                            >
                              {MBT_STATUS_LABELS[project.status]}
                            </Badge>
                          ) : '—'}
                        </TableCell>
                        <TableCell data-testid={`text-section-${project.id}`}>
                          {project.section || '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); openEditDialog(project); }}
                              data-testid={`button-edit-${project.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) => { e.stopPropagation(); setSelectedProject(project); setDeleteDialogOpen(true); }}
                              data-testid={`button-delete-${project.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="analytics">
            <MbtAnalyticsTab />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Создать проект</DialogTitle>
            <DialogDescription>Заполните данные нового проекта КПД</DialogDescription>
          </DialogHeader>
          <ProjectForm
            name={formName} setName={setFormName}
            district={formDistrict} setDistrict={setFormDistrict}
            year={formYear} setYear={setFormYear}
            amount={formAmount} setAmount={setFormAmount}
            financing={formFinancing} setFinancing={setFormFinancing}
            activities={formActivities} setActivities={setFormActivities}
            status={formStatus} setStatus={setFormStatus}
            section={formSection} setSection={setFormSection}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} data-testid="button-cancel-create">
              Отмена
            </Button>
            <Button
              onClick={() => createMutation.mutate(getFormData())}
              disabled={!formName.trim() || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Редактировать проект</DialogTitle>
            <DialogDescription>Измените данные проекта КПД</DialogDescription>
          </DialogHeader>
          <ProjectForm
            name={formName} setName={setFormName}
            district={formDistrict} setDistrict={setFormDistrict}
            year={formYear} setYear={setFormYear}
            amount={formAmount} setAmount={setFormAmount}
            financing={formFinancing} setFinancing={setFormFinancing}
            activities={formActivities} setActivities={setFormActivities}
            status={formStatus} setStatus={setFormStatus}
            section={formSection} setSection={setFormSection}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} data-testid="button-cancel-edit">
              Отмена
            </Button>
            <Button
              onClick={() => selectedProject && updateMutation.mutate({ id: selectedProject.id, data: getFormData() })}
              disabled={!formName.trim() || updateMutation.isPending}
              data-testid="button-submit-edit"
            >
              {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить проект?</AlertDialogTitle>
            <AlertDialogDescription>
              Проект «{selectedProject?.name}» будет удалён без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => selectedProject && deleteMutation.mutate(selectedProject.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* LLM Settings Dialog */}
      <Dialog open={llmSettingsOpen} onOpenChange={setLlmSettingsOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Настройки AI-провайдера</DialogTitle>
            <DialogDescription>
              Выберите AI-провайдер и укажите параметры подключения для работы функции анализа документов.
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={llmForm.aiProvider}
            onValueChange={(v) => setLlmForm(f => ({ ...f, aiProvider: v }))}
          >
            <TabsList className="w-full">
              <TabsTrigger value="ollama" className="flex-1">Ollama / OpenAI-совместимый</TabsTrigger>
              <TabsTrigger value="openai" className="flex-1">OpenAI</TabsTrigger>
            </TabsList>

            <TabsContent value="ollama" className="space-y-3 mt-4">
              <div className="space-y-1.5">
                <Label htmlFor="ollama-url">URL API сервера</Label>
                <Input
                  id="ollama-url"
                  placeholder="http://localhost:11434"
                  value={llmForm.apiUrl}
                  onChange={(e) => setLlmForm(f => ({ ...f, apiUrl: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">Адрес Ollama или любого OpenAI-совместимого сервера</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ollama-key">API Key (если требуется)</Label>
                <Input
                  id="ollama-key"
                  type="password"
                  placeholder="Необязательно"
                  value={llmForm.apiKey}
                  onChange={(e) => setLlmForm(f => ({ ...f, apiKey: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ollama-model">Модель</Label>
                <Input
                  id="ollama-model"
                  placeholder="qwen2.5:7b"
                  value={llmForm.model}
                  onChange={(e) => setLlmForm(f => ({ ...f, model: e.target.value }))}
                />
              </div>
            </TabsContent>

            <TabsContent value="openai" className="space-y-3 mt-4">
              <div className="space-y-1.5">
                <Label htmlFor="oai-key">OpenAI API Key</Label>
                <Input
                  id="oai-key"
                  type="password"
                  placeholder="sk-..."
                  value={llmForm.openaiApiKey}
                  onChange={(e) => setLlmForm(f => ({ ...f, openaiApiKey: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="oai-model">Модель</Label>
                <Input
                  id="oai-model"
                  placeholder="gpt-4o"
                  value={llmForm.openaiModel}
                  onChange={(e) => setLlmForm(f => ({ ...f, openaiModel: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="oai-url">Base URL (если используете прокси)</Label>
                <Input
                  id="oai-url"
                  placeholder="https://api.openai.com/v1"
                  value={llmForm.openaiApiUrl}
                  onChange={(e) => setLlmForm(f => ({ ...f, openaiApiUrl: e.target.value }))}
                />
              </div>
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLlmSettingsOpen(false)}>Отмена</Button>
            <Button
              onClick={() => saveLlmMutation.mutate(llmForm)}
              disabled={saveLlmMutation.isPending}
            >
              {saveLlmMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProjectForm({
  name, setName,
  district, setDistrict,
  year, setYear,
  amount, setAmount,
  financing, setFinancing,
  activities, setActivities,
  status, setStatus,
  section, setSection,
}: {
  name: string; setName: (v: string) => void;
  district: string; setDistrict: (v: string) => void;
  year: string; setYear: (v: string) => void;
  amount: string; setAmount: (v: string) => void;
  financing: string; setFinancing: (v: string) => void;
  activities: string; setActivities: (v: string) => void;
  status: string; setStatus: (v: string) => void;
  section: string; setSection: (v: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Название *</Label>
        <Input id="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-name" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="district">Городской округ</Label>
          <Input id="district" value={district} onChange={(e) => setDistrict(e.target.value)} data-testid="input-district" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="year">Год</Label>
          <Input id="year" type="number" value={year} onChange={(e) => setYear(e.target.value)} data-testid="input-year" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="amount">Сумма, млн. руб.</Label>
          <Input id="amount" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-amount" />
        </div>
        <div className="space-y-2">
          <Label>Способ финансирования</Label>
          <Select value={financing} onValueChange={setFinancing}>
            <SelectTrigger data-testid="select-financing">
              <SelectValue placeholder="Выберите..." />
            </SelectTrigger>
            <SelectContent>
              {MBT_FINANCING_METHODS.map((m) => (
                <SelectItem key={m} value={m}>{MBT_FINANCING_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Мероприятия</Label>
          <Select value={activities} onValueChange={setActivities}>
            <SelectTrigger data-testid="select-activities">
              <SelectValue placeholder="Выберите..." />
            </SelectTrigger>
            <SelectContent>
              {MBT_ACTIVITIES.map((a) => (
                <SelectItem key={a} value={a}>{MBT_ACTIVITIES_LABELS[a]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Статус</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger data-testid="select-status">
              <SelectValue placeholder="Выберите..." />
            </SelectTrigger>
            <SelectContent>
              {MBT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{MBT_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="section">Раздел</Label>
        <Input id="section" value={section} onChange={(e) => setSection(e.target.value)} data-testid="input-section" />
      </div>
    </div>
  );
}
