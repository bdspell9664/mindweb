export type Provider = 'openai' | 'anthropic';

export interface LlmSettings {
  provider: Provider;
  /** OpenAI 兼容网关或 Anthropic 的 base url */
  baseUrl: string;
  model: string;
  /** 只存在本机 localStorage，永不随日志外发 */
  apiKey: string;
}

const LS_KEY = 'mindweb.llm';

export const DEFAULT_SETTINGS: LlmSettings = {
  provider: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  apiKey: '',
};

export function loadSettings(): LlmSettings {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    return {
      provider: parsed.provider === 'anthropic' ? 'anthropic' : 'openai',
      baseUrl: parsed.baseUrl?.trim() || DEFAULT_SETTINGS.baseUrl,
      model: parsed.model?.trim() || DEFAULT_SETTINGS.model,
      apiKey: parsed.apiKey ?? '',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: LlmSettings): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  } catch {
    /* 无痕模式下写不进去，本次会话仍然可用 */
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* 忽略 */
  }
}
