const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Id corto de 10 caracteres [a-z0-9]. El mismo id va en el nombre del archivo `.md` de GitHub. */
export function nid(): string {
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => ALPHABET[b % 36]).join('');
}

export function slug(s: string, max = 40): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Nombre apto para usar como carpeta en un repo (conserva mayúsculas y acentos). */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim().slice(0, 60) || 'carpeta';
}

export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const d = (...a: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `hace ${Math.floor(s / 86400)} d`;
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function normTag(t: string): string {
  return t.trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').slice(0, 30);
}

export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Una nota recién creada que todavía no tiene nada escrito (no se muestra ni se sincroniza). */
export const isBlank = (n: { title: string; body: string; trashed?: boolean }) => !n.trashed && !n.title.trim() && !n.body.trim();
