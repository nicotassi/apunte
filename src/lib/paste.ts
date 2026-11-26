import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

const td = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  hr: '---',
});
td.use(gfm);
td.remove((n) => ['BUTTON', 'SVG', 'STYLE', 'SCRIPT', 'NOSCRIPT'].includes(n.nodeName.toUpperCase()));

// Bloques de código (ChatGPT y otros traen un encabezado con el lenguaje y un botón "Copiar").
td.addRule('apunteCode', {
  filter: (n) => n.nodeName === 'PRE' && !!(n as HTMLElement).querySelector('code'),
  replacement: (_c, n) => {
    const code = (n as HTMLElement).querySelector('code')!;
    const lang = (code.className.match(/language-([\w+#-]+)/) || [])[1] || '';
    const text = (code.textContent || '').replace(/\n$/, '');
    return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
  },
});

// Fórmulas (KaTeX): se conserva el TeX original en vez del texto duplicado.
td.addRule('apunteMath', {
  filter: (n) => n.nodeType === 1 && (n as HTMLElement).classList.contains('katex'),
  replacement: (_c, n) => {
    const el = n as HTMLElement;
    const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    if (!tex) return el.textContent || '';
    const display = !!el.closest('.katex-display');
    return display ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
  },
});

// Google Docs envuelve todo en un <b style="font-weight:normal">: no es negrita.
td.addRule('apunteFakeBold', {
  filter: (n) => n.nodeName === 'B' && (n as HTMLElement).style?.fontWeight === 'normal',
  replacement: (c) => c,
});

const SEMANTIC = /<(h[1-6]|strong|b|em|i|u|s|del|ul|ol|li|table|pre|code|blockquote|a|img|hr)[\s>/]/i;

/** ¿El HTML del portapapeles trae formato real (títulos, negritas, listas…) o es solo texto con estilos? */
export function hasRichFormat(html: string): boolean {
  return SEMANTIC.test(html);
}

export function htmlToMarkdown(html: string): string {
  const md = td.turndown(html).replace(/ /g, ' ');
  // Turndown deja "-   item": se normaliza a "- item" (sin tocar el contenido de los bloques de código).
  let fence = false;
  const out = md.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; }
    return fence ? line : line.replace(/^(\s*(?:[-*+]|\d+\.))\s{2,}/, '$1 ');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Devuelve el Markdown a insertar al pegar, o null si conviene dejar que el navegador pegue el texto plano. */
export function pastedMarkdown(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  if (!html || !hasRichFormat(html)) return null;
  const md = htmlToMarkdown(html);
  return md || null;
}
