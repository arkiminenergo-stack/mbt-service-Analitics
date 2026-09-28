import { useState, useRef, useEffect, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import {
  Bot, Send, Loader2, CheckCircle2, XCircle, FolderPlus,
  ListChecks, Layers, Play, Sparkles, User, RotateCcw,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  actionsPerformed?: ActionResult[];
  isLoading?: boolean;
}

interface ActionResult {
  action: { type: string; name?: string };
  status: 'ok' | 'error';
  label: string;
  detail?: string;
}

interface SessionState {
  createdTemplateId: string | null;
}

interface PersistedState {
  messages: ChatMessage[];
  sessionState: SessionState;
  isDone: boolean;
  savedAt: number;
}

// ──────────────────────────────────────────────────────────────────────────────
// localStorage persistence helpers
// ──────────────────────────────────────────────────────────────────────────────

function storageKey(projectId: string) {
  return `mbt_assistant_${projectId}`;
}

function loadSession(projectId: string): PersistedState | null {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedState;
  } catch {
    return null;
  }
}

function saveSession(projectId: string, state: PersistedState) {
  try {
    localStorage.setItem(storageKey(projectId), JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

function clearSession(projectId: string) {
  try {
    localStorage.removeItem(storageKey(projectId));
  } catch { /* ignore */ }
}

// ──────────────────────────────────────────────────────────────────────────────
// Action card
// ──────────────────────────────────────────────────────────────────────────────

const ACTION_ICONS: Record<string, React.ReactNode> = {
  create_section: <Layers className="h-3.5 w-3.5" />,
  create_template: <ListChecks className="h-3.5 w-3.5" />,
  create_folder: <FolderPlus className="h-3.5 w-3.5" />,
  run_check: <Play className="h-3.5 w-3.5" />,
};

function ActionCard({ result }: { result: ActionResult }) {
  const isOk = result.status === 'ok';
  const icon = isOk
    ? (ACTION_ICONS[result.action.type] ?? <CheckCircle2 className="h-3.5 w-3.5" />)
    : <XCircle className="h-3.5 w-3.5" />;
  return (
    <div className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs mt-1.5
      ${isOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-medium leading-snug">{result.label}</p>
        {result.detail && <p className="text-[11px] opacity-75 mt-0.5 leading-snug">{result.detail}</p>}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Message bubble
// ──────────────────────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-none flex items-start justify-center h-7 w-7 rounded-full text-xs font-bold shrink-0 mt-0.5
        ${isUser ? 'bg-primary text-primary-foreground' : 'bg-indigo-100 text-indigo-700 border border-indigo-200'}`}>
        {isUser
          ? <User className="h-3.5 w-3.5 mt-1.5" />
          : <Bot className="h-3.5 w-3.5 mt-1.5" />}
      </div>
      <div className={`flex-1 max-w-[85%] flex flex-col gap-0 ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap
          ${isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
          }`}>
          {msg.isLoading
            ? <span className="flex items-center gap-1.5 text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Думаю…
              </span>
            : msg.content}
        </div>
        {msg.actionsPerformed && msg.actionsPerformed.length > 0 && (
          <div className="w-full mt-1 space-y-1">
            {msg.actionsPerformed.map((r, i) => <ActionCard key={i} result={r} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Initial greeting (NOT sent to LLM — it's in the system prompt)
// ──────────────────────────────────────────────────────────────────────────────

const INITIAL_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: 'Привет! Я помогу настроить этот проект КПД.\n\nСначала уточните: какой тип документов проверяем?\n\n• Субсидия на капитальное строительство\n• Текущая субсидия (некапитальные расходы)\n• Дотация (выравнивание бюджетной обеспеченности)\n• Иной вид трансферта или документов',
};

const EMPTY_SESSION: PersistedState = {
  messages: [INITIAL_MESSAGE],
  sessionState: { createdTemplateId: null },
  isDone: false,
  savedAt: 0,
};

// ──────────────────────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────────────────────

interface Props {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectAssistantDialog({ projectId, open, onOpenChange }: Props) {
  const queryClient = useQueryClient();

  // Load persisted state once on mount / projectId change
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    const saved = loadSession(projectId);
    return saved ? saved.messages.filter(m => !m.isLoading) : [INITIAL_MESSAGE];
  });
  const [isDone, setIsDone] = useState<boolean>(() => {
    const saved = loadSession(projectId);
    return saved?.isDone ?? false;
  });
  const [input, setInput] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Ref-based mirror — always fresh in async closures
  const messagesRef = useRef<ChatMessage[]>(messages);
  // Ref-based session state
  const sessionStateRef = useRef<SessionState>(() => {
    const saved = loadSession(projectId);
    return saved?.sessionState ?? { createdTemplateId: null };
  });

  // Sync messagesRef on every render
  messagesRef.current = messages;

  // When projectId changes, reload saved session
  useEffect(() => {
    const saved = loadSession(projectId);
    const msgs = saved ? saved.messages.filter(m => !m.isLoading) : [INITIAL_MESSAGE];
    setMessages(msgs);
    messagesRef.current = msgs;
    sessionStateRef.current = saved?.sessionState ?? { createdTemplateId: null };
    setIsDone(saved?.isDone ?? false);
  }, [projectId]);

  // Scroll to bottom when dialog opens or messages change
  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persist after messages/sessionState/isDone change (skip loading placeholders)
  const persistSession = useCallback((
    msgs: ChatMessage[],
    sessionState: SessionState,
    done: boolean,
  ) => {
    const cleanMessages = msgs.filter(m => !m.isLoading);
    saveSession(projectId, {
      messages: cleanMessages,
      sessionState,
      isDone: done,
      savedAt: Date.now(),
    });
  }, [projectId]);

  // Reset conversation
  const handleNewConversation = useCallback(() => {
    clearSession(projectId);
    const initial = [INITIAL_MESSAGE];
    setMessages(initial);
    messagesRef.current = initial;
    sessionStateRef.current = { createdTemplateId: null };
    setIsDone(false);
    setInput('');
  }, [projectId]);

  const sendMutation = useMutation({
    mutationFn: async (userText: string) => {
      const currentMessages = messagesRef.current;
      const llmHistory = currentMessages
        .filter(m => !m.isLoading)
        .slice(1) // skip injected greeting — it's part of the system prompt
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      llmHistory.push({ role: 'user', content: userText });

      const res = await apiRequest('POST', `/api/mbt/projects/${projectId}/assistant`, {
        messages: llmHistory,
        sessionState: sessionStateRef.current,
      });
      return res.json() as Promise<{
        reply: string;
        actionsPerformed: ActionResult[];
        done: boolean;
        sessionState?: SessionState;
      }>;
    },
    onSuccess: (data) => {
      if (data.sessionState) {
        sessionStateRef.current = data.sessionState;
      }

      setMessages(prev => {
        const without = prev.filter(m => !m.isLoading);
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: data.reply,
          actionsPerformed: data.actionsPerformed,
        };
        const updated = [...without, assistantMsg];
        // Persist immediately after update
        persistSession(updated, sessionStateRef.current, data.done ?? false);
        return updated;
      });

      if (data.done) setIsDone(true);

      if (data.actionsPerformed?.length > 0) {
        queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'sections'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'conclusion'] });
        queryClient.invalidateQueries({ queryKey: ['/api/mbt/projects', projectId, 'activity'] });
        queryClient.invalidateQueries({ queryKey: ['/api/checklist-templates'] });
      }
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setMessages(prev => {
        const updated = [
          ...prev.filter(m => !m.isLoading),
          { role: 'assistant' as const, content: `Произошла ошибка: ${message}. Попробуйте ещё раз.` },
        ];
        persistSession(updated, sessionStateRef.current, isDone);
        return updated;
      });
    },
  });

  // Core send function — accepts text directly, no reliance on state
  const dispatchMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;

    setInput('');

    setMessages(prev => {
      const updated = [
        ...prev,
        { role: 'user' as const, content: trimmed },
        { role: 'assistant' as const, content: '', isLoading: true },
      ];
      messagesRef.current = updated;
      return updated;
    });

    sendMutation.mutate(trimmed);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [sendMutation]);

  const handleSend = () => dispatchMessage(input);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickReplies = !isDone && messages.length === 1
    ? ['Субсидия на капитальное строительство', 'Текущая субсидия', 'Дотация', 'Иная МБТ']
    : [];

  const hasSavedHistory = messages.length > 1;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:w-[480px] p-0 flex flex-col gap-0">
        <SheetHeader className="px-4 py-3 border-b shrink-0 space-y-0">
          <SheetTitle className="flex items-center gap-2 text-base">
            <div className="flex items-center justify-center h-7 w-7 rounded-full bg-indigo-100 border border-indigo-200">
              <Sparkles className="h-4 w-4 text-indigo-600" />
            </div>
            Помощник по настройке
            <div className="ml-auto flex items-center gap-2">
              {isDone && (
                <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">
                  Готово
                </Badge>
              )}
              {hasSavedHistory && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleNewConversation}
                  disabled={sendMutation.isPending}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
                  title="Начать новый диалог"
                >
                  <RotateCcw className="h-3 w-3" />
                  Новый диалог
                </Button>
              )}
            </div>
          </SheetTitle>
        </SheetHeader>

        {/* Messages */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-4">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} />
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>

        {/* Quick replies */}
        {quickReplies.length > 0 && (
          <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0 border-t pt-2">
            {quickReplies.map(q => (
              <button
                key={q}
                onClick={() => dispatchMessage(q)}
                className="text-xs px-2.5 py-1 rounded-full border bg-card hover:bg-muted transition-colors text-left"
                disabled={sendMutation.isPending}
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        {!isDone ? (
          <div className="px-4 py-3 border-t shrink-0 flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Введите сообщение… (Enter — отправить)"
              className="min-h-[56px] max-h-32 resize-none text-sm"
              disabled={sendMutation.isPending}
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!input.trim() || sendMutation.isPending}
              className="h-9 w-9 shrink-0"
            >
              {sendMutation.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />}
            </Button>
          </div>
        ) : (
          <div className="px-4 py-3 border-t shrink-0 text-center">
            <p className="text-xs text-muted-foreground mb-2">
              Настройка завершена. Проверьте разделы и шаблон во вкладке «Проверка».
            </p>
            <div className="flex gap-2 justify-center">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Закрыть
              </Button>
              <Button variant="ghost" size="sm" onClick={handleNewConversation} className="gap-1 text-muted-foreground">
                <RotateCcw className="h-3 w-3" />
                Новый диалог
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
