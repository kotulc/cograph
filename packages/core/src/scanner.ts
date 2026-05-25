/** File system walker — emits folder/file/chunk nodes and structural contains edges. */

import ignore from 'ignore';
import { IFileReader, IChunker, DirEntry, GraphNode, GraphEdge, FolderMeta, FileMeta, ChunkMeta } from './types.js';
import { GraphModel } from './graph.js';
import { defaultChunker } from './chunker.js';


// ── Language detection ────────────────────────────────────────────────────────

const LANG_MAP: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
  '.py': 'python',     '.rb':  'ruby',  '.go':  'go',   '.rs':  'rust',
  '.md': 'markdown',   '.txt': 'text',  '.sh':  'shell', '.yaml': 'yaml',
  '.yml': 'yaml',      '.toml': 'toml', '.json': 'json', '.html': 'html',
  '.css': 'css',       '.scss': 'scss', '.java': 'java', '.cpp':  'cpp',
  '.c':   'c',         '.h':   'c',     '.kt':  'kotlin', '.swift': 'swift',
};

const DEFAULT_IGNORE = ['node_modules', '.git', 'dist', '.turbo', '.cache', '*.vsix'];

export interface ScanOptions {
  maxFileSizeBytes?: number;  // default 512 KB
  chunkWindowSize?: number;   // default 256 words
  chunkOverlap?: number;      // default 0.1
  ignorePatterns?: string[];
  chunker?: IChunker;
}

export interface PathIndex {
  byPath: Map<string, string>; // path → nodeId
  byId: Map<string, string>;   // nodeId → path
}

export interface ScanResult {
  model: GraphModel;
  pathIndex: PathIndex;
}


/**
 * Recursively walks `root`, emitting folder/file/chunk nodes and contains edges.
 * Binary files and files matching ignore patterns are skipped.
 * Returns the populated GraphModel and a path index for I/O operations.
 */
export async function walkDir(
  root: string,
  reader: IFileReader,
  options: ScanOptions = {},
): Promise<ScanResult> {
  const {
    maxFileSizeBytes = 512 * 1024,
    chunkWindowSize = 256,
    chunkOverlap = 0.1,
    ignorePatterns = [],
    chunker = defaultChunker,
  } = options;

  const ig = ignore().add(DEFAULT_IGNORE).add(ignorePatterns);
  const model = new GraphModel();
  const pathIndex: PathIndex = { byPath: new Map(), byId: new Map() };
  let edgeSeq = 0;

  const edgeId = () => `e${edgeSeq++}`;

  const contains = (source: string, target: string): GraphEdge => ({
    id: edgeId(), source, target, kind: 'contains', weight: 1,
  });

  // Attempt to read .gitignore at root
  const gitignorePath = root ? `${root}/.gitignore` : '.gitignore';
  try {
    const gitignoreText = await reader.readText(gitignorePath);
    ig.add(gitignoreText.split('\n').filter((l) => l && !l.startsWith('#')));
  } catch {
    // no .gitignore — ignore silently
  }

  async function walk(dirPath: string, parentId: string | null, depth: number): Promise<void> {
    let entries: DirEntry[];
    try { entries = await reader.readDir(dirPath); } catch { return; }

    for (const entry of entries) {
      const rel = entry.path.replace(root, '').replace(/^[\\/]/, '').replace(/\\/g, '/');
      if (rel && ig.ignores(rel)) continue;

      if (entry.isDirectory) {
        const folderId = `folder::${rel || entry.name}`;
        const folderNode: GraphNode = {
          id: folderId, kind: 'folder', label: entry.name,
          meta: { depth } as FolderMeta,
        };
        model.addNode(folderNode);
        pathIndex.byPath.set(entry.path, folderId);
        pathIndex.byId.set(folderId, entry.path);

        if (parentId) model.addEdge(contains(parentId, folderId));
        await walk(entry.path, folderId, depth + 1);

      } else {
        const ext = extname(entry.name);
        const language = LANG_MAP[ext] ?? 'unknown';
        if (language === 'unknown') continue; // skip unrecognised / binary types

        let text: string;
        try { text = await reader.readText(entry.path); } catch { continue; }

        // Skip binary files (null-byte heuristic on first 8 KB)
        if (hasBinaryContent(text.slice(0, 8192))) continue;
        if (text.length > maxFileSizeBytes) continue;

        const fileId = `file::${rel}`;
        const fileNode: GraphNode = {
          id: fileId, kind: 'file', label: entry.name,
          meta: { language } as FileMeta,
        };
        model.addNode(fileNode);
        pathIndex.byPath.set(entry.path, fileId);
        pathIndex.byId.set(fileId, entry.path);

        if (parentId) model.addEdge(contains(parentId, fileId));

        const segments = chunker.chunk(text, chunkWindowSize, chunkOverlap);
        segments.forEach((content, position) => {
          const chunkId = `chunk::${rel}::${position}`;
          const chunkNode: GraphNode = {
            id: chunkId, kind: 'chunk', label: `${entry.name}[${position}]`,
            vector: undefined,
            meta: { position } as ChunkMeta,
          };
          // Store the raw text temporarily in label for embedding; replaced post-embed
          (chunkNode as GraphNode & { content: string }).content = content;
          model.addNode(chunkNode);
          model.addEdge(contains(fileId, chunkId));
        });
      }
    }
  }

  // Emit root folder node
  const rootName = root.split(/[\\/]/).at(-1) ?? root;
  const rootId = `folder::`;
  const rootNode: GraphNode = {
    id: rootId, kind: 'folder', label: rootName,
    meta: { depth: 0 } as FolderMeta,
  };
  model.addNode(rootNode);
  pathIndex.byPath.set(root, rootId);
  pathIndex.byId.set(rootId, root);

  await walk(root, rootId, 1);
  return { model, pathIndex };
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function extname(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

function hasBinaryContent(sample: string): boolean {
  return sample.includes('\0');
}
