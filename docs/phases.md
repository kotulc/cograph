# cograph — Implementation Phases

Each phase produces working, tested, mergeable code. Phases build on each other; the rough
duration assumes one focused developer.

---

## Running Tests & Verifying the App

### Full suite (run from monorepo root)

```sh
pnpm turbo build test lint
```

Turborepo runs packages in dependency order (`core` → `renderer` → `vscode`/`app`) and caches
unchanged outputs. A clean run rebuilds everything; subsequent runs only rebuild what changed.

### Per-package (faster during active development)

```sh
pnpm --filter @cograph/core      test   # unit + integration tests for core engine
pnpm --filter @cograph/renderer  test   # component tests (vitest + jsdom)
pnpm --filter @cograph/vscode    build  # compiles the extension bundle
pnpm --filter @cograph/app       build  # compiles the browser SPA
```

### Watch mode (during a phase)

```sh
pnpm --filter @cograph/core test --watch
```

### Visual verification

| Context | Command |
|---------|---------|
| Renderer (Storybook / Vite preview) | `pnpm --filter @cograph/renderer dev` |
| Browser SPA | `pnpm --filter @cograph/app build && npx serve packages/app/dist` |
| VS Code extension | `vsce package` → Install VSIX → run `cograph: Open Graph` |

---

## Phase 0 — Scaffold (~1 day)

**Goal:** A runnable monorepo where every package can build, lint, and test from the start.

### Tasks
- Initialize `pnpm-workspace.yaml` and root `package.json` with Turborepo
- Create four packages (`core`, `renderer`, `vscode`, `app`) each with:
  - `package.json` (name, scripts: `build`, `test`, `lint`)
  - `tsconfig.json` extending `../../tsconfig.base.json`
  - `vitest.config.ts` (for `core` and `renderer`)
  - Placeholder `src/index.ts` with a single exported constant
- Shared `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc` at root
- `turbo.json` with `build → test → lint` pipeline and dependency graph
- GitHub Actions CI: `pnpm install` + `pnpm turbo build test lint` on push
- Commit `docs/` directory with the three planning files

### Verify

```sh
pnpm turbo build test lint
# Expected: zero errors, zero warnings, all placeholder tests pass
```

---

## Phase 1 — Core: Scanner + Graph Model (~3 days)

**Goal:** The engine can walk a directory, chunk file contents, and produce a typed in-memory graph
with structural `contains` edges.

### Tasks

**`core/chunker.ts`**
- `IChunker` interface: `chunk(text: string, windowSize: number, overlap: number): string[]`
- `FixedWindowChunker`: splits raw text into overlapping fixed-size windows (default 256 tokens,
  10 % overlap); works on any plain-text content regardless of file type
- Export `defaultChunker: IChunker` as the package default

**`core/scanner.ts`**
- `walkDir(root: string, reader: IFileReader, chunker: IChunker, opts?: ScanOptions): Promise<GraphModel>`
- Emit a `folder` node for every directory and a `file` node for every non-binary text file;
  detect language via extension map; emit `contains` edges folder → child
- For each file, run `chunker.chunk(text)` and emit one `chunk` node per segment;
  emit `contains` edges file → chunk; no content or path stored on the `file` node itself
- Respect `.gitignore` (via `ignore` npm package) and a user-supplied ignore list
- Skip binary files (null-byte heuristic) and files over `maxFileSizeBytes`
- Maintain a separate operational `pathIndex: Map<string, string>` (path → node id) for I/O;
  never store paths as node properties

**`core/graph.ts`**
- `GraphModel` class:
  - `addNode(node: GraphNode)` / `removeNode(id: string)`
  - `addEdge(edge: GraphEdge)` / `removeEdge(id: string)`
  - `neighbors(id: string, kind?: EdgeKind): GraphNode[]`
  - `children(id: string): GraphNode[]` — shorthand for `contains` neighbors
  - `subgraph(ids: string[]): GraphModel`
  - `toJSON()` / `static fromJSON()`
