import { useEffect, useMemo } from 'react';
import { useStore } from '../store';
import { dayDiff } from '../lib/graph';

interface Props {
  range: { min: string; max: string } | null;
  cursor: string | null;
  playing: boolean;
  disabled: boolean;
  onChange: (date: string | null) => void;
  onPlay: (playing: boolean) => void;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function Timeline({ range, cursor, playing, disabled, onChange, onPlay }: Props) {
  const { graph } = useStore();

  const total = range ? Math.max(0, dayDiff(range.min, range.max)) : 0;
  const index = range ? (cursor ? Math.min(total, Math.max(0, dayDiff(range.min, cursor))) : total) : 0;

  /** 时间轴上那些"这一天有东西长出"的刻度 */
  const marks = useMemo(() => {
    if (!range) return [];
    const seen = new Map<string, number>();
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'entry') continue;
      if (n.firstDate < range.min || n.firstDate > range.max) continue;
      seen.set(n.firstDate, (seen.get(n.firstDate) ?? 0) + 1);
    }
    return [...seen.entries()].map(([date, count]) => ({ date, count }));
  }, [graph, range]);

  // 自动播放：一天一天往前长
  useEffect(() => {
    if (!playing || !range) return;
    const timer = setInterval(() => {
      if (!cursor) {
        onChange(addDays(range.min, 1));
        return;
      }
      const next = dayDiff(range.min, cursor) + 3;
      if (next >= total) {
        onPlay(false);
        onChange(null);
        return;
      }
      onChange(addDays(range.min, next));
    }, 160);
    return () => clearInterval(timer);
  }, [playing, cursor, range, total, onChange, onPlay]);

  if (!range) {
    return (
      <footer className="timeline">
        <div className="timeline-meta">时间还没有开始</div>
        <div />
        <div />
      </footer>
    );
  }

  const current = cursor ?? range.max;

  return (
    <footer className="timeline" style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          onClick={() => onPlay(!playing)}
          title="让图谱按时间自己生长"
        >
          {playing ? '暂停' : '回放'}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            onPlay(false);
            onChange(null);
          }}
        >
          全图
        </button>
      </div>

      <div className="track">
        <div className="track-line" />
        <div className="track-ticks">
          {marks.map((m) => (
            <span
              key={m.date}
              className={`track-tick ${m.count > 1 ? 'is-node' : ''}`}
              style={{ left: `${total === 0 ? 50 : (dayDiff(range.min, m.date) / total) * 100}%` }}
              title={`${m.date}：${m.count} 个节点`}
            />
          ))}
        </div>
        <input
          className="scrub"
          type="range"
          min={0}
          max={total}
          step={1}
          value={index}
          onChange={(e) => {
            const v = Number(e.target.value);
            onPlay(false);
            onChange(v >= total ? null : addDays(range.min, v));
          }}
          aria-label="时间回放"
        />
      </div>

      <div className="timeline-meta">
        <strong>{current}</strong>
        <span style={{ margin: '0 6px' }}>·</span>
        {range.min} 起
      </div>
    </footer>
  );
}
