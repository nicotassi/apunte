export interface Note {
  id: string;
  title: string;
  body: string;
  folderId: string | null;
  tags: string[];
  pinned: boolean;
  trashed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
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
  sync: { repo: '', branch: '', token: '', auto: true },
};
