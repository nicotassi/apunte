import type { Folder } from './types';

type FolderMap = Record<string, Folder> | Folder[];
const list = (f: FolderMap): Folder[] => (Array.isArray(f) ? f : Object.values(f));

/** Cadena de nombres desde la carpeta de más arriba hasta esta: ["Trabajo", "Proyectos"]. */
export function folderChain(id: string | null | undefined, folders: FolderMap): Folder[] {
  const all = list(folders);
  const out: Folder[] = [];
  const seen = new Set<string>();
  let cur = id ? all.find((f) => f.id === id) : undefined;
  while (cur && !seen.has(cur.id)) {
    out.unshift(cur);
    seen.add(cur.id);
    cur = cur.parentId ? all.find((f) => f.id === cur!.parentId) : undefined;
  }
  return out;
}

/** "Trabajo/Proyectos" (es lo que se guarda en GitHub). */
export function folderPath(id: string | null | undefined, folders: FolderMap): string {
  return folderChain(id, folders).map((f) => f.name).join('/');
}

/** La carpeta y todas las que tiene adentro (a cualquier nivel). */
export function withDescendants(id: string, folders: FolderMap): Set<string> {
  const all = list(folders);
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of all) if (f.parentId && out.has(f.parentId) && !out.has(f.id)) { out.add(f.id); grew = true; }
  }
  return out;
}

export interface FolderRow { folder: Folder; depth: number; path: string; hasChildren: boolean }

/** Árbol aplanado y ordenado por nombre, listo para dibujar con sangría. */
export function folderRows(folders: FolderMap, collapsed: Record<string, boolean> = {}): FolderRow[] {
  const all = list(folders);
  const ids = new Set(all.map((f) => f.id));
  const kids = (parent: string | null) => all.filter((f) => (f.parentId && ids.has(f.parentId) ? f.parentId : null) === parent).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const out: FolderRow[] = [];
  const walk = (parent: string | null, depth: number, prefix: string) => {
    for (const f of kids(parent)) {
      const children = kids(f.id);
      const path = prefix ? `${prefix}/${f.name}` : f.name;
      out.push({ folder: f, depth, path, hasChildren: children.length > 0 });
      if (!collapsed[f.id]) walk(f.id, depth + 1, path);
    }
  };
  walk(null, 0, '');
  return out;
}
