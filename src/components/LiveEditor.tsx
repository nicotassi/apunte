import { useEffect, useRef } from 'react';
import { EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { livePreview, tablePreview } from '../lib/livepreview';
import { pastedMarkdown } from '../lib/paste';

interface Props {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  autoFocus?: boolean;
  onPasteImages: (files: File[]) => void;
  onReady: (view: EditorView) => void;
}

/** Editor Markdown con vista previa en vivo: se escribe y se ve con formato al mismo tiempo. */
export function LiveEditor({ value, onChange, readOnly, autoFocus, onPasteImages, onReady }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const cb = useRef({ onChange, onPasteImages });
  cb.current = { onChange, onPasteImages };

  useEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          // Enter sobre una cita vacía ("> ") la termina, como en Obsidian.
          Prec.high(keymap.of([{
            key: 'Enter',
            run: (v) => {
              const { from, empty } = v.state.selection.main;
              const l = v.state.doc.lineAt(from);
              if (!empty || from !== l.to || !/^\s*(>\s*)+$/.test(l.text)) return false;
              v.dispatch({ changes: { from: l.from, to: l.to }, selection: { anchor: l.from } });
              return true;
            },
          }])),
          markdown({ base: markdownLanguage }), // incluye su propio Enter (continúa listas) y Backspace
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.lineWrapping,
          placeholder('Escribí algo… (acepta Markdown)'),
          livePreview,
          tablePreview,
          EditorState.readOnly.of(!!readOnly),
          EditorView.editable.of(!readOnly),
          EditorView.contentAttributes.of({ spellcheck: 'true', autocapitalize: 'sentences', autocorrect: 'on' }),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current.onChange(u.state.doc.toString()); }),
          EditorView.domEventHandlers({
            paste(e, v) {
              const data = e.clipboardData;
              if (!data) return false;
              const files = [...data.files].filter((f) => f.type.startsWith('image/'));
              if (files.length) { e.preventDefault(); cb.current.onPasteImages(files); return true; }
              const md = pastedMarkdown(data);
              if (md) { e.preventDefault(); v.dispatch(v.state.replaceSelection(md), { scrollIntoView: true, userEvent: 'input.paste' }); return true; }
              return false;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    onReady(view);
    if (autoFocus) view.focus();
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cambios que llegan de afuera (por ejemplo, de la sincronización) mientras la nota está abierta.
  useEffect(() => {
    const v = viewRef.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value }, annotations: Transaction.addToHistory.of(false) });
  }, [value]);

  return <div ref={host} className="live-editor" />;
}
