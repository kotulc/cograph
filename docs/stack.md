# cograph — Stack & Project Structure

## Monorepo Topology

pnpm workspaces managed by Turborepo. Four packages share a single TypeScript config and toolchain root.

```
cograph/
├── packages/
│   ├── core/               # Pure TS engine — no DOM, no VS Code, no Node deps in public API
│   │   ├── src/
│   │   │   ├── scanner.ts      # FS walker → folder/file/chunk GraphNode[]  + contains edges
│   │   │   ├── chunker.ts      # IChunker interface + FixedWindowChunker
│   │   │   ├── graph.ts        # GraphModel class (nodes, edges, adjacency)
│   │   │   ├── embed.ts        # EmbeddingProvider interface + TransformersEmbedder
│   │   │   ├── cluster.ts      # Two-pass AgglomerativeClusterer → merges edges + cluster nodes
│   │   │   ├── label.ts        # TF-IDF cluster label generator
│   │   │   ├── suggest.ts      # suggestEdges / suggestLabels
│   │   │   ├── config.ts       # .cograph.json schema (Zod) + load/save
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── fixtures/       # Checked-in sample file trees for deterministic tests
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── renderer/           # React 18 + Cytoscape.js graph UI (browser-safe)
│   │   ├── src/
│   │   │   ├── CographCanvas.tsx   # Cytoscape mount, layout, element sync
│   │   │   ├── useGraphModel.ts    # Hook: GraphModel + layout mode → Cytoscape elements
│   │   │   ├── LayerNav.tsx        # Depth slider + breadcrumb
│   │   │   ├── LayoutToggle.tsx    # Structural / semantic layout mode switch
│   │   │   ├── ColorMap.tsx        # Metric selector + chroma-js scale + legend
│   │   │   ├── FilterPanel.tsx     # Node/edge type toggles
│   │   │   ├── SearchBar.tsx       # Query embed → distance color pass
│   │   │   ├── SuggestPanel.tsx    # Accept/dismiss phantom edges and alt labels
│   │   │   ├── EditOverlay.tsx     # Inline label edit, drag-to-recluster
│   │   │   └── index.ts
│   │   ├── tests/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── vscode/             # VS Code extension
│   │   ├── src/
│   │   │   ├── extension.ts        # activate(), registers cograph.openGraph
│   │   │   ├── WebviewPanel.ts     # WebviewPanelProvider, message bridge
│   │   │   ├── VscodeScanner.ts    # workspace.findFiles → core scanner adapter
│   │   │   └── VscodeConfig.ts     # workspace.fs read/write for .cograph.json
│   │   ├── package.json            # contributes.commands, engines.vscode
│   │   └── tsconfig.json
│   │
│   └── app/                # Browser-only Vite SPA
│       ├── src/
│       │   ├── App.tsx             # Shell: FolderPicker + CographCanvas + panels
│       │   ├── FolderPicker.tsx    # showDirectoryPicker → IFileReader adapter
│       │   └── main.tsx
│       ├── index.html
│       ├── package.json
│       └── tsconfig.json
│
├── docs/
│   ├── requirements.md
│   ├── stack.md
│   └── phases.md
│
├── .github/
│   └── workflows/
│       └── ci.yml              # build + test on push
│
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json          # shared TS config (strict, bundler moduleResolution)
├── eslint.config.mjs           # shared ESLint config
├── .prettierrc
└── package.json
```

---

## Package Responsibilities

| Package | What it owns | Depends on |
|---------|-------------|------------|
| `@cograph/core` | File scanning, chunking, embedding, two-pass clustering, graph model, TF-IDF labels, suggestions, config I/O | `@xenova/transformers`, `zod`, `hnswlib-node` |
| `@cograph/renderer` | All graph UI: canvas, controls, panels, color mapping, layout toggle, edit operations | `@cograph/core`, `cytoscape`, `react`, `chroma-js` |
| `@cograph/vscode` | Extension activation, webview host, VS Code FS adapter, file watcher | `@cograph/core`, `@cograph/renderer` (webview bundle), `vscode` |
| `@cograph/app` | Browser SPA shell, File System Access API adapter | `@cograph/core`, `@cograph/renderer` |

The `core` and `renderer` packages are strictly browser-safe — they import no Node.js built-ins.
Platform-specific I/O is injected via interfaces (`IFileReader`, `IConfigStore`) implemented in
`vscode` and `app`.

---

## Key Dependencies