- Internal adjacency index (Map-based, O(1) lookup)

**`core/config.ts`**
- Zod schema for `CoGraphConfig`
- `loadConfig(store: IConfigStore): Promise<CoGraphConfig>`
- `saveConfig(store: IConfigStore, config: CoGraphConfig): Promise<void>`
- `mergeDefaults(partial: Partial<CoGraphConfig>): CoGraphConfig`

**Tests** (`core/tests/`)
- `chunker.test.ts`: fixed-window produces correct segment count and overlap; empty input; single-chunk input
- `scanner.test.ts`: walk a fixture directory tree; assert `folder`, `file`, and `chunk` node counts;
  assert `contains` edge structure; assert gitignore exclusion; assert no path on node meta
- `graph.test.ts`: CRUD operations, adjacency queries, `children()`, JSON round-trip
- `config.test.ts`: Zod rejects bad shapes; defaults applied correctly

### Verify

```sh
pnpm --filter @cograph/core test
# Expected: chunker, scanner, graph, config test suites all pass
```

---

## Phase 2 — Core: Embeddings + Two-Pass Clustering (~4 days)

**Goal:** Chunk nodes are embedded; a two-pass agglomeration produces a local cluster tree per
file and a global cluster tree across files, connected to the graph via `merges` edges.

### Tasks

**`core/embed.ts`**
- `EmbeddingProvider` interface: `embed(texts: string[]): Promise<Float32Array[]>`
- `TransformersEmbedder` implementing the interface:
  - Lazy-loads `all-MiniLM-L6-v2` via `@xenova/transformers` on first call
  - Batches inputs to avoid OOM (configurable `batchSize`)
  - Returns normalized unit vectors
- `embedChunks(model: GraphModel, provider: EmbeddingProvider, cache: VectorCache): Promise<void>`
  — mutates `chunk.vector` in place; skips chunks whose file `mtime` is not newer than cache timestamp

**`core/cluster.ts`**
- `cosine(a: Float32Array, b: Float32Array): number` — 1 − dot product (vectors are pre-normalized)
- **Pass 1** — `clusterFileChunks(fileId: string, model: GraphModel): void`
  - Retrieves all chunk children of the file from the graph
  - Runs bottom-up average-linkage HAC on chunk vectors
  - Adds `cluster` nodes (scope: `local`) and `merges` edges to `model`
  - Stores the root cluster's mean vector as `file.meta.representative`
- **Pass 2** — `clusterFiles(model: GraphModel, opts?: ClusterOpts): void`
  - Collects all file representatives from the graph
  - Uses exact pairwise HAC below `opts.hnswThreshold` (default 5 000 files);
    switches to HNSW approximate nearest-neighbour (`hnswlib-node`) above threshold
  - Adds `cluster` nodes (scope: `global`) and `merges` edges to `model`
- `buildClusters(model: GraphModel, provider: EmbeddingProvider, opts?): Promise<void>`
  — orchestrates embed → Pass 1 per file → Pass 2

**`core/label.ts`**
- `tfidfLabel(memberIds: string[], model: GraphModel, topN: number): string`
  — compute TF-IDF across chunk content of all members; return top-N terms
- `suggestLabels(clusterId: string, model: GraphModel, n: number): string[]`
  — return `n` alternatives by varying `topN` and stop-word lists

**`core/suggest.ts`**
- `suggestEdges(model: GraphModel, k: number, dismissed: string[]): GraphEdge[]`
  — return top-K file-representative pairs with high cosine similarity, not already linked,
    not in `dismissed`; these surface as phantom `reference` edges in the UI

**Tests**
- `embed.test.ts`: embed 10 short strings; assert unit-norm; semantically similar strings cosine > 0.7
- `cluster.test.ts`:
  - Pass 1: single file with 5 chunks produces a 3-level local cluster tree
  - Pass 2: 20 fixture files produce a global tree with depth ≥ 2; all files assigned
  - All `merges` edges point from cluster → member; no `semantic` edges exist
