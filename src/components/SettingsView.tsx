import { useRef, useState } from 'react';
import { store, useStore } from '../store';
import { DEFAULT_SETTINGS, type LlmSettings, type Provider } from '../lib/settings';

const PRESETS: Record<Provider, { baseUrl: string; model: string; hint: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    hint: '任何 OpenAI 兼容网关都行：把 base url 换成 https://xxx/v1，模型名填它支持的。',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-latest',
    hint: 'Anthropic 官方接口，浏览器直连已声明 anthropic-dangerous-direct-browser-access。',
  },
};

export default function SettingsView() {
  const state = useStore();
  const [draft, setDraft] = useState<LlmSettings>(state.settings);
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (patch: Partial<LlmSettings>) => setDraft({ ...draft, ...patch });

  const origin = typeof location !== 'undefined' ? location.origin : '';

  const exportBackup = () => {
    const blob = new Blob([store.exportAll()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `心络备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    const text = await file.text();
    await store.importAll(text);
  };

  const switchProvider = (provider: Provider) => {
    const preset = PRESETS[provider];
    setDraft({ ...draft, provider, baseUrl: preset.baseUrl, model: preset.model });
  };

  return (
    <div className="pane">
      <div className="pane-inner">
        <h1>设置</h1>
        <p className="lede">
          心络没有后端。解析用的模型由你自己提供，key 只写进这台设备的 localStorage，
          请求从浏览器直接发出，除了当天那段日志文本，什么都不会被带走。
        </p>

        <div className="field">
          <label>接口类型</label>
          <div className="row">
            <button
              type="button"
              className={`chip ${draft.provider === 'openai' ? '' : 'is-off'}`}
              onClick={() => switchProvider('openai')}
            >
              OpenAI 兼容
            </button>
            <button
              type="button"
              className={`chip ${draft.provider === 'anthropic' ? '' : 'is-off'}`}
              onClick={() => switchProvider('anthropic')}
            >
              Anthropic
            </button>
          </div>
          <div className="hint">{PRESETS[draft.provider].hint}</div>
        </div>

        <div className="field">
          <label htmlFor="base">Base URL</label>
          <input
            id="base"
            className="input"
            value={draft.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="model">模型</label>
          <input
            id="model"
            className="input"
            value={draft.model}
            onChange={(e) => set({ model: e.target.value })}
            spellCheck={false}
          />
        </div>

        <div className="field">
          <label htmlFor="key">API Key</label>
          <input
            id="key"
            className="input"
            type="password"
            value={draft.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder="sk-..."
            spellCheck={false}
            autoComplete="off"
          />
          <div className="hint">
            只存在本机 localStorage（键名 mindweb.llm）。点"抹去一切"会连同它一起清掉。
          </div>
        </div>

        <div className="row row-end">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setDraft({ ...DEFAULT_SETTINGS })}
          >
            恢复默认
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => store.updateSettings(draft)}
          >
            保存
          </button>
        </div>

        <div className="divider" />

        <div className="section-title" style={{ marginTop: 0 }}>
          本地数据
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          目前有 {state.entries.length} 篇日志、{Object.keys(state.graph.nodes).length} 个节点，
          全部在这台设备的 IndexedDB 里。没有账号，没有云同步，没有遥测。
        </p>
        <div className="row row-end">
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (
                window.confirm('抹去所有日志、图谱与 API key？这一步不可撤销。')
              ) {
                void store.wipe();
              }
            }}
          >
            抹去一切
          </button>
        </div>

        <div className="divider" />

        <div className="section-title" style={{ marginTop: 0 }}>
          备份与迁移
        </div>
        <p className="hint" style={{ marginTop: 0 }}>
          日志只存在浏览器里，并且按地址隔离。当前地址是{' '}
          <span style={{ color: 'var(--ink)' }}>{origin}</span>。<br />
          换端口、换浏览器、或者用 IP 打开，看到的都会是一张空图——日志没有丢，
          只是换了一个存储空间。用下面的导出/导入把数据搬过去。
        </p>
        <div className="row">
          <button
            type="button"
            className="btn"
            onClick={exportBackup}
            disabled={state.entries.length === 0}
          >
            导出备份（.json）
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            导入备份
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importBackup(file);
              e.target.value = '';
            }}
          />
        </div>
        <div className="hint">
          备份里是日志原文和已经解析出来的图谱，不含 API key。写了几篇之后建议导一份存着。
        </div>
      </div>
    </div>
  );
}
