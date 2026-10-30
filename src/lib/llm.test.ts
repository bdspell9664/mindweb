import { afterEach, describe, expect, it, vi } from 'vitest';
import { LlmError, chat, parseEntry } from './llm';
import type { LlmSettings } from './settings';

const OPENAI: LlmSettings = {
  provider: 'openai',
  baseUrl: 'https://gateway.test/v1',
  model: 'test-model',
  apiKey: 'sk-test',
};

const VALID = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          nodes: [
            { type: 'emotion', name: '撕裂', polarity: -4, intensity: 5, quote: '整个人被撕裂' },
            { type: 'person', name: '妈妈' },
          ],
          edges: [{ source: 'person:妈妈', target: 'emotion:撕裂', relation: 'involves', weight: 0.8 }],
        }),
      },
    },
  ],
};

function reply(body: unknown, status = 200) {
  return {
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chat', () => {
  it('没有 api key 时直接抛错，不发请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      chat({ ...OPENAI, apiKey: '' }, { system: 's', user: 'u' }),
    ).rejects.toBeInstanceOf(LlmError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('网关不认 response_format（400）时去掉它自动重试', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ error: 'unsupported' }, 400))
      .mockResolvedValueOnce(reply(VALID));
    vi.stubGlobal('fetch', fetchMock);

    const text = await chat(OPENAI, { system: 's', user: 'u' });
    expect(text).toContain('撕裂');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const first = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(first.response_format).toEqual({ type: 'json_object' });
    expect(second.response_format).toBeUndefined();
  });

  it('401 被翻译成能看懂的中文提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ error: 'bad key' }, 401)));
    await expect(chat(OPENAI, { system: 's', user: 'u' })).rejects.toThrow(/API key/);
  });

  it('Anthropic 走 messages 接口并带上浏览器直连声明', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      reply({ content: [{ type: 'text', text: '{"nodes":[],"edges":[]}' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const text = await chat(
      { ...OPENAI, provider: 'anthropic', baseUrl: 'https://api.anthropic.test/v1' },
      { system: 's', user: 'u' },
    );
    expect(text).toBe('{"nodes":[],"edges":[]}');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.anthropic.test/v1/messages');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
  });
});

describe('parseEntry', () => {
  it('正常返回时得到校验过的结构', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(VALID)));
    const parsed = await parseEntry(OPENAI, '今天和妈妈吵了一架', '2024-05-01');
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.nodes[0].date).toBe('2024-05-01');
  });

  it('第一次返回废话时用更严格的指令重试一次并成功', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ choices: [{ message: { content: '抱歉，我无法完成。' } }] }))
      .mockResolvedValueOnce(reply(VALID));
    vi.stubGlobal('fetch', fetchMock);

    const parsed = await parseEntry(OPENAI, '日志', '2024-05-01');
    expect(parsed.nodes.length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(secondBody.messages[1].content).toContain('上一次的回答不是合法 JSON');
  });

  it('两次都失败时抛出带原文的错误，方便手动粘贴', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(reply({ choices: [{ message: { content: '完全不是 JSON' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await parseEntry(OPENAI, '日志', '2024-05-01');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      expect((err as LlmError).detail).toContain('完全不是 JSON');
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