- `label.test.ts`: top TF-IDF terms are present in member chunk content
- Performance: 500 files × 5 chunks each → full `buildClusters` completes under 30 s
  (`vitest --reporter=verbose`, skipped in CI with `test.skip` if no GPU)

### Verify

```sh
pnpm --filter @cograph/core test
# Integration smoke: point at a real local folder via a Node script:
# npx ts-node packages/core/tests/smoke.ts <path-to-folder>
# Expected: prints node/edge counts + top-level global cluster labels
```

---

## Phase 3 — Renderer: Static Graph View (~3 days)

**Goal:** A React component takes a `GraphModel` and renders a static, pannable, zoomable
Cytoscape graph in both structural and semantic layout modes.

### Tasks

**`renderer/useGraphModel.ts`**
- Hook: `useGraphModel(model: GraphModel, layout: 'structural' | 'semantic', level: number)`
  → `{ elements: CytoscapeElements }`
- **Structural mode**: maps `contains` hierarchy; compound parents are folders and files
- **Semantic mode**: maps `merges` hierarchy at the given agglomeration `level`;
  compound parents are global then local clusters
- Maps `GraphEdge` → Cytoscape edge with weight-based width; filters edge kinds by mode
- Re-derives elements when `model`, `layout`, or `level` changes

**`renderer/CographCanvas.tsx`**
- Mounts a Cytoscape instance to a `div` ref via `useEffect`
- Registers `fcose` layout; calls `cy.layout({ name: 'fcose', ... }).run()` on element change
- Exposes `onNodeClick`, `onClusterClick`, `onNodeDblClick` callbacks via props
- Node tooltip (HTML overlay) on hover showing `kind`, `meta.language` (files),
  `meta.position` (chunks), `meta.mergeScore` (clusters)

**Cytoscape stylesheet**
- `chunk` nodes: small filled circle, muted color
- `file` nodes: medium circle, color = language hash by default
- `folder` nodes: square with folder badge
- `cluster` compound nodes: rounded rectangle hull, semi-transparent fill
  (darker for `global`, lighter for `local`)
- `contains` edges: dashed, medium weight
- `merges` edges: solid, weight proportional to `mergeScore`

**Tests**
- `CographCanvas.test.tsx` (vitest + jsdom): mount with 10-node fixture; assert container created;
  snapshot the generated Cytoscape element array for both layout modes

### Verify

```sh
pnpm --filter @cograph/renderer test
pnpm --filter @cograph/renderer dev
# Visual: fixture graph renders; layout toggle switches between structural and semantic views
```

---

## Phase 4 — Renderer: Navigation, Color Mapping & Filtering (~4 days)

**Goal:** The graph is fully interactive — layout mode toggle, layer navigation, drill-down,
color metrics, type filters, and semantic search all work.

### Tasks

**`renderer/LayoutToggle.tsx`**
- Two-button toggle: `Structural` / `Semantic`; updates `activeLayout` in config on change

**`renderer/LayerNav.tsx`**
- Depth slider bound to agglomeration `level` state; triggers `useGraphModel` re-render
- Breadcrumb: tracks drill-down path as `string[]`; each crumb is a clickable link
- Click-to-drill handler on `CographCanvas.onClusterClick`: pushes cluster id to breadcrumb,
  zooms Cytoscape into the clicked compound node's children

**`renderer/ColorMap.tsx`**
- Metric dropdown: `degree | tightness | chunkCount | language | searchDistance`
- On change: compute per-node scalar, normalize 0–1, map through `chroma-js` scale
- Apply colors via `cy.batch()`
- Legend: gradient bar with min/max labels

**`renderer/FilterPanel.tsx`**
- Checkboxes for node kinds: `folder`, `file`, `chunk`, `cluster`
- Checkboxes for edge kinds: `contains`, `merges`, `reference`
- On change: `ele.style('display', show ? 'element' : 'none')`
- Persists filter state to `CoGraphConfig` on each change

