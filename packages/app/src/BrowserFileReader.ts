/** IFileReader implementation using the File System Access API. */

import { IFileReader, DirEntry } from '@cograph/core';


export class BrowserFileReader implements IFileReader {
  private handles = new Map<string, FileSystemFileHandle | FileSystemDirectoryHandle>();

  constructor(private root: FileSystemDirectoryHandle) {
    this.handles.set('', root);
  }

  async readDir(path: string): Promise<DirEntry[]> {
    const handle = await this._resolve(path);
    if (handle.kind !== 'directory') return [];

    const entries: DirEntry[] = [];
    for await (const [name, entry] of (handle as FileSystemDirectoryHandle).entries()) {
      const entryPath = path ? `${path}/${name}` : name;
      this.handles.set(entryPath, entry);
      entries.push({ name, path: entryPath, isDirectory: entry.kind === 'directory' });
    }
    return entries;
  }

  async readText(path: string): Promise<string> {
    const handle = await this._resolve(path);
    if (handle.kind !== 'file') throw new Error(`Not a file: ${path}`);
    const file = await (handle as FileSystemFileHandle).getFile();
    return file.text();
  }


  private async _resolve(path: string): Promise<FileSystemFileHandle | FileSystemDirectoryHandle> {
    const cached = this.handles.get(path);
    if (cached) return cached;

    // Walk the path from root
    const parts = path.split('/').filter(Boolean);
    let current: FileSystemDirectoryHandle = this.root;
    for (const part of parts) {
      current = await current.getDirectoryHandle(part).catch(async () => {
        // Try as file handle at last segment — will fail for dirs but that's fine
        return current.getDirectoryHandle(part);
      });
    }
    return current;
  }
}
