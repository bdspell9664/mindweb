import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { colorOf, TYPE_COLOR } from '../lib/graph';
import { NODE_TYPES, TYPE_LABEL, type GraphNode, type NodeType } from '../types';

interface Props {
  onSelect: (id: string) => void;
}

/** 列表里用第一条有内容的摘录当副标题。 */
function firstQuote(node: GraphNode): string | undefined {
  return node.appearances.find((a) => a.quote)?.quote;
}

function Row({
  node,
  active,
  showType,
  onClick,
}: {
  node: GraphNode;
  active: boolean;
  showType: boolean;
  onClick: () => void;
}) {
  const quote = firstQuote(node);
  const color = colorOf(node);
  return (
    <button
      type="button"
      className={`list-row ${active ? 'is-active' : ''}`}
      onClick={onClick}
    >
      <span className="list-dot" style={{ background: color, color }} />
      <span className="list-main">
        <span className="list-name">
          {node.name}
          {node.type === 'wish' && node.achieved && <span className="list-badge">已实现</span>}
        </span>
        {quote && <span className="list-quote">{quote}</span>}
      </span>
      {showType && <span className="list-type">{TYPE_LABEL[node.type]}</span>}
      <span className="list-meta">
        <span>{node.count} 次</span>
        <span>{node.lastDate}</span>
      </span>
    </button>
  );
}

export default function ListView({ onSelect }: Props) {
  const { graph, filters, selectedId } = useStore();
  const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<'type' | 'time'>('type');

  /** 搜索同时匹配节点名和原文摘录——"我记得写过那件事"也能找到。 */
  const nodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(graph.nodes)
      .filter((n) => n.type !== 'entry')
      .filter((n) => {
        if (!q) return true;
        if (n.name.toLowerCase().includes(q)) return true;
        return n.appearances.some((a) => a.quote.toLowerCase().includes(q));
      })
      .filter((n) => !filters.from || n.lastDate >= filters.from)
      .filter((n) => !filters.to || n.firstDate <= filters.to)
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count);
  }, [graph, query, filters]);

  const groups = useMemo(() => {
    const map = new Map<NodeType, GraphNode[]>();
    for (const n of nodes) {
      const list = map.get(n.type) ?? [];
      list.push(n);
      map.set(n.type, list);
    }
    return NODE_TYPES.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t)! }));
  }, [nodes]);

  return (
    <div className="list-view">
      <div className="list-toolbar">
        <input
          className="input list-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜名字或原文摘录…"
          spellCheck={false}
          aria-label="搜索节点"
        />
        <div className="list-segment" role="group" aria-label="排列方式">
          <button
            type="button"
            className={grouping === 'type' ? 'is-active' : ''}
            onClick={() => setGrouping('type')}
          >
            按类型
          </button>
          <button
            type="button"
            className={grouping === 'time' ? 'is-active' : ''}
            onClick={() => setGrouping('time')}
          >
            按时间
          </button>
        </div>
        <span className="list-total">{nodes.length} 个节点</span>
      </div>

      {nodes.length === 0 ? (
        <div className="list-empty">
          {query ? (
            <>没有匹配「{query}」的节点</>
          ) : (
            <>
              <strong>还没有可列出的节点</strong>
              写下第一篇日志，或者清掉顶栏的日期区间
            </>
          )}
        </div>
      ) : grouping === 'type' ? (
        groups.map((group) => (
          <section className="list-group" key={group.type}>
            <h2 className="list-group-title">
              <span
                className="list-dot"
                style={{ background: TYPE_COLOR[group.type], color: TYPE_COLOR[group.type] }}
              />
              {TYPE_LABEL[group.type]}
              <span className="list-group-count">{group.items.length}</span>
            </h2>
            {group.items.map((node) => (
              <Row
                key={node.id}
                node={node}
                active={selectedId === node.id}
                showType={false}
                onClick={() => onSelect(node.id)}
              />
            ))}
          </section>
        ))
      ) : (
        <section className="list-group">
          {nodes.map((node) => (
            <Row
              key={node.id}
              node={node}
              active={selectedId === node.id}
              showType
              onClick={() => onSelect(node.id)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
