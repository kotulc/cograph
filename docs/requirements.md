# cograph — Requirements

## Glossary

**Chunk** — The atomic unit of semantic content. A fixed-size text segment (default 256 tokens,
configurable) extracted by a sliding window over a file's raw text. The smallest node in both
the structural and semantic hierarchies. Carries an embedding vector.

**Local cluster** — A computed grouping of chunks *within a single file*, produced by intra-file
agglomeration (Pass 1). A `cluster` node with `scope: local`. Carries the mean embedding of its
members as its representative.

**File representative** — The embedding of the root local cluster of a file. Stored as a property
on the `file` node; not a separate graph node. The compact summary consumed by Pass 2. Derived
automatically from Pass 1; never user-editable.

**Global cluster** — A computed grouping of files (or other global clusters), produced by
inter-file agglomeration (Pass 2) on file representatives. A `cluster` node with `scope: global`.

**Merge score** — The cosine similarity at which two clusters were joined during agglomeration.
Stored as the weight on the internal `merges` edge (parent cluster → child cluster/chunk).
Higher = merged earlier = more similar. This edge is never rendered; it is traversed only by the
dendrogram-cut algorithm to determine cluster membership at a given level.

**Cluster co-membership edge** — A `similar` edge between two `file` nodes. It means: "these
files share the semantic concept described by their common cluster at the current cut level." The
cluster label (TF-IDF term) is the *reason* for the edge. Moving the depth slider changes which
clusters are active and therefore which files share edges.

**Agglomeration level** — A discrete depth in the semantic hierarchy, corresponding to one layer
in the visualisation. Level 0 = leaf chunks; increasing levels = progressively coarser clusters.

**Structural hierarchy** — The hard-containment tree `workspace → folder → file → chunk`,
traversed via `contains` edges. Encodes ownership; file and folder boundaries are strict.

**Semantic hierarchy** — The soft-similarity tree produced by two-pass agglomeration, traversed
internally via `merges` edges. Crosses file and folder boundaries freely; encodes meaning, not
ownership. In the UI, the active cut of this hierarchy is exposed through compound cluster nodes
and `similar` co-membership edges between files that share the same cluster concept.

**Cluster representative** — The mean embedding of a cluster's direct members. Used as the
cluster's identity vector in the next agglomeration step. Recomputed whenever membership changes.

---

## Overview

cograph is a pure TypeScript semantic clustering engine with a hierarchical graph renderer. It
ingests a workspace's file system, builds a two-level semantic hierarchy using local embeddings,
and presents the result as an interactive, layer-navigable graph. It runs as both a VS Code
Webview extension and a standalone browser SPA — no network calls required.

The graph maintains two simultaneous views of the same node set:

- **Structural view** — hard-containment tree (`contains` edges): workspace → folder → file → chunk
- **Semantic view** — soft-similarity tree (`merges` edges): global cluster → local cluster → chunk

---

## Functional Requirements

### Data Ingestion

| ID | Requirement |
|----|-------------|
| FR-01 | Recursively scan a workspace folder and emit a `folder` node for every directory, a `file` node for every non-binary text file, and `chunk` nodes for each fixed-size segment of that file's content; build `contains` edges to form the structural hierarchy; maintain a separate operational path index (path → node ID) for all I/O operations — path data is not stored on nodes |
| FR-02 | Respect `.gitignore` patterns and a user-configurable ignore list; never emit nodes for binary files or files exceeding a configurable size threshold; chunking uses a fixed sliding window of 256 tokens (configurable) with a 10 % overlap |

### Semantic Model

