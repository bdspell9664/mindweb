import { TYPE_LABEL, type Graph, type GraphNode, type NodeType } from '../types';
import { colorOf, neighborsOf, relationLabelFor } from '../lib/graph';
import RiskCare from './RiskCare';

interface Props {
  node: GraphNode;
  graph: Graph;
  onClose: () => void;
  onSelect: (id: string) => void;
  onAchieve: (id: string) => void;
}

const MEANING: Record<NodeType, string> = {
  emotion: '你原话里的一个情绪词。这里不做泛化——写的是「撕裂」，节点就叫「撕裂」。',
  person: '日志里出现过的人。同一个名字会累加成同一个人。',
  event: '一件具体发生过的事。事件不合并，每一个都钉在自己的日期上。',
  trigger: '点燃情绪的那个画面或场景。它往往比情绪本身更容易被忽略。',
  theme: '长期反复出现的主题，图谱里最沉的那些团块。',
  wish: '一个念想。现在它是光点；被实现之后，会变成带光晕的恒星。',
  risk_node: '一个反复回来的、关于伤害自己的念头。记下它，不是为了被评判，是为了不让它独自待着。',
  entry: '这一天的日志锚点。',
};

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 300;
  const h = 54;
  const pad = 7;
  const max = Math.max(5, ...values);
  const min = Math.min(1, ...values);
  const span = Math.max(1, max - min);
  const points = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return { x, y, v };
  });
  const line = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${w - pad},${h - pad}`;
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(143,162,255,0.28)" />
          <stop offset="100%" stopColor="rgba(143,162,255,0)" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#spark-fill)" />
      <polyline
        points={line}
        fill="none"
        stroke="rgba(174,192,255,0.85)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.9} fill="rgba(220,230,255,0.9)" />
      ))}
    </svg>
  );
}

export default function NodeDetail({ node, graph, onClose, onSelect, onAchieve }: Props) {
  const color = colorOf(node);
  const linked = neighborsOf(graph, node.id);
  const quotes = [...node.appearances]
    .filter((a) => a.quote)
    .reverse()
    .slice(0, 12);

  const intensitySeries = node.appearances
    .map((a) => a.intensity)
    .filter((v): v is number => typeof v === 'number');

  return (
    <aside className="detail" aria-label="节点详情">
      <div className="detail-head">
        <div style={{ flex: 1 }}>
          <div className="detail-type">{TYPE_LABEL[node.type]}</div>
          <div className="detail-title" style={{ color }}>
            {node.name}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      <p className="detail-desc">{MEANING[node.type]}</p>

      <div className="stat-row">
        <div className="stat">
          <span className="v">{node.count}</span>
          <span className="k">出现次数</span>
        </div>
        <div className="stat">
          <span className="v" style={{ fontSize: 15, paddingTop: 6 }}>
            {node.firstDate}
          </span>
          <span className="k">第一次</span>
        </div>
        <div className="stat">
          <span className="v" style={{ fontSize: 15, paddingTop: 6 }}>
            {node.lastDate}
          </span>
          <span className="k">最近一次</span>
        </div>
      </div>

      {intensitySeries.length >= 2 && (
        <>
          <div className="section-title">强度趋势</div>
          <Sparkline values={intensitySeries} />
        </>
      )}

      {node.type === 'wish' && (
        <div className="row" style={{ marginTop: 18 }}>
          {node.achieved ? (
            <span className="hint" style={{ color: 'var(--gold)' }}>
              {node.achievedAt ? `${node.achievedAt} 实现了` : '已经实现'}
            </span>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => onAchieve(node.id)}>
              标记为已实现
            </button>
          )}
        </div>
      )}

      {quotes.length > 0 && (
        <>
          <div className="section-title">原文摘录</div>
          {quotes.map((a, i) => (
            <blockquote className="quote" key={`${a.entryId}-${i}`}>
              <p>{a.quote}</p>
              <div className="date">{a.date}</div>
            </blockquote>
          ))}
        </>
      )}

      {linked.length > 0 && (
        <>
          <div className="section-title">一跳关联</div>
          <div>
            {linked.map(({ node: other, relation, direction }) => (
              <button
                key={`${other.id}-${relation}-${direction}`}
                type="button"
                className="pill-link"
                onClick={() => onSelect(other.id)}
                title={other.name}
              >
                <span className="dot" style={{ width: 6, height: 6, borderRadius: 99, background: colorOf(other) }} />
                {other.name.length > 12 ? `${other.name.slice(0, 12)}…` : other.name}
                <span className="rel">{relationLabelFor(relation, direction)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {node.type === 'risk_node' && <RiskCare />}
    </aside>
  );
}
