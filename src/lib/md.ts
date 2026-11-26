import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/** Markdown → HTML seguro. Las imágenes `assets/x.jpg` quedan marcadas con data-asset para resolverlas desde IndexedDB. */
export function renderMd(src: string): string {
  const raw = marked.parse(src, { async: false }) as string;
  const clean = DOMPurify.sanitize(raw.replace(/<input disabled="" /g, '<input '), {
    ADD_TAGS: ['input'],
    ADD_ATTR: ['checked', 'type', 'target'],
  });
  return clean.replace(/<img src="assets\/([^"]+)"/g, `<img data-asset="$1" src="${BLANK}"`);
}

/** Texto plano para las vistas previas de las tarjetas. */
export function plainText(md: string): string {
  return md
    .replace(/```[\w+-]*\n?/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^(\s*)[-*+] \[ \]/gm, '$1☐')
    .replace(/^(\s*)[-*+] \[[xX]\]/gm, '$1☑')
    .replace(/^(\s*)[-*+] /gm, '$1• ')
    .replace(/^\s*>\s?/gm, '')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export function firstImage(md: string): string | null {
  return md.match(/!\[[^\]]*\]\(assets\/([^)\s]+)\)/)?.[1] ?? null;
}

/** Cambia el N-ésimo checkbox `- [ ]` / `- [x]` del texto (en orden de aparición, ignorando bloques de código). */
export function toggleTask(body: string, index: number): string {
  const lines = body.split('\n');
  let fence = false;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const m = lines[i].match(/^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/);
    if (!m) continue;
    if (n === index) {
      lines[i] = m[1] + (m[2] === ' ' ? 'x' : ' ') + lines[i].slice(m[0].length - 1);
      break;
    }
    n++;
  }
  return lines.join('\n');
}
