import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';
import { imageURL } from './images';

/**
 * Vista previa en vivo (como Obsidian): el texto se ve con su formato mientras se escribe.
 * Los símbolos de Markdown (**, #, [](), etc.) se ocultan salvo en el trozo donde está el cursor.
 */

const hide = Decoration.replace({});

class Bullet extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('span'); s.className = 'cm-bullet'; s.textContent = '•'; return s; }
}

class Rule extends WidgetType {
  eq() { return true; }
  toDOM() { const s = document.createElement('div'); s.className = 'cm-hr'; return s; }
}

class Check extends WidgetType {
  constructor(readonly checked: boolean) { super(); }
  eq(o: Check) { return o.checked === this.checked; }
  toDOM(view: EditorView) {
    const i = document.createElement('input');
    i.type = 'checkbox';
    i.checked = this.checked;
    i.className = 'cm-task';
    i.addEventListener('mousedown', (e) => e.preventDefault());
    i.addEventListener('click', (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(i);
      if (/^\[[ xX]\]$/.test(view.state.sliceDoc(pos, pos + 3))) view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } });
    });
    return i;
  }
  ignoreEvent() { return true; }
}

class Img extends WidgetType {
  constructor(readonly src: string, readonly alt: string) { super(); }
  eq(o: Img) { return o.src === this.src && o.alt === this.alt; }
  toDOM() {
    const i = document.createElement('img');
    i.className = 'cm-img';
    i.alt = this.alt;
    if (this.src.startsWith('assets/')) void imageURL(this.src.slice(7)).then((u) => { if (u) i.src = u; });
    else if (/^https:\/\//i.test(this.src)) i.src = this.src;
    return i;
  }
}

const cls = (c: string) => Decoration.mark({ class: c });
const line = (c: string) => Decoration.line({ class: c });

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const focused = view.hasFocus;
  const ranges = state.selection.ranges;
  // ¿el cursor/selección toca este tramo? (sin foco, se ve todo formateado)
  const touches = (from: number, to: number) => focused && ranges.some((r) => r.from <= to && r.to >= from);
  const inside = (from: number, to: number) => focused && ranges.some((r) => r.from < to && r.to > from);
  const touchesLine = (pos: number) => { const l = state.doc.lineAt(pos); return touches(l.from, l.to); };
  const out: Range<Decoration>[] = [];
  const lines = (from: number, to: number, f: (n: number, first: boolean, last: boolean) => string) => {
    const a = state.doc.lineAt(from).number;
    const b = state.doc.lineAt(to).number;
    for (let n = a; n <= b; n++) out.push(line(f(n, n === a, n === b)).range(state.doc.line(n).from));
  };
  const hideMark = (from: number, to: number, trailingSpace = false) => {
    const end = trailingSpace && state.sliceDoc(to, to + 1) === ' ' ? to + 1 : to;
    if (end > from) out.push(hide.range(from, end));
  };

  for (const vr of view.visibleRanges) {
    syntaxTree(state).iterate({
      from: vr.from,
      to: vr.to,
      enter: (node) => {
        const name = node.name;
        const h = name.match(/^ATXHeading([1-6])$/) || name.match(/^SetextHeading([12])$/);
        if (h) {
          lines(node.from, node.to, () => `cm-h cm-h${h[1]}`);
          if (name.startsWith('ATX') && !touchesLine(node.from)) {
            for (const m of node.node.getChildren('HeaderMark')) hideMark(m.from, m.to, true);
          }
          return;
        }
        switch (name) {
          case 'StrongEmphasis':
          case 'Emphasis':
          case 'Strikethrough':
          case 'InlineCode': {
            out.push(cls(name === 'StrongEmphasis' ? 'cm-strong' : name === 'Emphasis' ? 'cm-em' : name === 'Strikethrough' ? 'cm-strike' : 'cm-code').range(node.from, node.to));
            if (!touches(node.from, node.to)) {
              for (const m of node.node.getChildren(name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark')) hideMark(m.from, m.to);
            }
            return;
          }
          case 'Link': {
            const marks = node.node.getChildren('LinkMark');
            if (marks.length >= 2) {
              out.push(cls('cm-link').range(marks[0].to, marks[1].from));
              if (!touches(node.from, node.to)) {
                hideMark(node.from, marks[0].to);
                hideMark(marks[1].from, node.to);
              }
            }
            return;
          }
          case 'Image': {
            const m = state.sliceDoc(node.from, node.to).match(/^!\[([^\]]*)\]\(\s*<?([^)\s>]+)/);
            if (m && !inside(node.from, node.to)) out.push(Decoration.replace({ widget: new Img(m[2], m[1]) }).range(node.from, node.to));
            return false;
          }
          case 'QuoteMark':
            lines(node.from, node.from, () => 'cm-quote');
            if (!touchesLine(node.from)) hideMark(node.from, node.to, true);
            return;
          case 'ListMark': {
            const li = node.node.parent;
            const bullet = li?.parent?.name === 'BulletList';
            if (!bullet) { out.push(cls('cm-olmark').range(node.from, node.to)); return; }
            if (touchesLine(node.from)) return;
            if (li?.getChild('Task')) hideMark(node.from, node.to, true);
            else out.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to));
            return;
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            if (checked) lines(node.from, node.from, () => 'cm-done');
            if (!inside(node.from + 1, node.to - 1)) out.push(Decoration.replace({ widget: new Check(checked) }).range(node.from, node.to));
            return;
          }
          case 'FencedCode': {
            const active = touches(node.from, node.to);
            const closed = node.node.getChildren('CodeMark').length >= 2;
            lines(node.from, node.to, (_n, first, last) => {
              const isFence = first || (last && closed);
              return `cm-codeblock${first ? ' cm-cb-first' : ''}${last ? ' cm-cb-last' : ''}${isFence ? ` cm-fence${active ? '' : ' cm-fence-off'}` : ''}`;
            });
            return false;
          }
          case 'HorizontalRule':
            if (!touchesLine(node.from)) out.push(Decoration.replace({ widget: new Rule() }).range(node.from, node.to));
            return;
          case 'Table':
            lines(node.from, node.to, (n, first) => `cm-trow${first ? ' cm-thead' : n === state.doc.lineAt(node.from).number + 1 ? ' cm-tdelim' : ''}`);
            return;
          default:
        }
      },
    });
  }
  return Decoration.set(out, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = build(view); }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
