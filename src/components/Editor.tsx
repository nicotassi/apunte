import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import { useStore, updateNote, deleteForever, dropIfEmpty, addFolder } from '../lib/store';
import { closeOverlay, type Route } from '../lib/router';
import { hasRichFormat, htmlToMarkdown } from '../lib/paste';
import { addImage } from '../lib/images';
import { exportPdf } from '../lib/pdf';
import { downloadNoteMd } from '../lib/io';
import { ago, normTag } from '../lib/util';
import { Icon } from './Icons';
import { IconBtn, Sheet, SheetItem } from './ui';
import { LiveEditor } from './LiveEditor';

export function Editor({ id, route }: { id: string; route: Route }) {
  const note = useStore((s) => s.notes[id]);
  const folders = useStore((s) => s.folders);
  const allNotes = useStore((s) => s.notes);

  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [sheet, setSheet] = useState<null | 'more' | 'folder'>(null);
  const [tagText, setTagText] = useState('');
  const [toast, setToast] = useState('');

  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const latest = useRef({ title, body });
  latest.current = { title, body };

  const readOnly = !!note?.trashed;

  const flush = useCallback(() => {
    if (!dirty.current) return;
    dirty.current = false;
    updateNote(id, { title: latest.current.title, body: latest.current.body });
  }, [id]);

  // Guarda con una pequeña pausa mientras se escribe, y al salir.
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(flush, 300);
    return () => clearTimeout(t);
  }, [title, body, flush]);
  useEffect(() => () => { flush(); dropIfEmpty(id); }, [id, flush]);

  // Si la nota cambió desde afuera (sincronización) y no hay ediciones pendientes, se refleja.
  useEffect(() => {
    if (!note || dirty.current) return;
    if (note.title !== latest.current.title) setTitle(note.title);
    if (note.body !== latest.current.body) setBody(note.body);
  }, [note?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(''), 2200); };
  const close = () => { flush(); closeOverlay(route); };

  const edit = (next: string) => {
    dirty.current = true;
    setBody(next);
  };

  /* ───── acciones de la barra (actúan sobre el editor en vivo) ───── */
  const wrap = (pre: string, post = pre, ph = 'texto') => {
    const v = viewRef.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const doc = v.state.doc;
    // si ya está envuelto, se quita el formato
    if (from > 0 && doc.sliceString(from - pre.length, from) === pre && doc.sliceString(to, to + post.length) === post && from !== to) {
      v.dispatch({ changes: [{ from: from - pre.length, to: from }, { from: to, to: to + post.length }], selection: { anchor: from - pre.length, head: to - pre.length } });
    } else {
      const chosen = doc.sliceString(from, to) || ph;
      v.dispatch({ changes: { from, to, insert: pre + chosen + post }, selection: { anchor: from + pre.length, head: from + pre.length + chosen.length } });
    }
    v.focus();
  };
  const linePrefix = (prefix: string) => {
    const v = viewRef.current;
    if (!v) return;
    const { from, to } = v.state.selection.main;
    const a = v.state.doc.lineAt(from).number;
    const b = v.state.doc.lineAt(to).number;
    const ls = Array.from({ length: b - a + 1 }, (_, i) => v.state.doc.line(a + i));
    const has = ls.every((l) => l.text.startsWith(prefix));
    v.dispatch({
      changes: ls.map((l) => {
        if (has) return { from: l.from, to: l.from + prefix.length };
        const old = prefix.startsWith('#') ? (l.text.match(/^#{1,6} /)?.[0].length ?? 0) : 0;
        return { from: l.from, to: l.from + old, insert: prefix };
      }),
    });
    v.focus();
  };
  const insertText = (text: string) => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch(v.state.replaceSelection(text), { scrollIntoView: true });
    v.focus();
  };
  const addImages = async (files: File[]) => {
    try {
      let out = '';
      for (const f of files) out += `\n![](assets/${await addImage(f)})\n`;
      insertText(out);
    } catch {
      say('No pude cargar la imagen');
    }
  };
  const pasteFromClipboard = async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const it of items) {
        const img = it.types.find((t) => t.startsWith('image/'));
        if (img) { await addImages([new File([await it.getType(img)], 'pegada', { type: img })]); return; }
        if (it.types.includes('text/html')) {
          const html = await (await it.getType('text/html')).text();
          if (hasRichFormat(html)) { insertText(htmlToMarkdown(html)); return; }
        }
        if (it.types.includes('text/plain')) { insertText(await (await it.getType('text/plain')).text()); return; }
      }
    } catch {
      try { insertText(await navigator.clipboard.readText()); } catch { say('Mantené apretado en el texto y elegí "Pegar"'); }
    }
  };

  /* ───── tags y carpeta ───── */
  const knownTags = useMemo(() => [...new Set(Object.values(allNotes).flatMap((n) => n.tags))].sort(), [allNotes]);
  const addTag = (raw: string) => {
    const t = normTag(raw);
    if (t && note && !note.tags.includes(t)) updateNote(id, { tags: [...note.tags, t] });
    setTagText('');
  };

  if (!note) return null;
  const folder = note.folderId ? folders[note.folderId] : null;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;

  const doPdf = async () => {
    flush();
    setSheet(null);
    await exportPdf([{ ...note, title, body }], title || 'Nota');
  };
  const trash = () => {
    flush();
    updateNote(id, { trashed: true });
    close();
  };

  return (
    <div className="editor-wrap">
      <div className="editor">
        <header className="ed-head">
          <IconBtn icon="back" label="Volver" onClick={close} />
          <div className="grow" />
          {!readOnly && <IconBtn icon="pin" label={note.pinned ? 'Desfijar' : 'Fijar'} active={note.pinned} onClick={() => updateNote(id, { pinned: !note.pinned })} />}
          <IconBtn icon="more" label="Más opciones" onClick={() => setSheet('more')} />
        </header>

        {readOnly && (
          <div className="banner">
            <span>Esta nota está en la papelera.</span>
            <button className="btn small" onClick={() => { updateNote(id, { trashed: false }); }} type="button">Restaurar</button>
            <button className="btn small danger" onClick={() => { if (confirm('¿Eliminar para siempre?')) { closeOverlay(route); setTimeout(() => deleteForever(id), 50); } }} type="button">Eliminar</button>
          </div>
        )}

        <div className="ed-scroll">
          <input
            className="ed-title"
            placeholder="Título"
            value={title}
            readOnly={readOnly}
            onChange={(e) => { dirty.current = true; setTitle(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); viewRef.current?.focus(); } }}
          />

          <div className="ed-meta">
            <button className="chip btn folder" onClick={() => !readOnly && setSheet('folder')} type="button">
              <Icon name="folder" size={12} />{folder ? folder.name : 'Sin carpeta'}
            </button>
            {note.tags.map((t) => (
              <span className="chip" key={t}>
                #{t}
                {!readOnly && <button className="chip-x" onClick={() => updateNote(id, { tags: note.tags.filter((x) => x !== t) })} aria-label={`Quitar ${t}`} type="button">×</button>}
              </span>
            ))}
            {!readOnly && (
              <input
                className="tag-input"
                placeholder="+ tag"
                value={tagText}
                list="known-tags"
                onChange={(e) => { const v = e.target.value; if (/[,\s]$/.test(v)) addTag(v); else setTagText(v); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagText); } else if (e.key === 'Backspace' && !tagText && note.tags.length) updateNote(id, { tags: note.tags.slice(0, -1) }); }}
                onBlur={() => tagText && addTag(tagText)}
              />
            )}
            <datalist id="known-tags">{knownTags.filter((t) => !note.tags.includes(t)).map((t) => <option key={t} value={t} />)}</datalist>
          </div>

          <LiveEditor
            key={String(readOnly)}
            value={body}
            readOnly={readOnly}
            autoFocus={!note.body && !note.title}
            onChange={edit}
            onPasteImages={(f) => void addImages(f)}
            onReady={(v) => { viewRef.current = v; }}
          />

          <div className="ed-foot muted tiny">
            {words} {words === 1 ? 'palabra' : 'palabras'} · editada {ago(note.updatedAt)}
          </div>
        </div>

        {!readOnly && (
          <div className="toolbar" onMouseDown={(e) => e.preventDefault()}>
            <button onClick={() => wrap('**')} aria-label="Negrita" type="button"><Icon name="bold" /></button>
            <button onClick={() => wrap('*')} aria-label="Cursiva" type="button"><Icon name="italic" /></button>
            <button onClick={() => linePrefix('## ')} aria-label="Título" type="button"><Icon name="heading" /></button>
            <button onClick={() => linePrefix('- ')} aria-label="Lista" type="button"><Icon name="list" /></button>
            <button onClick={() => linePrefix('- [ ] ')} aria-label="Lista de tareas" type="button"><Icon name="check" /></button>
            <button onClick={() => linePrefix('> ')} aria-label="Cita" type="button"><Icon name="quote" /></button>
            <button onClick={() => wrap('`')} aria-label="Código" type="button"><Icon name="code" /></button>
            <button onClick={() => { const v = viewRef.current; if (!v) return; const { from, to } = v.state.selection.main; const t = v.state.sliceDoc(from, to) || 'texto'; v.dispatch({ changes: { from, to, insert: `[${t}](https://)` }, selection: { anchor: from + t.length + 3, head: from + t.length + 11 } }); v.focus(); }} aria-label="Enlace" type="button"><Icon name="link" /></button>
            <button onClick={() => fileRef.current?.click()} aria-label="Insertar imagen" type="button"><Icon name="image" /></button>
            <button onClick={() => void pasteFromClipboard()} aria-label="Pegar con formato" type="button"><Icon name="clipboard" /></button>
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) void addImages(f); }} />
        {toast && <div className="toast">{toast}</div>}
      </div>

      {sheet === 'more' && (
        <Sheet title="Opciones" onClose={() => setSheet(null)}>
          {!readOnly && <SheetItem icon="folder" label="Mover a carpeta" onClick={() => setSheet('folder')} />}
          <SheetItem icon="pdf" label="Exportar a PDF" onClick={() => void doPdf()} />
          <SheetItem icon="download" label="Descargar como .md" onClick={() => { flush(); downloadNoteMd({ ...note, title, body }); setSheet(null); }} />
          <SheetItem icon="copy" label="Copiar Markdown" onClick={() => { void navigator.clipboard?.writeText(body).then(() => say('Copiado')); setSheet(null); }} />
          {!readOnly && <SheetItem icon="trash" label="Mover a la papelera" danger onClick={trash} />}
        </Sheet>
      )}
      {sheet === 'folder' && (
        <Sheet title="Carpeta" onClose={() => setSheet(null)}>
          <SheetItem icon="notes" label="Sin carpeta" sub={!note.folderId ? '✓' : undefined} onClick={() => { updateNote(id, { folderId: null }); setSheet(null); }} />
          {Object.values(folders).sort((a, b) => a.name.localeCompare(b.name, 'es')).map((f) => (
            <SheetItem key={f.id} icon="folder" label={f.name} sub={note.folderId === f.id ? '✓' : undefined} onClick={() => { updateNote(id, { folderId: f.id }); setSheet(null); }} />
          ))}
          <SheetItem icon="plus" label="Nueva carpeta…" onClick={() => { const n = window.prompt('Nombre de la carpeta'); const fid = n ? addFolder(n) : null; if (fid) updateNote(id, { folderId: fid }); setSheet(null); }} />
        </Sheet>
      )}
    </div>
  );
}
