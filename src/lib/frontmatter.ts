import { NOTE_COLORS, type Note, type NoteColor } from './types';

/**
 * Formato de cada nota en GitHub: un `.md` con encabezado YAML (cada valor es JSON, que también es YAML válido).
 *
 *   ---
 *   id: "k3j9x0abcd"
 *   title: "Mi nota"
 *   folder: "Trabajo/Proyectos"   (carpetas anidadas separadas con /)
 *   tags: ["ideas","urgente"]
 *   pinned: true
 *   color: "azul"
 *   created: "2026-01-01T10:00:00.000Z"
 *   updated: "2026-01-02T10:00:00.000Z"
 *   ---
 *   Texto en Markdown…
 */
export function serializeNote(n: Note, folderName: string | null): string {
  const lines = ['---', `id: ${JSON.stringify(n.id)}`, `title: ${JSON.stringify(n.title)}`];
  if (folderName) lines.push(`folder: ${JSON.stringify(folderName)}`);
  if (n.tags.length) lines.push(`tags: ${JSON.stringify(n.tags)}`);
  if (n.pinned) lines.push('pinned: true');
  if (n.trashed) lines.push('trashed: true');
  if (n.color) lines.push(`color: ${JSON.stringify(n.color)}`);
  lines.push(`created: ${JSON.stringify(new Date(n.createdAt).toISOString())}`);
  lines.push(`updated: ${JSON.stringify(new Date(n.updatedAt).toISOString())}`);
  lines.push('---', '');
  return lines.join('\n') + n.body + (n.body.endsWith('\n') ? '' : '\n');
}

export interface ParsedNote {
  id: string;
  title: string;
  folder: string | null;
  tags: string[];
  pinned: boolean;
  trashed: boolean;
  color: NoteColor | null;
  createdAt: number;
  updatedAt: number;
  body: string;
}

export function parseNote(text: string): ParsedNote | null {
  const m = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      meta[key] = JSON.parse(raw);
    } catch {
      meta[key] = raw.replace(/^['"]|['"]$/g, '');
    }
  }
  if (typeof meta.id !== 'string' || !meta.id) return null;
  const time = (v: unknown) => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isFinite(t) ? t : Date.now();
  };
  let body = m[2];
  if (body.endsWith('\n')) body = body.slice(0, -1);
  return {
    id: meta.id,
    title: typeof meta.title === 'string' ? meta.title : '',
    folder: typeof meta.folder === 'string' && meta.folder ? meta.folder : null,
    tags: Array.isArray(meta.tags) ? meta.tags.filter((t): t is string => typeof t === 'string') : [],
    pinned: meta.pinned === true,
    trashed: meta.trashed === true,
    color: NOTE_COLORS.includes(meta.color as NoteColor) ? (meta.color as NoteColor) : null,
    createdAt: time(meta.created),
    updatedAt: time(meta.updated),
    body,
  };
}
