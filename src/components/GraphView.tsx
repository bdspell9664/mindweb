import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import { colorOf, radiusOf, type View } from '../lib/graph';
import { TYPE_LABEL, type GraphNode, type Relation } from '../types';
import Starfield from './Starfield';

interface Props {
  view: View;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  ripple: number;
  totalNodes: number;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  node: GraphNode;
  lum: number;
  dimmed: boolean;
  moved?: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id: string;
  relation: Relation;
  weight: number;
  opacity: number;
  evaporating: boolean;
  dimmed: boolean;
}

const LINK_COLOR: Record<Relation, string> = {
  triggered: '#9fb0ff',
  involves: '#8fd6c6',
  belongs_to: '#7f8fd0',
  evolves: '#ffd479',
  co_occurs: '#8fa0c0',
};

/** 标签只给有语义分量的类型，避免图变成一团字。 */
function shouldLabel(node: GraphNode): boolean {
  return (
    node.type === 'theme' ||
    node.type === 'person' ||
    node.type === 'event' ||
    node.type === 'wish' ||
    node.type === 'emotion'
  );
}

function shortLabel(name: string): string {
  return name.length > 10 ? `${name.slice(0, 10)}…` : name;
}

export default function GraphView({ view, selectedId, onSelect, ripple, totalNodes }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tip, setTip] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const simRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const prevSize = useRef({ w: 0, h: 0 });
  const fitted = useRef(false);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const viewRef = useRef(view);
  viewRef.current = view;
  const linksSelRef = useRef<d3.Selection<SVGLineElement, SimLink, SVGGElement, unknown> | null>(null);
  const nodesSelRef = useRef<d3.Selection<SVGGElement, SimNode, SVGGElement, unknown> | null>(null);


  /**
   * 选中态只是"改样式"：点节点不该让整张图重新布局。
   * 这里直接操作已经 join 好的 selection，不触发 simulation。
   */
  const applySelection = (sid: string | null) => {
    const nodeSel = nodesSelRef.current;
    if (!nodeSel) return;

    const neighborIds = new Set<string>();
    if (sid) {
      neighborIds.add(sid);
      for (const l of viewRef.current.links) {
        if (l.source === sid) neighborIds.add(l.target);
        if (l.target === sid) neighborIds.add(l.source);
      }
    }

    nodeSel
      .classed('is-dim', (d) => d.dimmed || (Boolean(sid) && !neighborIds.has(d.id)))
      .classed('is-selected', (d) => d.id === sid);

    nodeSel
      .select<SVGTextElement>('text.node-label')
      .attr('display', (d) => (shouldLabel(d.node) || d.id === sid ? null : 'none'))
      .attr('class', (d) => `node-label ${d.id === sid ? 'is-strong' : ''}`);

    linksSelRef.current?.attr('stroke-opacity', (d) => {
      if (d.dimmed) return d.opacity * 0.12;
      if (!sid) return d.opacity * 0.75;
      return d.source === sid || d.target === sid
        ? Math.min(1, d.opacity + 0.25)
        : d.opacity * 0.22;
    });
  };

  // 尺寸跟随容器
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);
      // 值没变就别 setState：手机上地址栏收放、滚动条出现都会触发 ResizeObserver，
      // 每次新建对象会让下面的布局 effect 白跑一遍，画面就抖
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);

  // 一次性搭好 svg 结构：defs / 缩放 / 两个图层
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const defs = svg.append('defs');
    const glow = defs
      .append('filter')
      .attr('id', 'soft-glow')
      .attr('x', '-120%')
      .attr('y', '-120%')
      .attr('width', '340%')
      .attr('height', '340%');
    glow.append('feGaussianBlur').attr('stdDeviation', 5).attr('result', 'blur');
    const merge = glow.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    defs
      .append('marker')
      .attr('id', 'arrow-evolves')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', 5)
      .attr('markerHeight', 5)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-4L9,0L0,4')
      .attr('fill', '#ffd479')
      .attr('opacity', 0.75);

    const root = svg.append('g').attr('class', 'root');
    root.append('g').attr('class', 'links');
    root.append('g').attr('class', 'nodes');

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.25, 4])
      .on('zoom', (event) => {
        root.attr('transform', event.transform.toString());
      });
    svg.call(zoom);
    zoomRef.current = zoom;

    svg.on('click', (event) => {
      if (event.target === svgEl) onSelectRef.current(null);
    });

    return () => {
      svg.on('.zoom', null);
      svg.selectAll('*').remove();
    };
  }, []);

  // 数据变化 → 重新布局与绘制
  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl || size.w === 0) return;
    const svg = d3.select(svgEl);
    const root = svg.select<SVGGElement>('g.root');
    const gLinks = root.select<SVGGElement>('g.links');
    const gNodes = root.select<SVGGElement>('g.nodes');

    // 只有尺寸真的换了一个量级（横竖屏切换、桌面↔手机）才丢掉旧坐标重新布局。
    // 手机上地址栏收起只会让高度变 ~10%，那种程度应该让布局温和地收敛过去，而不是重排。
    const prev = prevSize.current;
    let softResize = false;
    if (prev.w > 0) {
      const wJump = Math.abs(prev.w - size.w) / Math.max(prev.w, 1);
      const hJump = Math.abs(prev.h - size.h) / Math.max(prev.h, 1);
      if (wJump > 0.35 || hJump > 0.35) {
        // 横竖屏切换 / 桌面↔手机：整张图重排
        positions.current.clear();
        fitted.current = false;
      } else if (prev.w !== size.w || prev.h !== size.h) {
        // 手机地址栏收放这类小变化：把坐标按容器比例一起缩放，
        // 视觉上就是图跟着窗口收放，而不是打乱重排
        const sx = size.w / prev.w;
        const sy = size.h / prev.h;
        const ocx = prev.w / 2;
        const ocy = prev.h / 2;
        const ncx = size.w / 2;
        const ncy = size.h / 2;
        for (const [id, pt] of positions.current) {
          positions.current.set(id, {
            x: ncx + (pt.x - ocx) * sx,
            y: ncy + (pt.y - ocy) * sy,
          });
        }
        softResize = true;
      }
    }
    prevSize.current = size;

    const simNodes: SimNode[] = view.nodes.map((v) => {
      const cached = positions.current.get(v.node.id);
      return {
        id: v.node.id,
        node: v.node,
        lum: v.lum,
        dimmed: v.dimmed,
        ...(cached ? { x: cached.x, y: cached.y } : {}),
      };
    });
    const simLinks: SimLink[] = view.links.map((l) => ({
      id: l.id,
      source: l.source,
      target: l.target,
      relation: l.relation,
      weight: l.weight,
      opacity: l.opacity,
      evaporating: l.evaporating,
      dimmed: l.dimmed,
    }));

    // ── 连线：底层实体 + 上层流动的光
    const baseLinks = gLinks
      .selectAll<SVGLineElement, SimLink>('line.link-base')
      .data(simLinks, (d) => d.id)
      .join('line')
      .attr('class', 'link link-base')
      .attr('stroke', (d) => LINK_COLOR[d.relation])
      .attr('stroke-width', (d) => 0.5 + d.weight * 1.9)
      .attr('stroke-opacity', (d) => (d.dimmed ? d.opacity * 0.12 : d.opacity * 0.75))
      .attr('marker-end', (d) => (d.relation === 'evolves' ? 'url(#arrow-evolves)' : null));

    // 节点一多，流光层会让连线 DOM 翻倍，而它只是装饰：超过阈值就只留静态连线
    const showPulse = simNodes.length <= 60;
    const pulseLinks = gLinks
      .selectAll<SVGLineElement, SimLink>('line.link-pulse')
      .data(showPulse ? simLinks : [], (d) => d.id)
      .join('line')
      .attr('class', (d) => `link link-pulse ${d.relation === 'evolves' ? 'link-evolves' : ''}`)
      .attr('stroke', (d) => LINK_COLOR[d.relation])
      .attr('stroke-width', (d) => 0.6 + d.weight * 1.1)
      .attr('stroke-opacity', (d) => {
        const base = d.evaporating ? d.opacity * 0.5 : d.opacity * 0.8;
        return d.dimmed ? base * 0.15 : base;
      });

    // ── 节点
    const nodeSel = gNodes
      .selectAll<SVGGElement, SimNode>('g.node')
      .data(simNodes, (d) => d.id)
      .join(
        (enter) => {
          const g = enter.append('g').attr('class', 'node node-new');
          g.append('circle').attr('class', 'halo');
          g.append('circle').attr('class', 'core');
          g.append('rect').attr('class', 'capsule');
          g.append('path').attr('class', 'frost');
          g.append('path').attr('class', 'spark');
          g.append('circle').attr('class', 'ring');
          g.append('circle').attr('class', 'hit');
          g.append('text').attr('class', 'node-label');
          return g;
        },
        (update) => update,
        (exit) => exit.remove(),
      );

    nodeSel.each(function (d) {
      const g = d3.select(this);
      const R = radiusOf(d.node);
      const color = colorOf(d.node);
      const lum = d.lum;
      const type = d.node.type;
      const isTheme = type === 'theme';
      const isEvent = type === 'event';
      const isRisk = type === 'risk_node';
      const isWish = type === 'wish';
      const isEntry = type === 'entry';

      g.select<SVGCircleElement>('circle.halo')
        .attr('r', R * (isTheme ? 2.6 : 2.1))
        .attr('fill', color)
        .attr('filter', isEntry ? null : 'url(#soft-glow)')
        .attr('opacity', isEntry ? 0 : (isTheme ? 0.1 : 0.16) * lum);

      g.select<SVGCircleElement>('circle.core')
        .attr('r', R)
        .attr('fill', isTheme ? 'transparent' : color)
        .attr('stroke', color)
        .attr('stroke-width', isTheme ? 1 : 0)
        .attr('stroke-opacity', isTheme ? 0.55 : 0)
        .attr('opacity', isTheme ? 0.16 * lum : (isWish ? 0.9 : 0.88) * lum);

      g.select<SVGRectElement>('rect.capsule')
        .attr('display', isEvent ? null : 'none')
        .attr('x', -R * 1.7)
        .attr('y', -R * 0.72)
        .attr('width', R * 3.4)
        .attr('height', R * 1.44)
        .attr('rx', R * 0.72)
        .attr('fill', 'rgba(20,30,54,0.85)')
        .attr('stroke', color)
        .attr('stroke-width', 1)
        .attr('stroke-opacity', 0.6 * lum)
        .attr('opacity', lum);

      // 危险念头：六瓣霜花，柔和不刺眼
      const frost = g.select<SVGPathElement>('path.frost');
      if (isRisk) {
        const spokes: string[] = [];
        for (let i = 0; i < 6; i += 1) {
          const a = (Math.PI / 3) * i;
          const x1 = Math.cos(a) * R * 0.5;
          const y1 = Math.sin(a) * R * 0.5;
          const x2 = Math.cos(a) * R * 2.1;
          const y2 = Math.sin(a) * R * 2.1;
          spokes.push(`M${x1.toFixed(2)},${y1.toFixed(2)}L${x2.toFixed(2)},${y2.toFixed(2)}`);
          const bx = Math.cos(a) * R * 1.5;
          const by = Math.sin(a) * R * 1.5;
          const px = Math.cos(a + Math.PI / 2) * R * 0.45;
          const py = Math.sin(a + Math.PI / 2) * R * 0.45;
          spokes.push(`M${bx.toFixed(2)},${by.toFixed(2)}L${(bx + px).toFixed(2)},${(by + py).toFixed(2)}`);
          spokes.push(`M${bx.toFixed(2)},${by.toFixed(2)}L${(bx - px).toFixed(2)},${(by - py).toFixed(2)}`);
        }
        frost.attr('d', spokes.join(' ')).attr('display', null).attr('stroke', color)
          .attr('stroke-width', 1.1).attr('stroke-linecap', 'round').attr('opacity', 0.75 * lum);
      } else {
        frost.attr('display', 'none');
      }

      // 念想：金色光点 + 十字星芒；已实现的再加一圈光晕
      const spark = g.select<SVGPathElement>('path.spark');
      if (isWish) {
        const s = R * 2.2;
        spark
          .attr('d', `M0,${-s}L0,${s}M${-s},0L${s},0`)
          .attr('display', null)
          .attr('stroke', color)
          .attr('stroke-width', d.node.achieved ? 1.6 : 0.9)
          .attr('opacity', (d.node.achieved ? 0.9 : 0.45) * lum);
      } else {
        spark.attr('display', 'none');
      }

      g.select<SVGCircleElement>('circle.ring')
        .attr('display', d.node.achieved && isWish ? null : 'none')
        .attr('r', R * 1.9)
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 0.8)
        .attr('stroke-opacity', 0.5 * lum);

      // 手指比鼠标粗：给一个比图形本身更大的透明命中区
      g.select<SVGCircleElement>('circle.hit')
        .attr('r', Math.max(R + 10, 24))
        .attr('fill', 'transparent')
        .attr('stroke', 'none');

      g.select<SVGTextElement>('text.node-label')
        .attr('display', shouldLabel(d.node) ? null : 'none')
        .attr('y', R + (isEvent ? 16 : 15))
        .attr('class', 'node-label')
        .text(shortLabel(d.node.name));
    });

    nodeSel.selectAll('*').attr('pointer-events', 'none');
    nodeSel
      .select<SVGCircleElement>('circle.hit')
      .attr('pointer-events', 'all')
      .style('cursor', 'pointer');
    nodeSel
      .select<SVGCircleElement>('circle.core')
      .attr('fill-opacity', (d) => (d.node.type === 'theme' ? 0 : undefined) as number);

    // ── 力导向
    // 手机屏幕小得多：斥力和连线长度按画布面积缩一缩，
    // 否则同一套桌面参数会把节点直接推出屏幕外
    const areaScale = Math.max(
      0.4,
      Math.min(1.15, Math.sqrt((size.w * size.h) / (1200 * 800))),
    );

    const sim = d3
      .forceSimulation<SimNode>(simNodes)
      .force(
        'link',
        d3
          .forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance((l) => (l.relation === 'evolves' ? 190 : 108) * areaScale)
          .strength((l) => 0.1 + l.weight * 0.22),
      )
      .force(
        'charge',
        d3.forceManyBody<SimNode>().strength((d) => (-280 - radiusOf(d.node) * 12) * areaScale),
      )
      .force(
        'collide',
        d3.forceCollide<SimNode>().radius((d) => radiusOf(d.node) + 34 * areaScale),
      )
      .force('center', d3.forceCenter(size.w / 2, size.h / 2))
      .force('x', d3.forceX(size.w / 2).strength(0.03))
      .force('y', d3.forceY(size.h / 2).strength(0.03))
      .alpha(simNodes.length > 0 && !softResize ? 0.45 : 0)
      .alphaDecay(0.035);

    simRef.current = sim;

    const drag = d3
      .drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        d.moved = 0;
        if (!event.active) sim.alphaTarget(0.18).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        d.moved = (d.moved ?? 0) + Math.abs(event.dx) + Math.abs(event.dy);
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    nodeSel
      .call(drag)
      .on('pointerenter', (event: PointerEvent, d) => {
        // 手指没有 hover：触摸设备上不弹浮层，否则会留一个擦不掉的提示框
        if (event.pointerType === 'touch') return;
        setTip({ x: event.clientX, y: event.clientY, node: d.node });
      })
      .on('pointerleave', () => setTip(null))
      .on('click', (event: MouseEvent, d) => {
        event.stopPropagation();
        if ((d.moved ?? 0) > 4) return;
        onSelectRef.current(d.id === selectedIdRef.current ? null : d.id);
      });

    let tickNo = 0;
    sim.on('tick', () => {
      baseLinks
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      pulseLinks
        .attr('x1', (d) => (d.source as SimNode).x ?? 0)
        .attr('y1', (d) => (d.source as SimNode).y ?? 0)
        .attr('x2', (d) => (d.target as SimNode).x ?? 0)
        .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      tickNo += 1;
      // 位置缓存只用来在重建时恢复起点，不必每帧都写
      if (tickNo % 6 === 0 || sim.alpha() < 0.02) {
        for (const n of simNodes) {
          if (typeof n.x === 'number' && typeof n.y === 'number') {
            positions.current.set(n.id, { x: n.x, y: n.y });
          }
        }
      }
    });

    nodesSelRef.current = nodeSel;
    linksSelRef.current = baseLinks;
    applySelection(selectedIdRef.current);

    if (softResize) {
      // 只是窗口尺寸变了：坐标已经按比例缩放好，直接落位，不跑力导向
      const put = (sel: typeof nodeSel) =>
        sel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
      put(nodeSel);
      for (const sel of [baseLinks, pulseLinks]) {
        sel
          .attr('x1', (d) => (d.source as SimNode).x ?? 0)
          .attr('y1', (d) => (d.source as SimNode).y ?? 0)
          .attr('x2', (d) => (d.target as SimNode).x ?? 0)
          .attr('y2', (d) => (d.target as SimNode).y ?? 0);
      }
    } else if (simNodes.length > 0) {
      sim.tick(40);
    }

    // 第一次把图铺出来时，自动缩放到刚好填满窗口（手机上尤其必要）
    if (simNodes.length > 0 && !fitted.current) {
      fitted.current = true;
      window.setTimeout(fitToView, 500);
    }

    return () => {
      sim.on('tick', null);
      sim.stop();
      if (simRef.current === sim) simRef.current = null;
    };
  }, [view, size]);

  // 选中/取消选中：只更新样式，完全不碰布局与 simulation
  useEffect(() => {
    applySelection(selectedId);
  }, [selectedId]);

  // 念想实现时的一次金色涟漪
  useEffect(() => {
    if (ripple === 0 || !svgRef.current) return;
    const root = d3.select(svgRef.current).select<SVGGElement>('g.root');
    const target = view.nodes.find((n) => n.node.type === 'wish' && n.node.achieved);
    const cached = target ? positions.current.get(target.node.id) : null;
    const ring = root
      .append('circle')
      .attr('class', 'ripple-ring')
      .attr('cx', cached?.x ?? size.w / 2)
      .attr('cy', cached?.y ?? size.h / 2)
      .attr('r', 12);
    const timer = setTimeout(() => ring.remove(), 2400);
    return () => {
      clearTimeout(timer);
      ring.remove();
    };
  }, [ripple, size.w, size.h]);

  /** 缩放到刚好把所有节点框进窗口。 */
  const fitToView = () => {
    const sim = simRef.current;
    const svgEl = svgRef.current;
    const zoom = zoomRef.current;
    if (!sim || !svgEl || !zoom || size.w === 0) return;

    const points = sim.nodes().filter(
      (n): n is SimNode & { x: number; y: number } =>
        typeof n.x === 'number' && typeof n.y === 'number',
    );
    if (points.length === 0) return;

    const xs = points.map((n) => n.x);
    const ys = points.map((n) => n.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = 140;
    const dx = Math.max(60, maxX - minX);
    const dy = Math.max(60, maxY - minY);
    const scale = Math.min((size.w - pad) / dx, (size.h - pad) / dy, 1.9);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const transform = d3.zoomIdentity
      .translate(size.w / 2, size.h / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(svgEl).transition().duration(650).call(zoom.transform, transform);
  };

  /**
   * 一键摊开：把节点沿环形重新撒一遍初始位置，再跑一次布局。
   * 只做 alpha 重启的话图会回到同一个平衡态，挤的还是挤。
   */
  const spread = () => {
    const sim = simRef.current;
    if (!sim) return;
    const nodes = sim.nodes();
    if (nodes.length === 0) return;

    const radius = Math.min(size.w, size.h) * 0.34;
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2;
      const r = radius * (0.75 + Math.random() * 0.5);
      n.x = size.w / 2 + Math.cos(angle) * r;
      n.y = size.h / 2 + Math.sin(angle) * r;
      n.vx = 0;
      n.vy = 0;
    });
    positions.current.clear();
    sim.alpha(1).alphaDecay(0.028).restart();
    window.setTimeout(fitToView, 900);
  };

  const emptyHint = useMemo(() => {
    if (totalNodes === 0) {
      return (
        <div className="graph-empty">
          <div>
            <strong>这里还没有神经元</strong>
            写下第一篇日志，让它们长出来
          </div>
        </div>
      );
    }
    if (view.nodes.length === 0) {
      return (
        <div className="graph-empty">
          <div>
            <strong>这个时刻还是空的</strong>
            换一个日期区间，或把隐藏的类型打开
          </div>
        </div>
      );
    }
    return null;
  }, [totalNodes, view.nodes.length]);

  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
      <Starfield />
      <svg ref={svgRef} className="graph-canvas" />
      {view.nodes.length > 0 && (
        <button
          type="button"
          className="graph-action"
          onClick={spread}
          title="把节点重新铺开一遍，并缩放到刚好填满窗口"
        >
          摊开
        </button>
      )}
      {emptyHint}
      {tip && (
        <div className="tooltip" style={{ left: tip.x + 14, top: tip.y + 12 }}>
          <div className="t-type">{TYPE_LABEL[tip.node.type]}</div>
          <div>{tip.node.name}</div>
          <div style={{ color: 'var(--ink-faint)', fontSize: 11, marginTop: 2 }}>
            {tip.node.count > 1 ? `出现过 ${tip.node.count} 次` : '出现过 1 次'} ·{' '}
            {tip.node.lastDate}
          </div>
        </div>
      )}
    </div>
  );
}