**`renderer/SearchBar.tsx`**
- Debounced text input (200 ms)
- On commit: calls `provider.embed([query])`, computes cosine distance from each `chunk.vector`,
  aggregates to file/cluster level by mean, writes as `searchDistance` metric
- Automatically switches `ColorMap` to `searchDistance`

**Tests**
- `LayoutToggle.test.tsx`: toggle updates layout mode in hook output
- `LayerNav.test.tsx`: slider change updates cluster depth; drill-down pushes breadcrumb
- `ColorMap.test.tsx`: metric change produces a different color assignment
- `FilterPanel.test.tsx`: unchecking `chunk` hides all chunk nodes; unchecking `merges` hides merges edges

### Verify

```sh
pnpm --filter @cograph/renderer test
pnpm --filter @cograph/renderer dev
# Storybook/preview story demonstrates: layout toggle, layer collapse/expand,
# drill-down with breadcrumb, live search coloring, type filter toggling
```

---

## Phase 5 — Renderer: Edit Operations (~3 days)

**Goal:** Users can rename nodes and cluster labels, drag file nodes between global clusters,
and undo any action.

### Tasks

**`renderer/EditOverlay.tsx`**
- Double-click on any node/cluster label → inline `<input>` positioned over the node
- On blur or Enter: dispatch `renameNode(id, newLabel)`
- On Escape: cancel without mutation

**Drag-to-recluster**
- Register `cytoscape-compound-drag-and-drop` on the Cytoscape instance
- Drop onto a global cluster compound: dispatch `overrideMembership(fileId, newGlobalClusterId)`
- Disallow drops onto local clusters (files are the unit of global membership)

**Command stack (undo/redo)**
- `useEditHistory` hook backed by `immer`-patched `GraphModel` snapshot list
- `dispatch(action)` applies the action and pushes an inverse patch
- `undo()` / `redo()` replay patches
- Keyboard: `Ctrl+Z` / `Ctrl+Shift+Z`

**Config sync**
- Every dispatch calls `configStore.save(config)` with updated `labelOverrides` / `membershipOverrides`
- React context provides `configStore` to all editing components

**Tests**
- `EditOverlay.test.tsx`: double-click → input appears → blur → label updated in model
- `useEditHistory.test.ts`: dispatch → undo → redo restores correct state in both directions

### Verify

```sh
pnpm --filter @cograph/renderer test
# Manual on fixture graph:
# 1. Rename a file node → confirm label change
# 2. Drag file to different global cluster → confirm membership update
# 3. Ctrl+Z twice → both changes reversed
# 4. Ctrl+Shift+Z twice → both changes reapplied
```

---

## Phase 6 — VS Code Extension (~3 days)

**Goal:** `cograph: Open Graph` opens a fully functional webview panel inside VS Code.

### Tasks

**`vscode/extension.ts`**
- `activate(context)`: registers the `cograph.openGraph` command
- Command handler: creates or reveals a `WebviewPanel`; passes workspace root to the panel

**`vscode/WebviewPanel.ts`**
- Generates webview HTML with the renderer SPA bundle (loaded from `extensionPath`)
- Posts `{ type: 'init', graph: model.toJSON(), config }` on load
- Listens for `{ type: 'edit', ... }` messages from the webview → applies via `VscodeConfig`

**`vscode/VscodeScanner.ts`**
- Implements `IFileReader` using `vscode.workspace.findFiles` + `vscode.workspace.fs.readFile`

**`vscode/VscodeConfig.ts`**
- Implements `IConfigStore` using `vscode.workspace.fs` on `.cograph.json`
- File watcher: `createFileSystemWatcher('**/*')` → on change, re-runs Pass 1 for changed file,
  updates Pass 2 incrementally, posts updated elements to webview

**`vscode/package.json`**
- `contributes.commands`: `cograph.openGraph`
- `activationEvents`: `onCommand:cograph.openGraph`
- `engines.vscode`: `^1.90.0`

### Verify