| Dependency | Version | Package | Purpose |
|------------|---------|---------|---------|
| `cytoscape` | ^3.29 | renderer | Graph canvas and layout engine |
| `cytoscape-fcose` | ^2.2 | renderer | Fast compound spring-embedder layout |
| `cytoscape-compound-drag-and-drop` | ^1.0 | renderer | Drag nodes between compound parents |
| `@xenova/transformers` | ^2.17 | core | Local ONNX inference; `all-MiniLM-L6-v2` embeddings |
| `hnswlib-node` | ^3 | core | Approximate nearest-neighbour search for Pass 2 at scale |
| `chroma-js` | ^2.4 | renderer | Perceptual color scales for continuous metric mapping |
| `react` + `react-dom` | ^18 | renderer, app | Component model for UI panels and controls |
| `zod` | ^3.23 | core | Runtime schema validation for `.cograph.json` |
| `immer` | ^10 | renderer | Immutable patch-based undo/redo for `GraphModel` edits |
| `vscode` | ^1.90 (types) | vscode | VS Code extension API types |
| `vite` | ^5 | app, renderer | SPA bundler and library mode bundler |
| `esbuild` | ^0.21 | vscode | Extension bundle (CJS, no dynamic import) |
| `turbo` | ^2 | root | Monorepo build pipeline with caching |
| `vitest` | ^2 | core, renderer | Unit and integration tests |
| `typescript` | ^5.5 | all | Language |
| `eslint` + `prettier` | latest | all | Lint and format |

---

## Key Interfaces (`@cograph/core`)

```ts
// Chunker abstraction — swap in structure-aware implementations (v2) without changing callers
interface IChunker {
  chunk(text: string, windowSize: number, overlap: number): string[];
}

// Embedding abstraction — implemented by TransformersEmbedder; injected into embed.ts
interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
}

// File system abstraction — platform layer passes this to the scanner
interface IFileReader {
  readDir(path: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string>;
}

// Config persistence abstraction
interface IConfigStore {
  load(): Promise<CoGraphConfig | null>;
  save(config: CoGraphConfig): Promise<void>;
}

// ── Node kinds ────────────────────────────────────────────────────────────────

type NodeKind = 'folder' | 'file' | 'chunk' | 'cluster';

interface GraphNode {
  id:     string;
  kind:   NodeKind;
  label:  string;
  vector?: Float32Array;   // present on chunk nodes; absent on folder/file/cluster
  meta:   FolderMeta | FileMeta | ChunkMeta | ClusterMeta;
}

interface FolderMeta  { depth: number }
interface FileMeta    { language: string; representative?: Float32Array }
interface ChunkMeta   { position: number }                               // ordinal index within file
interface ClusterMeta { scope: 'local' | 'global'; mergeScore: number; level: number }

// ── Edge kinds ────────────────────────────────────────────────────────────────

type EdgeKind = 'contains' | 'merges' | 'reference';

interface GraphEdge {
  id:     string;
  source: string;
  target: string;
  kind:   EdgeKind;
  weight: number;
}

// ── Cluster result from two-pass HAC ─────────────────────────────────────────

interface ClusterNode {
  id:         string;
  scope:      'local' | 'global';
  level:      number;
  mergeScore: number;
  memberIds:  string[];   // direct children (chunk ids for local; file/cluster ids for global)
}

// ── Config schema ─────────────────────────────────────────────────────────────

interface CoGraphConfig {
  version:             number;
  activeLayout:        'structural' | 'semantic';
  metric:              string;
  maxDepth:            number;
  labelOverrides:      Record<string, string>;
  membershipOverrides: Record<string, string>;
  dismissedSuggestions: string[];
  acceptedEdges:       string[];
  vectorCache: {
    updatedAt:       string;
    chunks:          Record<string, number[]>;   // chunkId → embedding
    representatives: Record<string, number[]>;  // fileId  → representative embedding
  };
}
```

---

## Build Pipeline

### `core` and `renderer` — Vite library mode

```json
// vite.config.ts (both packages)
{
  "build": {
    "lib": { "entry": "src/index.ts", "formats": ["es", "cjs"] },
    "rollupOptions": { "external": ["react", "react-dom", "cytoscape"] }
  }
}
```

Output: `dist/index.mjs` (ESM) + `dist/index.cjs` (CJS) + `dist/index.d.ts`

### `vscode` — esbuild

Single CJS bundle required; no code splitting, no dynamic `import()`. The renderer bundle is
inlined as a string and injected into the Webview HTML template at runtime.

```sh
esbuild src/extension.ts --bundle --platform=node --external:vscode --outfile=dist/extension.js
```

### `app` — Vite SPA

```sh
vite build  # → dist/index.html + assets
```

Deploy target: `gh-pages` branch for the browser demo.

### Turborepo pipeline

```json
// turbo.json
{
  "pipeline": {
    "build":  { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test":   { "dependsOn": ["^build"] },
    "lint":   {}
  }
}
```

`core` builds before `renderer`, which builds before `vscode` and `app`. Turborepo caches
outputs so unchanged packages are never rebuilt.

---

## TypeScript Configuration

```json
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true
  }
}
```

Each package extends `tsconfig.base.json` and sets its own `outDir` and `rootDir`.

---

## CI (GitHub Actions)

```yaml
# .github/workflows/ci.yml
on: [push, pull_request]
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build test lint
```
