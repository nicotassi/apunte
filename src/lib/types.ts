export const NOTE_COLORS = ['terracota', 'naranja', 'amarillo', 'verde', 'turquesa', 'azul', 'violeta', 'rosa'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export interface Note {
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  tags: string[];
  pinned: boolean;
  trashed: boolean;
  color?: NoteColor | null;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string; // solo el nombre de esta carpeta (sin las de arriba)
  parentId?: string | null; // carpeta que la contiene
  createdAt: number;
}

export interface SyncConfig {
  repo: string; // owner/nombre
  branch: string; // vacío = rama por defecto
  token: string;
  auto: boolean;
}

export interface Settings {
  theme: 'auto' | 'light' | 'dark';
  uiSize: 0 | 1 | 2 | 3; // tamaño de la interfaz de la app (no de las notas)
  textSize: 0 | 1 | 2; // tamaño del texto de las notas
  view: 'grid' | 'list' | 'large'; // cómo se ven las notas en la lista
  titleFont: 'claude' | 'fraunces' | 'lora' | 'newsreader' | 'sans'; // letra de los títulos
  bodyFont: 'inter' | 'claude' | 'system'; // letra del texto y de toda la app
  sync: SyncConfig;
}

/** Qué se sabe de cada nota en la última sincronización exitosa. */
export interface SyncFileState {
  path: string;
  sha: string;
  updatedAt: number;
}
export interface SyncState {
  files: Record<string, SyncFileState>;
  lastAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  uiSize: 1,
  textSize: 1,
  view: 'grid',
  titleFont: 'fraunces',
  bodyFont: 'inter',
  sync: { repo: '', branch: '', token: '', auto: true },
};
