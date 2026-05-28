/**
 * Root application shell. Orchestrates folder picking, graph processing,
 * and renders the CographCanvas with uniform containment navigation.
 */

import React, { useState, useCallback } from 'react';
import {
  GraphModel,
  walkDir,
  embedElements,
  buildClusters,
  labelBlocks,
  loadConfig,
  TransformersEmbedder,
  CoGraphConfig,
  CONFIG_DEFAULTS,
} from '@cograph/core';
import {
  CographCanvas,
  BreadcrumbNav,
  ColorMap,
  FilterPanel,
  TokenPanel,
  Metric,
  Filters,
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
    embedding: 'Embedding elements…',
    clustering: 'Grouping blocks…',
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
          <p style={{ fontSize: 12, color: '#aaa' }}>{done} / {total} elements</p>
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
  model: GraphModel;
  navStack: string[];
  metric: Metric;
  filters: Filters;
  onNavigateTo: (id: string) => void;
  onMetric: (m: Metric) => void;
  onFilters: (f: Filters) => void;
  onReset: () => void;
}

function Toolbar({ model, navStack, metric, filters,
  onNavigateTo, onMetric, onFilters, onReset }: ToolbarProps) {
  return (
    <div style={{
      position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
      background: 'rgba(255,255,255,0.94)', backdropFilter: 'blur(4px)',
      borderBottom: '1px solid #e0e0e0',
      padding: '8px 16px', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
    }}>
      <span style={{ fontWeight: 700, fontSize: 16, color: '#1565c0', marginRight: 4 }}>cograph</span>
      <div style={{ flex: 1, minWidth: 200 }}>
        <BreadcrumbNav model={model} navStack={navStack} onNavigateTo={onNavigateTo} />
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


// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const [model, setModel] = useState<GraphModel | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Navigation: a stack of container IDs — back = pop, forward = push
  const [navStack, setNavStack] = useState<string[]>(['folder::']);

  const [metric, setMetric] = useState<Metric>('language');
  const [filters, setFilters] = useState<Filters>({ edges: new Set(['similar']) });

  // Token panel: shown when an element node is clicked
  const [clickedElement, setClickedElement] = useState<{ id: string; tokens: string[] } | null>(null);

  const handlePick = useCallback(async (files: FileList) => {
    setErrorMsg(null);
    setPhase('scanning');
    try {
      const reader = new FileListReader(files);
      const cfg = await loadConfig(configStore);

      // Infer root folder name from FileList (webkitRelativePath = "root/sub/file.md")
      const rootName = Array.from(files)[0]?.webkitRelativePath?.split('/')[0] ?? 'project';

      const { model: scanned } = await walkDir('', reader, {
        chunkWindowSize: 256,
        chunkOverlap: 0.1,
      });

      // Patch root folder label — scanner emits '' when root path is empty
      scanned.updateNode('folder::', { label: rootName });

      const fileCount = scanned.nodesByKind('file').length;
      if (fileCount === 0) {
        throw new Error(
          'No text files found in this folder.\n' +
          'cograph supports: .md .txt .ts .tsx .js .jsx .py .rb .go .rs .json .yaml .html .css and more.\n' +
          'Images and binaries are skipped.',
        );
      }

      setPhase('embedding');
      const total = scanned.nodesByKind('element').length;
      setProgress({ done: 0, total });

      await embedElements(scanned, embedder, cfg.vectorCache, (done, t) =>
        setProgress({ done, total: t }),
      );

      setPhase('clustering');
      buildClusters(scanned);
      labelBlocks(scanned, cfg.labelOverrides);

      cfg.vectorCache.updatedAt = new Date().toISOString();
      await configStore.save(cfg);

      // Initialise navigation at the project root
      const root = projectRoot(scanned);
      setModel(scanned);
      setNavStack([root]);
      setPhase('done');
    } catch (err) {
      console.error('[cograph]', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, []);

  // Navigate into a child container
  const handleNavigateInto = useCallback((id: string) => {
    setNavStack((prev) => [...prev, id]);
  }, []);

  // Navigate to a specific ancestor (breadcrumb click — truncate stack)
  const handleNavigateTo = useCallback((id: string) => {
    setNavStack((prev) => {
      const idx = prev.lastIndexOf(id);
      return idx >= 0 ? prev.slice(0, idx + 1) : [...prev, id];
    });
  }, []);

  // Back arrow — pop one level
  const handleBack = useCallback(() => {
    setNavStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  // Element click — open token panel
  const handleElementClick = useCallback((id: string, tokens: string[]) => {
    setClickedElement({ id, tokens });
  }, []);

  const handleReset = () => { setModel(null); setPhase('idle'); setErrorMsg(null); };

  // ── Render ──────────────────────────────────────────────────────────────────

  const isProcessing = phase === 'scanning' || phase === 'embedding' || phase === 'clustering';
  const selectedId = navStack[navStack.length - 1] ?? 'folder::';
  const canGoBack = navStack.length > 1;

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
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <Toolbar
        model={model} navStack={navStack} metric={metric} filters={filters}
        onNavigateTo={handleNavigateTo} onMetric={setMetric}
        onFilters={setFilters} onReset={handleReset}
      />
      {/* Canvas fills remaining height; back arrow floats left of canvas */}
      <div style={{ flex: 1, minHeight: 0, marginTop: 50, position: 'relative' }}>
        {/* Back arrow */}
        {canGoBack && (
          <button
            onClick={handleBack}
            title="Back"
            style={{
              position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
              zIndex: 5, width: 32, height: 32, borderRadius: '50%',
              border: '1px solid #ccc', background: 'rgba(255,255,255,0.9)',
              cursor: 'pointer', fontSize: 18, display: 'flex',
              alignItems: 'center', justifyContent: 'center', color: '#555',
            }}
          >‹</button>
        )}
        <CographCanvas
          model={model} selectedId={selectedId}
          metric={metric} filters={filters}
          onNavigateInto={handleNavigateInto}
          onElementClick={handleElementClick}
        />
        <TokenPanel
          elementId={clickedElement?.id ?? null}
          tokens={clickedElement?.tokens ?? []}
          onClose={() => setClickedElement(null)}
        />
      </div>
    </div>
  );
}
