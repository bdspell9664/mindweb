import { useEffect, useMemo, useState } from 'react';
import { store, useStore } from '../store';
import { buildAdjacency, colorOf, relationLabelFor, TYPE_COLOR, type NeighborLink } from '../lib/graph';
import { NODE_TYPES, TYPE_LABEL, type GraphNode, type NodeType } from '../types';

interface Props {
  onSelect: (id: string) => void;
}

type Grouping = 'type' | 'time' | 'link';

function relationLabel(link: NeighborLink): string {
  return relationLabelFor(link.relation, link.direction);
}

/** 列表里用第一条有内容的摘录当副标题。 */
function firstQuote(node: GraphNode): string | undefined {
  return node.appearances.find((a) => a.quote)?.quote;
}

function Row({
  node,
  active,
  related,
  dimmed,
  showType,
  links,
  onSelect,
  onOpenGraph,
}: {
  node: GraphNode;
  active: boolean;
  related: boolean;
  dimmed: boolean;
  showType: boolean;
  links: NeighborLink[];
  onSelect: (id: string) => void;
  onOpenGraph: (id: string) => void;
}) {
  const quote = firstQuote(node);
  const color = colorOf(node);

  return (
    <div
      className={`list-item ${active ? 'is-active' : ''} ${related ? 'is-related' : ''} ${
        dimmed ? 'is-dimmed' : ''
      }`}
    >
      <button type="button" className="list-row" onClick={() => onSelect(node.id)}>
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
          <span className={links.length === 0 ? 'list-alone' : 'list-weight'}>
            {links.length === 0 ? '孤立' : `↔ ${links.length}`}
          </span>
          <span>{node.count} 次</span>
          <span>{node.lastDate}</span>
        </span>
      </button>

      {active && (
        <div className="list-related">
          {links.length === 0 ? (
            <span className="list-related-empty">还没有连到任何东西</span>
          ) : (
            links.map((link) => (
              <button
                key={`${link.node.id}-${link.relation}-${link.direction}`}
                type="button"
                className="pill-link"
                onClick={() => onSelect(link.node.id)}
                title={`${link.node.name}（${relationLabel(link)}，权重 ${link.weight.toFixed(2)}）`}
              >
                <span
                  className="dot"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 99,
                    background: colorOf(link.node),
                    color: colorOf(link.node),
                  }}
                />
                {link.node.name.length > 12 ? `${link.node.name.slice(0, 12)}…` : link.node.name}
                <span className="rel">{relationLabel(link)}</span>
              </button>
            ))
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenGraph(node.id)}>
            在图谱里看
          </button>
        </div>
      )}
    </div>
  );
}

export default function ListView({ onSelect }: Props) {
  const { graph, filters, selectedId } = useStore();
  const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<Grouping>('type');

  const adjacency = useMemo(() => buildAdjacency(graph), [graph]);

  /** 搜索同时匹配节点名和原文摘录——"我记得写过那件事"也能找到。 */
  const nodes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = Object.values(graph.nodes)
      .filter((n) => n.type !== 'entry')
      .filter((n) => {
        if (!q) return true;
        if (n.name.toLowerCase().includes(q)) return true;
        return n.appearances.some((a) => a.quote.toLowerCase().includes(q));
      })
      .filter((n) => !filters.from || n.lastDate >= filters.from)
      .filter((n) => !filters.to || n.firstDate <= filters.to);

    const linkWeight = (n: GraphNode) => adjacency.get(n.id)?.weight ?? 0;
    if (grouping === 'link') {
      // 牵连最深的排前面
      return matched.sort(
        (a, b) => linkWeight(b) - linkWeight(a) || b.lastDate.localeCompare(a.lastDate),
      );
    }
    return matched.sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.count - a.count);
  }, [graph, query, filters, grouping, adjacency]);

  const groups = useMemo(() => {
    const map = new Map<NodeType, GraphNode[]>();
    for (const n of nodes) {
      const list = map.get(n.type) ?? [];
      list.push(n);
      map.set(n.type, list);
    }
    return NODE_TYPES.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t)! }));
  }, [nodes]);

  /** 当前选中的节点连到了谁——列表里把这些行标出来，和图谱的高亮是一个意思 */
  const relatedIds = useMemo(() => {
    if (!selectedId) return null;
    const entry = adjacency.get(selectedId);
    return new Set(entry ? entry.links.map((l) => l.node.id) : []);
  }, [selectedId, adjacency]);

  // 手机上详情是底部抽屉，选中行如果落在下半屏，展开的关联就被抽屉盖住了：
  // 选中时把它滚到列表顶部，关联就看得见
  useEffect(() => {
    if (!selectedId) return;
    if (!window.matchMedia('(max-width: 760px)').matches) return;
    const raf = requestAnimationFrame(() => {
      document
        .querySelector('.list-item.is-active')
        ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedId]);

  const hasFocus = filters.highlight.size > 0;
  const openInGraph = (id: string) => {
    store.select(id);
    store.setMode('graph');
  };

  const renderNode = (node: GraphNode, showType: boolean) => (
    <Row
      key={node.id}
      node={node}
      active={selectedId === node.id}
      related={Boolean(relatedIds?.has(node.id))}
      dimmed={hasFocus && !filters.highlight.has(node.type)}
      showType={showType}
      links={adjacency.get(node.id)?.links ?? []}
      onSelect={onSelect}
      onOpenGraph={openInGraph}
    />
  );

  return (
    <div className={`list-view ${selectedId ? 'has-detail' : ''}`}>
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
          <button
            type="button"
            className={grouping === 'link' ? 'is-active' : ''}
            onClick={() => setGrouping('link')}
            title="按牵连程度排序：相连的边越多、越强越靠前"
          >
            按关联
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
            {group.items.map((node) => renderNode(node, false))}
          </section>
        ))
      ) : (
        <section className="list-group">{nodes.map((node) => renderNode(node, true))}</section>
      )}
    </div>
  );
}
