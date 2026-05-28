# cograph — Requirements

## Glossary

**Token** — A raw text fragment extracted from a source file: a word, phrase, symbol, variable
name, or sentence segment. The atomic unit of *text content*. Tokens are stored as metadata on
Element nodes; they are not graph nodes themselves.

**Element** — A graph node representing one key concept within a file. Derived by distilling
the most semantically significant tokens from the file's content. Carries an embedding vector
and a list of its constituent representative tokens. The leaf node in the semantic hierarchy.
The maximum number of Elements per file is user-configurable (default 50).

**Block** — A graph node and visual compound container grouping semantically similar Elements
within a single file. Analogous to a structural unit in the source — a document section, a
function, a class, or a conceptual cluster. Labeled by its dominant tokens (TF-IDF terms).
Produced by intra-file agglomeration of Element embeddings.

**File / Module** — A graph node and visual compound container grouping Blocks. Represents a
file in the filesystem. Text files are expandable containers; binary or unsupported files are
treated as opaque grey leaf nodes and cannot be expanded. At higher view levels a file is shown
as a compound displaying one dot per Block; when navigated into, it displays Block compounds
containing Element dots.

**Folder** — A graph node and visual compound container grouping Files and sub-Folders.
Represents a filesystem directory. At higher view levels a folder is shown as a compound
displaying one dot per immediate child container; when navigated into, it displays its direct
children as compounds or leaf nodes.

**Workspace** — The root container; the project folder opened by the user. The initial
navigation context.

**Containment** — The ownership relationship between a parent container and its children.
Expressed via `contains` edges. Shown visually through compound nesting; never drawn as
explicit lines.

**Semantic similarity** — The relationship between two Elements in different Blocks that
represent the same concept or token type. Expressed via `similar` edges rendered as visible
lines at the file-level view.

---

## Overview

cograph is a pure TypeScript semantic graph engine and hierarchical interactive renderer. It
ingests a file system, extracts semantic concepts from text files, groups those concepts into
labeled Blocks, and presents the entire workspace as a self-similar, click-navigable graph.

The fundamental visual metaphor is **uniform containment**: at every level of the hierarchy,
the canvas shows the immediate children of the current container as either compound nodes (if
they have their own children) or leaf dots (if they are terminal). Clicking any compound
navigates into it. The model is the same whether viewing folders, files, or blocks — only
the *kind* of container changes.

**Container hierarchy:**
```
Workspace → Folder* → File / Module → Block → Element
```
(Folders nest arbitrarily. Binary files have no inner hierarchy.)

---

## Functional Requirements

### Data Ingestion

| ID | Requirement |
|----|-------------|
| FR-01 | Recursively scan a workspace folder and emit a `folder` node for every directory, a `file` node for every text file, and `element` nodes representing key concepts extracted from each text file's content; build `contains` edges to form the structural hierarchy |
| FR-02 | Respect `.gitignore` patterns and a user-configurable ignore list; emit binary/unsupported files as opaque `file` nodes (grey, non-expandable) with no child nodes; text files are chunked by a sliding window (default 256 tokens, 10 % overlap, configurable) to produce intermediate segments for embedding |

### Semantic Model

| ID | Requirement |
|----|-------------|
| FR-03 | Embed each intermediate text segment using a local Transformers.js ONNX model (`all-MiniLM-L6-v2`); store the resulting float vectors in `.cograph.json` so they survive across sessions |
| FR-04 | **Intra-file grouping**: for each text file, run bottom-up average-linkage HAC on its segment embeddings to produce a set of `block` nodes; the number of blocks targets `floor(sqrt(n))` where *n* is the number of segments, capped between 2 and 12; each block is labelled by the top-N TF-IDF terms from its member segments' text |
| FR-05 | **Element extraction**: within each block, identify the most semantically significant tokens (keywords, phrases, symbols) and create `element` nodes up to the per-file maximum (default 50, user-configurable); excess potential elements are merged into the nearest existing element; each element carries its representative tokens as metadata |
| FR-06 | **Inter-file similarity**: run global HAC on file representative embeddings (mean of block embeddings); use the result to identify element pairs across files that represent the same concept — these become `similar` edges visible at the file-level view |
| FR-07 | Auto-label each `block` with its dominant TF-IDF terms; auto-label each `element` with its most representative token; both labels are user-overridable |

### Graph Model

| ID | Requirement |
|----|-------------|
| FR-08 | Represent the graph with four typed node kinds: `folder`, `file`, `block`, and `element`; the `file` node carries an `expandable` boolean (false for binary/unsupported files) |
| FR-09 | Represent relationships with two user-visible typed edge kinds: `contains` (structural ownership: folder→folder, folder→file, file→block, block→element — communicated via compound nesting, never drawn as lines) and `similar` (cross-block co-concept: drawn as visible lines between `element` nodes in different blocks that represent the same concept); a third kind `reference` is reserved for future LSP/import data |
| FR-10 | Each node carries a `meta` bag scoped by kind: `language` (file, block, element), `expandable` (file), `tokens` (element — list of representative raw text fragments), `mergeScore` (block — HAC merge cost), `depth` (folder — distance from workspace root) |

### Visualization

