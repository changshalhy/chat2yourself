export type ChatRole = 'user' | 'assistant';

export type InterviewStageId =
  | 'arrival'
  | 'facts'
  | 'perspective'
  | 'pattern'
  | 'tiny_step'
  | 'closing';

export type RuntimeMode = 'desktop' | 'web';

export type RuntimeInfo = {
  mode: RuntimeMode;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  configPath?: string;
};

export type SaveModelConfigInput = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

export type ChatInput = {
  stage: InterviewStageId;
  messages: Array<{ role: ChatRole; content: string }>;
};

export type ChatOutput = {
  message: { role: 'assistant'; content: string };
};

export type ReportOutput = {
  report: {
    title: string;
    sections: Array<{
      id: string;
      title: string;
      body?: string;
      items?: string[];
    }>;
  };
};

export type AiClient = {
  mode: RuntimeMode;
  health(): Promise<RuntimeInfo>;
  saveModelConfig?(input: SaveModelConfigInput): Promise<RuntimeInfo>;
  clearModelConfig?(): Promise<RuntimeInfo>;
  chat(input: ChatInput): Promise<ChatOutput>;
  generateReport(input: ChatInput): Promise<ReportOutput>;
};

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-pro';

type TauriWindow = Window & {
  __TAURI__?: {
    core?: {
      invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
    };
  };
  __TAURI_INTERNALS__?: {
    invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  };
};

function getTauriInvoke() {
  const tauriWindow = window as TauriWindow;
  return tauriWindow.__TAURI__?.core?.invoke ?? tauriWindow.__TAURI_INTERNALS__?.invoke ?? null;
}

function isDesktopRuntime() {
  return getTauriInvoke() !== null;
}

async function readJsonResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(normalizeProviderError(payload, fallback));
  }

  return payload as T;
}

function normalizeProviderError(payload: unknown, fallback: string) {
  const message = extractErrorMessage(payload) ?? fallback;
  const normalized = message.toLocaleLowerCase();

  if (/missing.*api|api key|apikey|unauthorized|401|403|鉴权|认证|权限/.test(normalized)) {
    return 'API Key 无效、缺失或权限不足。请检查本地配置。';
  }

  if (/model|模型|not found|不存在/.test(normalized)) {
    return '模型不存在或当前账号不可用。请检查模型名。';
  }

  if (/network|fetch|timeout|econn|连接|网络/.test(normalized)) {
    return '网络不可达或模型服务暂时无法连接。';
  }

  if (/empty|空白/.test(normalized)) {
    return '模型服务返回了空内容。';
  }

  if (/json|parse|格式/.test(normalized)) {
    return '报告 JSON 格式解析失败，可以稍后重试。';
  }

  return message;
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const error = (payload as { error?: unknown }).error;

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }

  return null;
}

function makeWebClient(): AiClient {
  return {
    mode: 'web',
    async health() {
      const response = await fetch('/api/health');
      const payload = await readJsonResponse<{ model?: string; hasApiKey?: boolean }>(
        response,
        '后端健康检查没有通过。'
      );

      return {
        mode: 'web',
        baseUrl: DEFAULT_BASE_URL,
        model: typeof payload.model === 'string' ? payload.model : DEFAULT_MODEL,
        hasApiKey: Boolean(payload.hasApiKey)
      };
    },
    async chat(input) {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      return readJsonResponse<ChatOutput>(response, '这次没有发出去。');
    },
    async generateReport(input) {
      const response = await fetch('/api/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      });
      return readJsonResponse<ReportOutput>(response, '这次没有生成报告。');
    }
  };
}

function makeDesktopClient(invoke: NonNullable<ReturnType<typeof getTauriInvoke>>): AiClient {
  return {
    mode: 'desktop',
    health: () => invoke<RuntimeInfo>('health'),
    saveModelConfig: (input) => invoke<RuntimeInfo>('save_model_config', { input }),
    clearModelConfig: () => invoke<RuntimeInfo>('clear_model_config'),
    chat: (input) => invoke<ChatOutput>('chat', { input }),
    generateReport: (input) => invoke<ReportOutput>('generate_report', { input })
  };
}

export function createAiClient(): AiClient {
  const invoke = isDesktopRuntime() ? getTauriInvoke() : null;
  return invoke ? makeDesktopClient(invoke) : makeWebClient();
}

export function normalizeAiError(error: unknown) {
  if (error instanceof Error) {
    return normalizeProviderError({ error: error.message }, error.message);
  }

  if (typeof error === 'string') {
    return normalizeProviderError({ error }, error);
  }

  return '发生了未知错误。';
}
