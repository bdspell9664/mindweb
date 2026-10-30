import { SYSTEM_PROMPT, parseModelOutput } from './parse';
import type { ParsedLog } from '../types';
import type { LlmSettings } from './settings';

export interface LlmRequest {
  system: string;
  user: string;
}

const TIMEOUT_MS = 90_000;

export class LlmError extends Error {
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = 'LlmError';
    this.detail = detail;
  }
}

function friendly(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API key 似乎无效，或被这个网关拒绝了';
  if (status === 404) return '这个接口地址或模型名不存在，检查一下 base url 与 model';
  if (status === 429) return '调用太频繁或额度用尽，等一下再试';
  if (status >= 500) return '模型服务暂时不可用，稍后重试';
  return `调用失败（HTTP ${status}）${body ? `：${body.slice(0, 160)}` : ''}`;
}

async function requestJson(url: string, init: RequestInit): Promise<{ status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    return { status: res.status, text };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new LlmError('请求超时了，日志还在，可以直接重试');
    }
    throw new LlmError(
      '连不上模型服务。检查网络，或确认这个接口支持浏览器直接调用（CORS）',
      err instanceof Error ? err.message : String(err),
    );
  } finally {
    clearTimeout(timer);
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function callOpenAi(
  settings: LlmSettings,
  req: LlmRequest,
  jsonMode: boolean,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: settings.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const { status, text } = await requestJson(joinUrl(settings.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (status === 400 && jsonMode) {
    // 一些兼容网关不认 response_format，去掉再试一次
    return callOpenAi(settings, req, false);
  }
  if (status < 200 || status >= 300) throw new LlmError(friendly(status, text), text);

  try {
    const data = JSON.parse(text) as {
      choices?: { message?: { content?: string | { type: string; text?: string }[] } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content.map((c) => c.text ?? '').join('');
    }
    throw new Error('响应里没有 content');
  } catch {
    throw new LlmError('模型的响应格式看不懂', text.slice(0, 400));
  }
}

async function callAnthropic(settings: LlmSettings, req: LlmRequest): Promise<string> {
  const { status, text } = await requestJson(joinUrl(settings.baseUrl, 'messages'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      // 允许浏览器直连（官方要求显式声明）
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 4096,
      temperature: 0.2,
      system: `${req.system}\n只输出 JSON 对象，不要 markdown 代码块。`,
      messages: [{ role: 'user', content: req.user }],
    }),
  });

  if (status < 200 || status >= 300) throw new LlmError(friendly(status, text), text);

  try {
    const data = JSON.parse(text) as { content?: { type: string; text?: string }[] };
    const parts = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '');
    if (parts.length === 0) throw new Error('响应里没有文本块');
    return parts.join('');
  } catch {
    throw new LlmError('模型的响应格式看不懂', text.slice(0, 400));
  }
}

export async function chat(
  settings: LlmSettings,
  req: LlmRequest,
  jsonMode = true,
): Promise<string> {
  if (!settings.apiKey.trim()) {
    throw new LlmError('还没有填 API key，先去设置页填上你自己的 key（只存在这台设备）');
  }
  return settings.provider === 'anthropic'
    ? callAnthropic(settings, req)
    : callOpenAi(settings, req, jsonMode);
}

const STRICTER = `上一次的回答不是合法 JSON。请重新处理，只输出一个 JSON 对象，
形如 {"nodes":[...],"edges":[...]}，不要任何解释文字、不要 markdown 代码块。`;

/** 调模型 → 解析 → 失败就用更严格的指令重试一次。 */
export async function parseEntry(
  settings: LlmSettings,
  text: string,
  date: string,
): Promise<ParsedLog> {
  const first = await chat(settings, {
    system: SYSTEM_PROMPT,
    user: `日志日期：${date}\n\n日志原文：\n${text}`,
  });

  try {
    return parseModelOutput(first, date);
  } catch (err) {
    const second = await chat(settings, {
      system: SYSTEM_PROMPT,
      user: `${STRICTER}\n\n日志日期：${date}\n\n日志原文：\n${text}`,
    });
    try {
      return parseModelOutput(second, date);
    } catch {
      throw new LlmError(
        '模型两次都没给出可用的 JSON。可以把它的原文贴到"手动粘贴"里，或者换个模型再试',
        second.slice(0, 1200),
      );
    }
  }
}
