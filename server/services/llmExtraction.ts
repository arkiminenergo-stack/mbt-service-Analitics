import { storage } from '../storage';
import { log } from '../logger';

/**
 * Конфигурация Ollama API
 */
export interface OllamaConfig {
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

/**
 * Получение конфигурации Ollama
 */
export async function getOllamaConfig(): Promise<OllamaConfig> {
  const runtimeConfig = await storage.getOllamaConfig();

  // If no provider manually configured, auto-detect from environment:
  // prefer OpenAI if OPENAI_API_KEY is available, otherwise fall back to ollama
  const defaultProvider = process.env.OPENAI_API_KEY ? "openai" : "ollama";

  return {
    apiUrl: process.env.OLLAMA_API_URL || runtimeConfig?.apiUrl || "",
    apiKey: process.env.OLLAMA_API_KEY || runtimeConfig?.apiKey || "",
    model: process.env.OLLAMA_MODEL || runtimeConfig?.model || "gpt-4o-mini",
    aiProvider: runtimeConfig?.aiProvider || defaultProvider,
    openaiApiUrl: runtimeConfig?.openaiApiUrl || "https://api.openai.com/v1",
    openaiModel: runtimeConfig?.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
    openaiApiKey: runtimeConfig?.openaiApiKey || process.env.OPENAI_API_KEY || "",
    enableChunking: runtimeConfig?.enableChunking !== false,
    maxContextTokens: runtimeConfig?.maxContextTokens || 28000,
  };
}

/**
 * Результат извлечения текста из файла
 */
export interface TextExtractionResult {
  text: string;
  method: "text" | "ocr" | "vision" | "hybrid" | "error";
  pageImages?: string[];
  confidence?: number;
  metadata?: Record<string, any>;
  /** Path to a searchable PDF (image + invisible OCR text layer) generated during OCR */
  searchablePdfPath?: string;
}

/**
 * Извлечение текста из PDF/документа используя Python парсер
 */
export async function extractTextFromFile(
  filePath: string,
  options: { useOcr?: boolean; advanced?: boolean } = {}
): Promise<TextExtractionResult> {
  const { spawn } = await import('child_process');
  const { promisify } = await import('util');
  const execPromise = promisify(spawn);

  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', [
      'python_server/document_parser.py',
      filePath,
      '--json',
      ...(options.useOcr === false ? ['--no-ocr'] : []),
      ...(options.advanced ? ['--advanced'] : [])
    ]);

    let stdout = '';
    let stderr = '';
    let settled = false;

    // Safety timeout: 10 min for large PDFs (OCR can be slow)
    const TIMEOUT_MS = 10 * 60 * 1000;
    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      log.error('Python document parser timed out, killing process', { filePath });
      try { pythonProcess.kill('SIGKILL'); } catch {}
      resolve({
        text: '',
        method: 'error',
        metadata: { error: `Extraction timed out after ${TIMEOUT_MS / 60000} minutes` }
      });
    }, TIMEOUT_MS);

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);

      if (code !== 0) {
        log.error('Python document parser failed', { code, stderr });
        resolve({
          text: '',
          method: 'error',
          metadata: { error: stderr }
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        resolve({
          text: result.text || '',
          method: result.method || 'text',
          pageImages: result.page_images || [],
          confidence: result.confidence,
          metadata: result.metadata || {},
          searchablePdfPath: result.searchable_pdf_path || undefined,
        });
      } catch (error) {
        log.error('Failed to parse document extraction result', { error, stdout });
        reject(new Error('Failed to parse extraction result'));
      }
    });

    pythonProcess.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      log.error('Failed to spawn Python process', { error });
      reject(error);
    });
  });
}

export async function callLLM(
  messages: Array<{ role: string; content: string }>,
  config: OllamaConfig,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  if (config.aiProvider === "openai") {
    return callOpenAIProvider(messages, config, options);
  }
  return callOllama(messages, config, options);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callOpenAIProvider(
  messages: Array<{ role: string; content: string }>,
  config: OllamaConfig,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  const rawUrl = config.openaiApiUrl || "https://api.openai.com/v1";
  const endpoint = rawUrl.includes('/chat/completions')
    ? rawUrl
    : `${rawUrl.replace(/\/+$/, '')}/chat/completions`;

  const MAX_RETRIES = 5;
  let lastError: any;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.openaiApiKey || config.apiKey}`
        },
        body: JSON.stringify({
          model: config.openaiModel || "gpt-4o",
          messages,
          temperature: options?.temperature ?? 0.7,
          max_tokens: options?.maxTokens ?? 4000
        })
      });

      if (response.status === 429) {
        // Rate limit — check for Retry-After header, else exponential backoff
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.min(1000 * Math.pow(2, attempt), 60000);
        log.warn(`OpenAI rate limit hit, retrying in ${waitMs}ms`, { attempt });
        await sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from OpenAI API');
      }

      return data.choices[0].message.content;
    } catch (error: any) {
      lastError = error;
      // Only retry on rate limit or network errors (not logic errors)
      const isRetryable = error?.message?.includes('rate') || error?.message?.includes('429') || error?.message?.includes('network') || error?.message?.includes('fetch');
      if (!isRetryable || attempt === MAX_RETRIES) {
        log.error('Error calling OpenAI LLM server', { error: error?.message || String(error), attempt });
        throw error;
      }
      const waitMs = Math.min(1000 * Math.pow(2, attempt), 60000);
      log.warn(`OpenAI call failed, retrying in ${waitMs}ms`, { attempt, error: error?.message });
      await sleep(waitMs);
    }
  }

  throw lastError;
}

/**
 * Вызов Ollama API для LLM inference
 */
export async function callOllama(
  messages: Array<{ role: string; content: string }>,
  config: OllamaConfig,
  options?: {
    temperature?: number;
    maxTokens?: number;
  }
): Promise<string> {
  try {
    const endpoint = config.apiUrl.includes('/chat/completions')
      ? config.apiUrl
      : `${config.apiUrl}/api/v1/chat/completions`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.choices || data.choices.length === 0) {
      throw new Error('No response from Ollama API');
    }

    return data.choices[0].message.content;
  } catch (error) {
    log.error('Error calling Ollama LLM server', { error });
    throw error;
  }
}
