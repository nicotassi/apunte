import * as db from './db';
import { nid } from './util';

interface ImageRow { name: string; blob: Blob }

const urls = new Map<string, string>();

const MAX_SIDE = 1600;

/** Comprime la imagen (lado máx. 1600px, JPEG) y la guarda local. Devuelve el nombre, ej. `k3j9x0abcd.jpg`. */
export async function addImage(file: Blob): Promise<string> {
  const src = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo comprimir'))), 'image/jpeg', 0.85));
    const name = `${nid()}.jpg`;
    await db.put('images', { name, blob } satisfies ImageRow);
    return name;
  } finally {
    URL.revokeObjectURL(src);
  }
}

export async function imageURL(name: string): Promise<string | null> {
  const hit = urls.get(name);
  if (hit) return hit;
  const row = await db.get<ImageRow>('images', name);
  if (!row) return null;
  const url = URL.createObjectURL(row.blob);
  urls.set(name, url);
  return url;
}

export async function imageDataURL(name: string): Promise<string | null> {
  const row = await db.get<ImageRow>('images', name);
  if (!row) return null;
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => res(null);
    r.readAsDataURL(row.blob);
  });
}

export const imageNames = () => db.keys('images');

export async function getImageBytes(name: string): Promise<Uint8Array | null> {
  const row = await db.get<ImageRow>('images', name);
  return row ? new Uint8Array(await row.blob.arrayBuffer()) : null;
}

export async function putImageBytes(name: string, bytes: Uint8Array): Promise<void> {
  const type = /\.png$/i.test(name) ? 'image/png' : /\.gif$/i.test(name) ? 'image/gif' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
  await db.put('images', { name, blob: new Blob([bytes as BlobPart], { type }) } satisfies ImageRow);
  const old = urls.get(name);
  if (old) { URL.revokeObjectURL(old); urls.delete(name); }
}