```sh
pnpm --filter @cograph/vscode build
vsce package
# Install the .vsix in VS Code (Extensions → … → Install from VSIX)
# Open a TypeScript project → Command Palette → "cograph: Open Graph"
# Confirm: graph renders with correct node/cluster hierarchy
# Edit a file → confirm incremental re-embed without reload
```

---

## Phase 7 — Browser SPA (~2 days)

**Goal:** The same experience runs in a plain browser tab with no VS Code dependency.

### Tasks

**`app/FolderPicker.tsx`**
- `<FolderPicker onPick={(handle) => ...}>` button
- Calls `window.showDirectoryPicker()` → `FileSystemDirectoryHandle`
- Implements `IFileReader` by recursively calling `handle.values()` + `file.text()`

**`app/BrowserConfig.ts`**
- Implements `IConfigStore` via `localStorage` (key: `cograph:config`)
- Export button: `Blob` + `URL.createObjectURL` → `<a download=".cograph.json">`
- Import button: `<input type="file">` reads a dropped `.cograph.json` → hydrates `localStorage`

**`app/App.tsx`**
- No folder: show centered `<FolderPicker>`
- Folder picked: run `buildClusters` in a Web Worker (off main thread)
- Render `<CographCanvas>` + all panels in full-viewport flex layout
- Progress bar while embedding runs (Worker posts progress messages)

**Vite config**
- `optimizeDeps.exclude: ['@xenova/transformers']` — avoids pre-bundling the ONNX runtime
- `worker.format: 'es'`

### Verify

```sh
pnpm --filter @cograph/app build
npx serve packages/app/dist
# Open http://localhost:3000 in browser
# Pick a local folder → graph renders with structural and semantic views
# Reload page → config and layout persist via localStorage
# Click export → .cograph.json downloads correctly
```

---

## Phase 8 — Suggestions, Performance & Polish (~3 days)

**Goal:** Surface suggestions, validate all NFRs at scale, and ship a demo.

### Tasks

**`renderer/SuggestPanel.tsx`**
- Collapsible drawer listing phantom edges and alternative cluster labels
- Accept button: promotes phantom edge to a permanent `reference` edge; persists to `acceptedEdges`
- Dismiss button: adds to `dismissedSuggestions`; never shown again
- Cluster label tooltip: three alternatives from `suggestLabels`; click to apply → `labelOverrides`

**Performance validation**
- Profile on a real 5 000-file TypeScript monorepo
- Optimize embed batching with `Promise.allSettled` + concurrency limiter
- Defer Pass 2 HAC to a Worker in browser and VS Code webview contexts
- Benchmark targets: full initial load < 60 s, incremental re-embed < 2 s, interactions < 200 ms

**Keyboard shortcuts**
- `[` / `]`: decrease / increase agglomeration level
- `/`: focus search bar
- `Ctrl+Z` / `Ctrl+Shift+Z`: undo / redo
- `Escape`: close panel or drill back up one level

**Documentation & demo**
- `README.md`: install, screenshot, feature list
- Demo GIF from the browser app on a real project
- `gh-pages` deploy of the browser SPA

### Verify

```sh
pnpm turbo build test lint
# All packages build and test cleanly

pnpm --filter @cograph/core test --reporter=verbose
# Performance tests pass (embed + two-pass cluster under 60 s on 5 000-file fixture)

# Manual checklist against requirements.md:
# FR-01 through FR-28 — each verifiably implemented
# NFR-01 through NFR-08 — measured and confirmed
```

---

## Dependency Graph

```
Phase 0 (scaffold)
  └─ Phase 1 (scanner + chunker + graph model)
       └─ Phase 2 (embed + two-pass cluster)
            ├─ Phase 3 (static canvas)
            │    └─ Phase 4 (nav + color + filter + layout toggle)
            │         └─ Phase 5 (edit ops)
            │              ├─ Phase 6 (vscode)
            │              └─ Phase 7 (browser app)
            └─ Phase 6 (vscode) — also needs Phase 3–5
```

Phases 6 and 7 can be developed in parallel once Phase 5 is complete.
Phase 8 can begin once both Phase 6 and Phase 7 are done.
