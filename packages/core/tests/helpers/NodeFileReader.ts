/** Node.js IFileReader implementation for use in tests only — NOT part of core. */

import { promises as fs } from 'fs';
import { join } from 'path';
import { IFileReader, DirEntry } from '../../src/types.js';


export class NodeFileReader implements IFileReader {
  async readDir(path: string): Promise<DirEntry[]> {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      path: join(path, e.name),
      isDirectory: e.isDirectory(),
    }));
  }

  async readText(path: string): Promise<string> {
    return fs.readFile(path, 'utf-8');
  }
}
