/**
 * Root application shell. Orchestrates folder picking, graph processing,
 * and renders the CographCanvas with depth navigation and root selection.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  GraphModel,
  walkDir,
  embedChunks,
  buildClusters,
  labelClusters,
  loadConfig,
  TransformersEmbedder,
  CoGraphConfig,
  CONFIG_DEFAULTS,
} from '@cograph/core';
import {
  CographCanvas,
  DepthNav,
  ColorMap,
  FilterPanel,
  BreadcrumbItem,
  Metric,
  Filters,
  maxUsefulDepth,
  projectRoot,
} from '@cograph/renderer';
import { FolderPicker } from './FolderPicker.js';
import { FileListReader } from './FileListReader.js';
import { BrowserConfig } from './BrowserConfig.js';

const embedder = new TransformersEmbedder();
const configStore = new BrowserConfig();

type Phase = 'idle' | 'scanning' | 'embedding' | 'clustering' | 'done' | 'error';


// ── Progress / error overlay ──────────────────────────────────────────────────

function StatusOverlay({ phase, done, total, error }: {
  phase: Phase; done: number; total: number; error: string | null;
}) {
  const labels: Partial<Record<Phase, string>> = {
    scanning: 'Scanning files…',
    embedding: 'Embedding chunks…',
    clustering: 'Clustering…',
    error: 'Something went wrong',
  };
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 16,
    }}>
      <p style={{ fontSize: 16, color: phase === 'error' ? '#c62828' : '#555' }}>
        {labels[phase] ?? ''}
      </p>
      {total > 0 && phase !== 'error' && (
        <>
          <div style={{ width: 240, height: 6, background: '#e0e0e0', borderRadius: 3 }}>
            <div style={{
              width: `${pct}%`, height: '100%', background: '#1565c0',
              borderRadius: 3, transition: 'width 0.2s',
            }} />
          </div>
          <p style={{ fontSize: 12, color: '#aaa' }}>{done} / {total} chunks</p>
        </>
      )}
      {error && (
        <pre style={{
          maxWidth: 480, fontSize: 12, color: '#c62828', background: '#fff3e0',
          padding: '8px 12px', borderRadius: 4, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>
          {error}
        </pre>
      )}
    </div>
  );
}


// ── Toolbar ───────────────────────────────────────────────────────────────────

interface ToolbarProps {
  depth: number;
  maxDepth: number;
  breadcrumb: BreadcrumbItem[];
  metric: Metric;
  filters: Filters;
  onDepth: (n: number) => void;
  onBreadcrumbClick: (id: string) => void;
  onMetric: (m: Metric) => void;
  onFilters: (f: Filters) => void;
  onReset: () => void;
}

function Toolbar({ depth, maxDepth, breadcrumb, metric, filters,
  onDepth, onBreadcrumbClick, onMetric, onFilters, onReset }: ToolbarProps) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
      background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(4px)',
      borderBottom: '1px solid #e0e0e0',
      padding: '8px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 700, fontSize: 16, color: '#1565c0', marginRight: 4 }}>cograph</span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <DepthNav
          depth={depth} maxDepth={maxDepth} breadcrumb={breadcrumb}
          onChange={onDepth} onBreadcrumbClick={onBreadcrumbClick}
        />
      </div>
      <ColorMap metric={metric} onChange={onMetric} />
      <FilterPanel filters={filters} onChange={onFilters} />
      <button
        onClick={onReset}
        style={{ marginLeft: 'auto', fontSize: 12, padding: '4px 10px',
          borderRadius: 4, border: '1px solid #ccc', cursor: 'pointer', background: '#fff' }}
      >
        ↩ reopen
      </button>
    </div>
  );
}


// ── Breadcrumb helpers ────────────────────────────────────────────────────────

/** Walks the parent chain from folderId back to the project root, building a breadcrumb. */
function buildBreadcrumb(model: GraphModel, folderId: string): BreadcrumbItem[] {
  const crumbs: BreadcrumbItem[] = [];
  let current = model.getNode(folderId);
  while (current) {
    crumbs.unshift({ id: current.id, label: current.label });
    current = model.parent(current.id);
  }
  return crumbs;
}


// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const [model, setModel] = useState<GraphModel | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Navigation state
  const [rootId, setRootId] = useState<string>('folder::');
  const [depth, setDepth] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);

  const [metric, setMetric] = useState<Metric>('language');
  const [filters, setFilters] = useState<Filters>({ edges: new Set(['similar']) });

  const handlePick = useCallback(async (files: FileList) => {
    setErrorMsg(null);
    setPhase('scanning');
    try {
      const reader = new FileListReader(files);
      const cfg = await loadConfig(configStore);

      const { model: scanned } = await walkDir('', reader, {
        chunkWindowSize: 256,
        chunkOverlap: 0.1,
      });

      const fileCount = scanned.nodesByKind('file').length;
      if (fileCount === 0) {
        throw new Error(
          'No text files found in this folder.\n' +
          'cograph supports: .md .txt .ts .tsx .js .jsx .py .rb .go .rs .json .yaml .html .css and more.\n' +
          'Images and binaries are skipped.',
        );
      }

      setPhase('embedding');
      const total = scanned.nodesByKind('chunk').length;
      setProgress({ done: 0, total });

      await embedChunks(scanned, embedder, cfg.vectorCache, (done, t) =>
        setProgress({ done, total: t }),
      );

      setPhase('clustering');
      buildClusters(scanned);
      labelClusters(scanned, cfg.labelOverrides);

      cfg.vectorCache.updatedAt = new Date().toISOString();
      await configStore.save(cfg);

      // Initialise navigation at the project root, depth 0
      const root = projectRoot(scanned);
      const md = maxUsefulDepth(scanned, root);
      setModel(scanned);
      setRootId(root);
      setDepth(0);
      setMaxDepth(md);
      setBreadcrumb(buildBreadcrumb(scanned, root));
      setPhase('done');
    } catch (err) {
      console.error('[cograph]', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  // Select a folder as the new navigation root (triggered by clicking a folder node)
  const handleFolderSelect = useCallback((id: string) => {
    if (!model) return;
    const node = model.getNode(id);
    if (!node || node.kind !== 'folder') return;
    const md = maxUsefulDepth(model, id);
    setRootId(id);
    setDepth(0);
    setMaxDepth(md);
    setBreadcrumb(buildBreadcrumb(model, id));
  }, [model]);

  // Breadcrumb navigation — click an ancestor folder
  const handleBreadcrumbClick = useCallback((id: string) => {
    if (!model) return;
    const md = maxUsefulDepth(model, id);
    setRootId(id);
    setDepth(0);
    setMaxDepth(md);
    setBreadcrumb(buildBreadcrumb(model, id));
  }, [model]);

  // Dispatch node clicks: folders → root selection; others → ignored for now
  const handleNodeClick = useCallback((id: string, kind: string) => {
    if (kind === 'folder') handleFolderSelect(id);
  }, [handleFolderSelect]);

  const handleReset = () => { setModel(null); setPhase('idle'); setErrorMsg(null); };

  // ── Render ──────────────────────────────────────────────────────────────────

  const isProcessing = phase === 'scanning' || phase === 'embedding' || phase === 'clustering';

  if (!model || phase === 'error') {
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        {isProcessing ? (
          <StatusOverlay phase={phase} done={progress.done} total={progress.total} error={null} />
        ) : phase === 'error' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', height: '100%', gap: 12 }}>
            <StatusOverlay phase={phase} done={0} total={0} error={errorMsg} />
            <button onClick={handleReset} style={{ padding: '8px 20px', borderRadius: 4,
              border: '1px solid #ccc', cursor: 'pointer', fontSize: 14 }}>
              ← Try again
            </button>
          </div>
        ) : (
          <FolderPicker onPick={handlePick} />
        )}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <Toolbar
        depth={depth} maxDepth={maxDepth} breadcrumb={breadcrumb}
        metric={metric} filters={filters}
        onDepth={setDepth} onBreadcrumbClick={handleBreadcrumbClick}
        onMetric={setMetric} onFilters={setFilters} onReset={handleReset}
      />
      <div style={{ paddingTop: 60, height: '100%' }}>
        <CographCanvas
          model={model} rootId={rootId} depth={depth}
          onNodeClick={handleNodeClick}
        />
      </div>
    </div>
  );
}
