import { useEffect, useMemo } from 'react';
import { store, useStore } from './store';
import { graphDateRange, selectView } from './lib/graph';
import FilterBar from './components/FilterBar';
import GraphView from './components/GraphView';
import ListView from './components/ListView';
import Timeline from './components/Timeline';
import NodeDetail from './components/NodeDetail';
import ComposeView from './components/ComposeView';
import SettingsView from './components/SettingsView';
import Notice from './components/Notice';

export default function App() {
  const state = useStore();

  useEffect(() => {
    void store.init();
  }, []);

  const view = useMemo(
    () =>
      selectView(state.graph, {
        highlight: state.filters.highlight,
        from: state.filters.from,
        to: state.filters.to,
        cursor: state.cursor,
      }),
    [state.graph, state.filters, state.cursor],
  );

  const range = useMemo(() => graphDateRange(state.graph), [state.graph]);
  const selected = state.selectedId ? state.graph.nodes[state.selectedId] ?? null : null;
  const nodeCount = Object.keys(state.graph.nodes).filter((id) => !id.startsWith('entry:')).length;

  if (!state.ready) {
    return <div className="loading-veil">心 络</div>;
  }

  return (
    <div className="app">
      <FilterBar
        filters={state.filters}
        mode={state.mode}
        nodeCount={nodeCount}
        entryCount={state.entries.length}
        onToggleHighlight={(t) => store.toggleHighlight(t)}
        onClearHighlight={() => store.clearHighlight()}
        onRange={(from, to) => store.setRange(from, to)}
        onMode={(m) => store.setMode(m)}
      />

      <div className="stage">
        {state.mode === 'graph' && (
          <GraphView
            view={view}
            selectedId={state.selectedId}
            onSelect={(id) => store.select(id)}
            ripple={state.ripple}
            totalNodes={nodeCount}
          />
        )}

        {state.mode === 'list' && <ListView onSelect={(id) => store.select(id)} />}

        {(state.mode === 'graph' || state.mode === 'list') && selected && (
          <NodeDetail
            node={selected}
            graph={state.graph}
            onClose={() => store.select(null)}
            onSelect={(id) => store.select(id)}
            onAchieve={(id) => void store.achieve(id)}
          />
        )}

        {state.mode === 'compose' && <ComposeView />}
        {state.mode === 'settings' && <SettingsView />}
      </div>

      {state.mode === 'graph' && (
        <Timeline
          range={range}
          cursor={state.cursor}
          playing={state.playing}
          disabled={false}
          onChange={(d) => store.setCursor(d)}
          onPlay={(on) => store.setPlaying(on)}
        />
      )}

      <Notice notice={state.notice} onClose={() => store.dismiss()} />
    </div>
  );
}