| ID | Requirement |
|----|-------------|
| FR-03 | Embed each `chunk` node using a local Transformers.js ONNX model (`all-MiniLM-L6-v2`); store the resulting float vectors in `.cograph.json` so they survive across sessions |
| FR-04a | **Pass 1 — local agglomeration**: for each file, run bottom-up average-linkage HAC on its chunk embeddings; produce a local cluster tree (`scope: local`) rooted at the file; store the root cluster's mean embedding as the file's representative on the `file` node |
| FR-04b | **Pass 2 — global agglomeration**: run bottom-up average-linkage HAC on all file representatives; produce a global cluster tree (`scope: global`); use approximate nearest-neighbour search (HNSW) when the file count exceeds a configurable threshold (default 5 000) |
| FR-05 | Expose each discrete merge step in the semantic hierarchy as a named agglomeration level; the depth slider navigates these levels |
| FR-06 | Auto-generate a label for each cluster by extracting the top-N TF-IDF terms from the concatenated content of its member chunks |

### Graph Model

| ID | Requirement |
|----|-------------|
| FR-07 | Represent the graph with four typed node kinds: `folder`, `file`, `chunk`, and `cluster`; `cluster` carries a `scope` discriminant (`local` \| `global`) |
| FR-08 | Represent relationships with three user-visible typed edge kinds: `contains` (structural ownership: folder→folder, folder→file, file→chunk), `similar` (cluster co-membership: a rendered edge between two `file` nodes indicating they belong to the same cluster at the current cut level — the cluster label describes the shared concept), and `reference` (reserved for future LSP/import data). A fourth internal kind `merges` (cluster→cluster, cluster→chunk) is used only by the dendrogram-cut algorithm and is never rendered. |
| FR-09 | Each node carries a `meta` bag scoped by kind: `language` (file), `position` (chunk), `scope` and `merge_score` (cluster), `depth` (folder/file — derivable from the structural hierarchy but cached for performance) |

### Visualization

| ID | Requirement |
|----|-------------|
| FR-10 | Render the graph using Cytoscape.js with the `fcose` compound force layout; a single unified view shows structural containment through compound nesting and semantic similarity through inter-cluster edges — no layout mode toggle; the two levels of nesting visible at any view are: (1) **frontier folders** (filesystem folders at the current depth), and (2) **semantic sub-clusters** of files within each frontier folder, auto-sized by HAC to 2–7 groups; `similar` edges connect sub-cluster compounds across frontier folders that share the same global HAC concept |
| FR-11 | **Depth slider**: controls which level of the filesystem is shown as the primary structural grouping; position 0 = the selected root's immediate child folders; position *n* = the frontier of the folder tree at depth *n* from the selected root (leaf folders at depth < *n* remain visible); the slider maximum equals the deepest folder path in the selected root's subtree; the slider range updates whenever the selected root changes |
| FR-12 | **Root selection**: clicking any frontier folder compound selects it as the new root context; the slider resets to 0 and its maximum is recomputed for the selected root's subtree; a breadcrumb displays the path from the project root to the selected root and supports one-click navigation to any ancestor |
| FR-13 | Color mapping: the user selects a metric from a dropdown (options: semantic distance from search term, node degree, cluster tightness, chunk count, detected language); nodes, edges, and cluster hulls are continuously color-mapped using a perceptual color scale; a legend panel is always visible |
| FR-14 | Edge filter panel: checkboxes toggle visibility of `similar` (on by default) and `reference` (off by default) edges; structural containment is communicated through compound nesting and has no explicit edge toggle |
| FR-15 | Search: a free-text query is embedded at query time using the same local model; every node is then colored by its cosine distance to the query vector, surfacing semantically related nodes |
| FR-29 | **Root-files compound**: files that live directly at the selected root depth (not inside any frontier folder) are grouped into a synthetic "root files" compound rendered at the same level as the frontier folders; this ensures all files are always visible regardless of slider depth |
| FR-30 | **Auto semantic granularity**: the HAC cut level used for sub-clustering within frontier folders is computed automatically from the total file count in the current view — targeting approximately `floor(sqrt(n))` sub-clusters globally, capped between 3 and 12; this level is not user-exposed |

### Interaction & Editing

