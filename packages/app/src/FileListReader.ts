/**
 * IFileReader built from an <input webkitdirectory> FileList.
 * Works in all major browsers (Chrome, Firefox, Edge, Safari).
 * Builds a virtual directory tree from the flat list of File objects.
 */

import { IFileReader, DirEntry } from '@cograph/core';


export class FileListReader implements IFileReader {
  private files = new Map<string, File>();     // relative path → File
  private dirs = new Map<string, string[]>();  // dir path → child names
  readonly rootName: string;

  constructor(fileList: FileList) {
    // webkitRelativePath = "selectedFolderName/path/to/file"
    // Strip the top-level folder name so root is ''
    this.rootName = fileList[0]?.webkitRelativePath.split('/')[0] ?? 'project';
    this.dirs.set('', []);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i]!;
      const full = file.webkitRelativePath;               // "root/a/b/c.md"
      const stripped = full.slice(this.rootName.length + 1); // "a/b/c.md"
      if (!stripped) continue;

      this.files.set(stripped, file);

      // Register every ancestor directory and this file in its parent
      const parts = stripped.split('/');
      for (let depth = 0; depth < parts.length; depth++) {
        const dir = parts.slice(0, depth).join('/');
        const child = parts[depth]!;
        let children = this.dirs.get(dir);
        if (!children) { children = []; this.dirs.set(dir, children); }
        if (!children.includes(child)) children.push(child);

        if (depth < parts.length - 1) {
          const subdir = parts.slice(0, depth + 1).join('/');
          if (!this.dirs.has(subdir)) this.dirs.set(subdir, []);
        }
      }
    }
  }

  async readDir(path: string): Promise<DirEntry[]> {
    return (this.dirs.get(path) ?? []).map((name) => {
      const childPath = path ? `${path}/${name}` : name;
      return { name, path: childPath, isDirectory: this.dirs.has(childPath) };
    });
  }

  async readText(path: string): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    return file.text();
  }
}
