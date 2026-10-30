export const NODE_TYPES = [
  'emotion',
  'person',
  'event',
  'trigger',
  'theme',
  'wish',
  'risk_node',
  'entry',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const RELATIONS = ['triggered', 'involves', 'belongs_to', 'evolves', 'co_occurs'] as const;

export type Relation = (typeof RELATIONS)[number];

/** 可视类型的中文名，用于过滤栏与详情栏。 */
export const TYPE_LABEL: Record<NodeType, string> = {
  emotion: '情绪',
  person: '人物',
  event: '事件',
  trigger: '触发物',
  theme: '主题',
  wish: '念想',
  risk_node: '危险念头',
  entry: '日志锚点',
};

export const RELATION_LABEL: Record<Relation, string> = {
  triggered: '引发',
  involves: '涉及',
  belongs_to: '归属',
  evolves: '演变',
  co_occurs: '共现',
};

/** 某个节点在一次日志里的一次出现。 */
export interface Appearance {
  date: string;
  quote: string;
  entryId: string;
  /** emotion 才有：该次出现的强度 1~5。 */
  intensity?: number;
  /** emotion 才有：该次出现的极性 -5~5。 */
  polarity?: number;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  /** 出现次数（= appearances.length）。 */
  count: number;
  firstDate: string;
  lastDate: string;
  appearances: Appearance[];
  /** emotion 最近一次的极性与强度，用于上色与发光强度。 */
  polarity?: number;
  intensity?: number;
  /** wish 是否已实现。 */
  achieved?: boolean;
  achievedAt?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relation: Relation;
  weight: number;
  count: number;
  firstDate: string;
  lastDate: string;
}

export interface Graph {
  nodes: Record<string, GraphNode>;
  edges: Record<string, GraphEdge>;
}

/** LLM 解析出的单篇原始结构。 */
export interface ParsedNode {
  type: NodeType;
  name: string;
  polarity?: number;
  intensity?: number;
  quote?: string;
  date?: string;
  achieved?: boolean;
}

export interface ParsedEdge {
  source: string;
  target: string;
  relation: Relation;
  weight?: number;
}

export interface ParsedLog {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
}

/** 一篇日志 = 原文 + 它被解析出的结构（图谱由这些结构重建，改一篇就重建一次）。 */
export interface LogEntry {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  text: string;
  createdAt: number;
  parsed: ParsedLog;
}

export type ViewMode = 'graph' | 'compose' | 'settings';