| ID | Requirement |
|----|-------------|
| FR-16 | Rename any node or cluster label via double-click inline edit; the new label is stored as an override in `.cograph.json` |
| FR-17 | Drag a file node to a different global cluster to override its cluster membership; the override is persisted in `.cograph.json` |
| FR-18 | Full undo/redo stack for all edit operations within a session |
| FR-19 | All edits are immediately flushed to `.cograph.json` on disk |

### Suggestions

| ID | Requirement |
|----|-------------|
| FR-20 | Surface the top-K file pairs whose representatives are highly similar but whose files reside in different global clusters, as dashed "phantom" edges the user can accept (adds a permanent `reference` edge) or dismiss (suppressed in future sessions) |
| FR-21 | For each cluster, offer three alternative auto-generated labels in a tooltip; the user can apply one with a single click |

### Persistence

| ID | Requirement |
|----|-------------|
| FR-22 | Store all user preferences and computed data in a single `.cograph.json` file at the workspace root; the schema covers: active layout mode, selected metric, max depth, label overrides, membership overrides, accepted/dismissed suggestions, and the vector cache (chunk embeddings + file representatives) |
| FR-23 | On startup, detect if `.cograph.json` is stale (any file newer than the cache timestamp) and re-embed only changed files; re-run Pass 1 for changed files and incrementally update the Pass 2 global tree |

### VS Code Integration

| ID | Requirement |
|----|-------------|
| FR-24 | Register a command `cograph: Open Graph` in the VS Code command palette that opens the graph as a Webview panel for the current workspace |
| FR-25 | Use `vscode.workspace.createFileSystemWatcher` to watch for file changes and trigger incremental re-embedding without requiring the user to reload |
| FR-26 | Read and write `.cograph.json` via the VS Code `workspace.fs` API so the extension works with remote and virtual workspaces |

### Browser App

| ID | Requirement |
|----|-------------|
| FR-27 | In the browser SPA, let the user pick a local folder via `<input type="file" webkitdirectory>` (supported in Chrome, Firefox, Edge, and Safari); the same core engine processes it entirely in-browser |
| FR-28 | In the browser, persist config to `localStorage` (no disk write); a download button exports the current `.cograph.json` |

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Language**: Pure TypeScript across all packages; no `.js` source files |
| NFR-02 | **Offline**: No external network calls are required for any core feature; the embedding model is bundled or cached locally |
| NFR-03 | **Scale**: Handle workspaces up to ~10 000 file nodes; initial scan + full embed + both agglomeration passes complete in under 60 s on a modern laptop |
| NFR-04 | **Incremental**: Re-embedding a single changed file (Pass 1 + partial Pass 2 update) completes in under 2 s |
| NFR-05 | **Interaction latency**: All user-visible interactions (drill-down, filter toggle, layout switch, search color-map) complete within 200 ms of input |
| NFR-06 | **UI simplicity**: The graph canvas occupies ≥ 80 % of the viewport; controls are minimal and collapse when not in use |
| NFR-07 | **Portability**: The `core` and `renderer` packages have no Node.js or VS Code dependencies and run in any modern browser |
| NFR-08 | **Testability**: Core algorithms (scanner, chunker, clusterer, label generator) are fully unit-testable without a DOM or VS Code host |

---

## Out of Scope (v1)

- LSP / compiler-derived reference edges
- Multi-root workspaces
- Real-time collaborative editing
- Cloud sync of `.cograph.json`
- Non-text file content (images, binaries)
- Embeddings via external API (e.g., OpenAI, Claude)
- **File-type-aware chunking**: structure-aware segmentation for specific file types (e.g. function/class
  boundaries for `.py`, `.ts`; heading boundaries for `.md`; cell boundaries for `.ipynb`) to produce
  more semantically coherent chunks — deferred to v2; the fixed-window chunker is designed to be
  swapped out via a `IChunker` interface