| ID | Requirement |
|----|-------------|
| FR-11 | Render the graph using Cytoscape.js with the `fcose` compound force layout |
| FR-12 | **Uniform containment view**: at every navigation level the canvas shows the immediate children of the current container using the same rule regardless of depth — (a) a child that itself has children is rendered as a compound node with its own children shown as dots inside it; (b) a child with no children is rendered as a plain coloured dot; the rule applies identically at every level: a Folder compound shows sub-folder and file dots; a File compound shows Block dots; a Block compound shows Element dots |
| FR-13 | **Navigation**: clicking any compound node navigates into it, making it the new current context; the canvas redraws showing that container's children; a **back arrow button** (positioned to the left of the canvas) navigates up one level to the parent container; a breadcrumb always shows the full path from workspace root to the current context and supports one-click navigation to any ancestor; the back arrow is hidden when at workspace root |
| FR-14 | **Binary files**: always rendered as grey leaf dots at whatever level they appear; clicking a binary file node has no navigation effect |
| FR-15 | **Token panel**: clicking an `element` node (leaf dot inside a block compound) opens a side panel listing its representative tokens; the panel highlights the corresponding text region in a source preview when a file path is available |
| FR-16 | Color mapping: the user selects a metric from a dropdown (Language, Connections, Chunk count, Cluster tightness); nodes and compounds are continuously color-mapped using a perceptual scale; binary/unsupported files are always grey regardless of metric; a legend panel is always visible |
| FR-17 | **Similar edges**: at the file-level view (blocks as compounds), `similar` edges are drawn as lines connecting `element` dots across different block compounds; these edges represent shared concepts between blocks; visibility is toggled via a checkbox (on by default) |
| FR-18 | Search: a free-text query is embedded at query time using the same local model; every element node is colored by its cosine distance to the query vector |

### Interaction

| ID | Requirement |
|----|-------------|
| FR-19 | Rename any node or block label via double-click inline edit; stored as an override in `.cograph.json` |
| FR-20 | Full undo/redo stack for all edit operations within a session |
| FR-21 | All edits are immediately flushed to `.cograph.json` on disk |

### Suggestions

| ID | Requirement |
|----|-------------|
| FR-22 | Surface the top-K file pairs whose representatives are highly similar but whose files reside in different folders, as dashed "phantom" edges the user can accept (adds a permanent `reference` edge) or dismiss |
| FR-23 | For each block, offer alternative auto-generated labels in a tooltip; the user can apply one with a single click |

### Persistence

| ID | Requirement |
|----|-------------|
| FR-24 | Store all user preferences and computed data in a single `.cograph.json` file at the workspace root; the schema covers: selected metric, max elements per file, label overrides, accepted/dismissed suggestions, and the vector cache (segment embeddings + block representatives) |
| FR-25 | On startup, detect if `.cograph.json` is stale (any file newer than the cache timestamp) and re-embed only changed files; re-run intra-file grouping for changed files and incrementally update the global similarity index |

### VS Code Integration

| ID | Requirement |
|----|-------------|
| FR-26 | Register a command `cograph: Open Graph` in the VS Code command palette that opens the graph as a Webview panel for the current workspace |
| FR-27 | Use `vscode.workspace.createFileSystemWatcher` to watch for file changes and trigger incremental re-embedding without requiring the user to reload |
| FR-28 | Read and write `.cograph.json` via the VS Code `workspace.fs` API so the extension works with remote and virtual workspaces |

### Browser App

| ID | Requirement |
|----|-------------|
| FR-29 | In the browser SPA, let the user pick a local folder via `<input type="file" webkitdirectory>`; the same core engine processes it entirely in-browser |
| FR-30 | In the browser, persist config to `localStorage` (no disk write); a download button exports the current `.cograph.json` |

---

## Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NFR-01 | **Language**: Pure TypeScript across all packages; no `.js` source files |
| NFR-02 | **Offline**: No external network calls are required for any core feature; the embedding model is bundled or cached locally |
| NFR-03 | **Scale**: Handle workspaces up to ~10 000 file nodes; initial scan + full embed + grouping completes in under 60 s on a modern laptop |
| NFR-04 | **Incremental**: Re-embedding a single changed file completes in under 2 s |
| NFR-05 | **Interaction latency**: All user-visible interactions (navigation, filter toggle, search color-map) complete within 200 ms of input |
| NFR-06 | **UI simplicity**: The graph canvas occupies ≥ 80 % of the viewport; controls are minimal and collapse when not in use |
| NFR-07 | **Portability**: The `core` and `renderer` packages have no Node.js or VS Code dependencies and run in any modern browser |
| NFR-08 | **Testability**: Core algorithms (scanner, grouper, label generator) are fully unit-testable without a DOM or VS Code host |

---

## Out of Scope (v1)

- LSP / compiler-derived reference edges
- Multi-root workspaces
- Real-time collaborative editing
- Cloud sync of `.cograph.json`
- Non-text file content extraction (images, audio, video, PDF — these are binary leaves)
- Embeddings via external API (e.g., OpenAI, Claude)
- Structure-aware segmentation (function/class/heading boundaries) — deferred to v2; the fixed-window segmenter is designed to be swapped via an `IChunker` interface
