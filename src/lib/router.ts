import { useEffect, useState } from 'react';

export interface Route {
  view: 'all' | 'folder' | 'tag' | 'trash';
  arg?: string; // id de carpeta o tag
  note?: string; // id de la nota abierta
  settings?: boolean;
}

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  const r: Route = { view: 'all' };
  if (parts[0] === 'f' && parts[1]) { r.view = 'folder'; r.arg = decodeURIComponent(parts[1]); }
  else if (parts[0] === 't' && parts[1]) { r.view = 'tag'; r.arg = decodeURIComponent(parts[1]); }
  else if (parts[0] === 'trash') r.view = 'trash';
  if (q.get('n')) r.note = q.get('n')!;
  if (q.get('s')) r.settings = true;
  return r;
}

export function buildHash(r: Route): string {
  let p = '#/';
  if (r.view === 'folder') p += `f/${encodeURIComponent(r.arg ?? '')}`;
  else if (r.view === 'tag') p += `t/${encodeURIComponent(r.arg ?? '')}`;
  else if (r.view === 'trash') p += 'trash';
  const q = new URLSearchParams();
  if (r.note) q.set('n', r.note);
  if (r.settings) q.set('s', '1');
  const qs = q.toString();
  return qs ? `${p}?${qs}` : p;
}

// ¿Hay una pantalla encima (editor/ajustes) abierta desde dentro de la app? Entonces "cerrar" = volver atrás en el historial.
let canBack = false;

export function useRoute(): Route {
  const [r, setR] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => {
      const next = parseHash(location.hash);
      if (!next.note && !next.settings) canBack = false;
      setR(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return r;
}

export function navigate(r: Route, replace = false) {
  const h = buildHash(r);
  if (!replace && (r.note || r.settings)) canBack = true;
  if (replace) history.replaceState(null, '', h), window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}

/** Cierra el editor/ajustes volviendo a la lista actual. */
export function closeOverlay(r: Route) {
  if (canBack) history.back();
  else navigate({ view: r.view, arg: r.arg }, true);
}
