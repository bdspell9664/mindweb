import type { CSSProperties } from 'react';
import { NODE_TYPES, TYPE_LABEL, type NodeType, type ViewMode } from '../types';
import type { Filters } from '../store';
import { TYPE_COLOR } from '../lib/graph';

interface Props {
  filters: Filters;
  mode: ViewMode;
  nodeCount: number;
  entryCount: number;
  onToggleHighlight: (type: NodeType) => void;
  onClearHighlight: () => void;
  onRange: (from: string | null, to: string | null) => void;
  onMode: (mode: ViewMode) => void;
}

const VISIBLE_TYPES = NODE_TYPES.filter((t) => t !== 'entry');

export default function FilterBar({
  filters,
  mode,
  nodeCount,
  entryCount,
  onToggleHighlight,
  onClearHighlight,
  onRange,
  onMode,
}: Props) {
  const hasFocus = filters.highlight.size > 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-orb" />
        心络
        <span className="brand-sub">INNER SYNAPSE MAP</span>
      </div>

      <nav className="nav">
        <button
          type="button"
          className={mode === 'graph' ? 'is-active' : ''}
          onClick={() => onMode('graph')}
        >
          图谱
        </button>
        <button
          type="button"
          className={mode === 'compose' ? 'is-active' : ''}
          onClick={() => onMode('compose')}
        >
          写日志
        </button>
        <button
          type="button"
          className={mode === 'settings' ? 'is-active' : ''}
          onClick={() => onMode('settings')}
        >
          设置
        </button>
      </nav>

      <span className="spacer" />

      <div className="filters">
        {VISIBLE_TYPES.map((type) => {
          const focused = filters.highlight.has(type);
          const color = TYPE_COLOR[type];
          return (
            <button
              key={type}
              type="button"
              className={`chip ${focused ? 'is-focus' : ''} ${
                hasFocus && !focused ? 'is-muted' : ''
              }`}
              style={{ '--chip': color } as CSSProperties}
              onClick={() => onToggleHighlight(type)}
              title={focused ? `取消高亮「${TYPE_LABEL[type]}」` : `高亮「${TYPE_LABEL[type]}」`}
              aria-pressed={focused}
            >
              <span className="dot" style={{ background: color, color }} />
              {TYPE_LABEL[type]}
            </button>
          );
        })}
        {hasFocus && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClearHighlight}>
            取消高亮
          </button>
        )}
      </div>

      <div className="range">
        <input
          type="date"
          className="input-date"
          value={filters.from ?? ''}
          onChange={(e) => onRange(e.target.value || null, filters.to)}
          aria-label="起始日期"
        />
        <span>→</span>
        <input
          type="date"
          className="input-date"
          value={filters.to ?? ''}
          onChange={(e) => onRange(filters.from, e.target.value || null)}
          aria-label="结束日期"
        />
        {(filters.from || filters.to) && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRange(null, null)}>
            清除
          </button>
        )}
      </div>

      <div className="timeline-meta" style={{ marginLeft: 6 }}>
        <strong>{nodeCount}</strong> 个节点 · <strong>{entryCount}</strong> 篇
      </div>
    </header>
  );
}
