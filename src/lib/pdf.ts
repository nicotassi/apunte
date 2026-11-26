import type { Note } from './types';
import { renderMd } from './md';
import { imageDataURL } from './images';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function inlineImages(html: string): Promise<string> {
  const names = [...new Set([...html.matchAll(/data-asset="([^"]+)"/g)].map((m) => m[1]))];
  const map = new Map<string, string>();
  for (const n of names) {
    const d = await imageDataURL(n);
    if (d) map.set(n, d);
  }
  return html.replace(/<img data-asset="([^"]+)" src="[^"]*"/g, (_m, n) => `<img src="${map.get(n) ?? ''}"`);
}

/**
 * Exporta una o varias notas a PDF usando el diálogo de impresión del sistema ("Guardar como PDF").
 * Se arma una vista de impresión dentro de la misma página (funciona igual en Android, iPhone y computadora).
 */
export async function exportPdf(notes: Note[], title: string): Promise<void> {
  document.getElementById('print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  const parts: string[] = [];
  for (const n of notes) {
    const body = await inlineImages(renderMd(n.body));
    const tags = n.tags.length ? `<p class="print-tags">${n.tags.map((t) => `#${esc(t)}`).join('  ')}</p>` : '';
    parts.push(`<article class="print-note"><h1>${esc(n.title || 'Sin título')}</h1>${tags}<div class="md">${body}</div></article>`);
  }
  root.innerHTML = parts.join('');
  document.body.appendChild(root);

  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map((i) => (i.complete ? Promise.resolve() : i.decode().catch(() => {}))));

  const prevTitle = document.title;
  document.title = title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Apunte';
  const cleanup = () => {
    document.title = prevTitle;
    root.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  // Da un respiro al layout antes de abrir el diálogo.
  await new Promise((r) => setTimeout(r, 80));
  window.print();
}
