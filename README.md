# cograph

Semantic graph visualisation of a project's file system. Chunks text files, embeds them locally
using `all-MiniLM-L6-v2`, and builds a two-level cluster hierarchy — folder structure on one
view, semantic similarity on the other. Runs entirely in the browser; no server or API key needed.

---

## Requirements

| Tool | Version |
|------|---------|
| Node.js | 18 + |
| pnpm | 8 + |

Install pnpm if you don't have it:

```sh
npm install -g pnpm
```

---

## Install

```sh
cd cograph
pnpm install
```

---

## Run the browser app (dev)

```sh
pnpm --filter @cograph/app dev
```

Open **http://localhost:5173** in your browser, click **"Open folder…"**, and select any local
directory. The app scans the folder, embeds every text file chunk, clusters the results, and
renders the graph.

> **Browser requirement:** The folder picker uses the
> [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API),
> which requires **Chrome 86+**, **Edge 86+**, or **Safari 17.4+**.
> Firefox is not supported.

The dev server is **not** persistent — it runs only while the terminal process is alive.
Stop it with `Ctrl+C`.

---

## Run tests

```sh
# All packages
pnpm turbo test

# Core engine only (faster during development)
pnpm --filter @cograph/core test

# Watch mode
pnpm --filter @cograph/core test --watch
```

---

## Build for production

```sh
pnpm turbo build
```

The browser SPA is output to `packages/app/dist/`. Serve it with any static file server:

```sh
npx serve packages/app/dist
```

---

## Project layout

```
packages/
  core/       Pure TypeScript engine — scanner, chunker, embedder, clusterer, labeller
  renderer/   React + Cytoscape.js graph UI (browser-safe)
  app/        Browser SPA (Vite, File System Access API)
  vscode/     VS Code extension — Phase 6, coming soon
sample/       Example project used as a test fixture
docs/         Requirements, stack decisions, implementation phases
```

---

## First run note

The embedding model (`all-MiniLM-L6-v2`, ~22 MB) is downloaded from Hugging Face on the first
run and cached by the browser. Subsequent runs are fully offline.
