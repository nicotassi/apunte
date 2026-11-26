import { useEffect, useRef, useState, type ReactNode } from 'react';
import { imageURL } from '../lib/images';
import { Icon } from './Icons';

export function IconBtn({ icon, label, onClick, active, size = 20, disabled }: { icon: string; label: string; onClick?: () => void; active?: boolean; size?: number; disabled?: boolean }) {
  return (
    <button className={`icon-btn${active ? ' on' : ''}`} onClick={onClick} aria-label={label} title={label} disabled={disabled} type="button">
      <Icon name={icon} size={size} fill={active && icon === 'pin'} />
    </button>
  );
}

/** Panel que sube desde abajo (menús y selectores). */
export function Sheet({ title, onClose, children }: { title?: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        {title && <div className="sheet-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function SheetItem({ icon, label, onClick, danger, sub }: { icon?: string; label: string; onClick: () => void; danger?: boolean; sub?: string }) {
  return (
    <button className={`sheet-item${danger ? ' danger' : ''}`} onClick={onClick} type="button">
      {icon && <Icon name={icon} size={19} />}
      <span>{label}</span>
      {sub && <span className="muted small sheet-sub">{sub}</span>}
    </button>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string; font?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="group">
      {options.map((o) => (
        <button key={String(o.v)} className={o.v === value ? 'on' : ''} style={o.font ? { fontFamily: o.font } : undefined} onClick={() => onChange(o.v)} type="button">{o.label}</button>
      ))}
    </div>
  );
}

/** Imagen guardada localmente (nombre tipo `abc.jpg`). */
export function AssetImg({ name, alt = '', className }: { name: string; alt?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let ok = true;
    imageURL(name).then((u) => ok && setSrc(u));
    return () => { ok = false; };
  }, [name]);
  if (!src) return <div className={`${className ?? ''} img-ph`} />;
  return <img className={className} src={src} alt={alt} loading="lazy" />;
}

/** Cierra al tocar afuera. */
export function useOutside(cb: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [cb]);
  return ref;
}
