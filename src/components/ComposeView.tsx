import { useState } from 'react';
import { store, useStore } from '../store';
import { extractJson, sanitizeParsed } from '../lib/parse';
import type { ParsedLog } from '../types';

function todayLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function ComposeView() {
  const state = useStore();
  const [date, setDate] = useState(todayLocal);
  const [text, setText] = useState('');
  const [rawJson, setRawJson] = useState('');
  const [showManual, setShowManual] = useState(false);

  const existing = state.entries.find((e) => e.date === date);

  const submit = async () => {
    const ok = await store.analyze(text, date);
    if (ok) setText('');
  };

  const importManual = async () => {
    try {
      const parsed: ParsedLog = sanitizeParsed(extractJson(rawJson), date);
      await store.importParsed(parsed, text || '（手动导入的解析结果）', date);
      setRawJson('');
      setText('');
    } catch (err) {
      store.notify({
        kind: 'error',
        text: '这段 JSON 还是用不了',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className="pane">
      <div className="pane-inner">
        <h1>今天发生了什么</h1>
        <p className="lede">
          想到哪儿写到哪儿，不必整理措辞。写完之后交给模型抽取——它会保留你的原话，
          只把里面的人、事、情绪、触发物和念想拆成节点，连成一张会随时间生长的网。
        </p>

        <div className="field">
          <label htmlFor="log-date">日期 · 一天一篇</label>
          <div className="row">
            <input
              id="log-date"
              type="date"
              className="input-date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayLocal())}
            />
            {existing && <span className="hint">这天已有日志，保存会覆盖它</span>}
          </div>
        </div>

        <div className="field">
          <textarea
            className="textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="今天……"
            spellCheck={false}
          />
          <div className="hint">
            只有这段文字会被发送给你自己配置的模型。原文与图谱全部留在这台设备的本地存储里。
          </div>
        </div>

        <div className="row row-end">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowManual((v) => !v)}
          >
            {showManual ? '收起手动粘贴' : '模型不听话？手动粘贴 JSON'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={state.busy || !text.trim()}
          >
            {state.busy ? '正在解析…' : '解析，长进图谱'}
          </button>
        </div>

        {showManual && (
          <>
            <div className="divider" />
            <div className="field">
              <label htmlFor="raw-json">粘贴模型返回的 JSON</label>
              <textarea
                id="raw-json"
                className="textarea"
                style={{ minHeight: 160, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                placeholder={'{"nodes":[...],"edges":[...]}'}
                spellCheck={false}
              />
              <div className="hint">
                带 ```json 围栏或前后有多余文字都可以，解析器会自己找。字段校验和同名合并与自动解析完全一致。
              </div>
            </div>
            <div className="row row-end">
              <button
                type="button"
                className="btn"
                onClick={() => void importManual()}
                disabled={!rawJson.trim()}
              >
                导入这段 JSON
              </button>
            </div>
          </>
        )}

        <div className="divider" />

        <div className="section-title" style={{ marginTop: 0 }}>
          已经写下的日子
        </div>
        {state.entries.length === 0 ? (
          <p className="empty-note">还没有任何日志。第一张网，从今天开始。</p>
        ) : (
          <div className="entry-list">
            {state.entries.map((entry) => (
              <div className="entry-item" key={entry.id}>
                <span className="d">{entry.date}</span>
                <span className="t">{entry.text}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-faint)' }}>
                  {entry.parsed.nodes.length} 节点
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setDate(entry.date);
                    setText(entry.text);
                    window.scrollTo({ top: 0 });
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (window.confirm(`删掉 ${entry.date} 的这篇日志？图谱会重新长一遍。`)) {
                      void store.remove(entry.id);
                    }
                  }}
                >
                  删掉
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
