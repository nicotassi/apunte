import type { Note } from './types';
import { isBlank } from './util';

/** [[Título]] o [[Título|texto a mostrar]] */
export const WIKI_RE = /\[\[([^\]\n|]+?)(?:\|([^\]\n]+?))?\]\]/g;

/** Para comparar títulos sin importar mayúsculas, acentos ni espacios de más. */
export const normTitle = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[[\]|]/g, ' ').replace(/\s+/g, ' ').trim();

/** Un título apto para ir dentro de [[ ]]. */
export const cleanTitle = (s: string) => s.replace(/[[\]|\n]/g, ' ').replace(/\s+/g, ' ').trim();

const list = (n: Record<string, Note> | Note[]) => (Array.isArray(n) ? n : Object.values(n));
const live = (n: Note) => !n.trashed && !isBlank(n);

/** La nota a la que apunta un enlace (si hay varias con el mismo título, la más reciente). */
export function findNote(target: string, notes: Record<string, Note> | Note[]): Note | undefined {
  const t = normTitle(target);
  if (!t) return undefined;
  return list(notes).filter((n) => live(n) && normTitle(n.title) === t).sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/** Notas sugeridas mientras se escribe [[…: primero las que empiezan con lo escrito, después las que lo contienen. */
export function candidates(query: string, notes: Record<string, Note> | Note[], excludeId?: string, limit = 8): Note[] {
  const q = normTitle(query);
  const pool = list(notes).filter((n) => live(n) && n.id !== excludeId && n.title.trim());
  const rank = (n: Note) => {
    const t = normTitle(n.title);
    if (!q) return 2;
    if (t === q) return 0;
    if (t.startsWith(q)) return 1;
    return t.includes(q) ? 2 : 9;
  };
  return pool.filter((n) => rank(n) < 9).sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt).slice(0, limit);
}

/** Las notas que enlazan a esta (por su título). */
export function backlinks(note: Note, notes: Record<string, Note> | Note[]): Note[] {
  const t = normTitle(note.title);
  if (!t) return [];
  return list(notes)
    .filter((n) => n.id !== note.id && live(n) && [...n.body.matchAll(WIKI_RE)].some((m) => normTitle(m[1]) === t))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Cambia el título en los enlaces [[viejo]] → [[nuevo]] (conserva el texto a mostrar si lo hay). */
export function renameLinksInBody(body: string, oldTitle: string, newTitle: string): string {
  const o = normTitle(oldTitle);
  const nt = cleanTitle(newTitle);
  return body.replace(WIKI_RE, (m, target: string, alias?: string) => (normTitle(target) === o ? `[[${nt}${alias ? `|${alias}` : ''}]]` : m));
}

/** En vistas de texto (tarjetas, búsqueda): [[Título|texto]] → texto. */
export const stripWikiLinks = (s: string) => s.replace(WIKI_RE, (_m, t: string, a?: string) => (a ?? t));

/** HTML (para el PDF): los enlaces quedan como texto destacado, sin tocar el código. */
export function wikiHtml(html: string): string {
  let code = 0;
  return html.replace(/<(\/?)(pre|code)\b[^>]*>|<[^>]+>|[^<]+/g, (tok, close?: string, tag?: string) => {
    if (tag) { code += close ? -1 : 1; return tok; }
    if (tok.startsWith('<') || code > 0) return tok;
    return tok.replace(WIKI_RE, (_m, t: string, a?: string) => `<span class="wikilink">${a ?? t}</span>`);
  });
}
