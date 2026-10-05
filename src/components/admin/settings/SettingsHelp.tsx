import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp } from 'lucide-react';
import styles from './Settings.module.css';

/** Settings-only help: hover, keyboard focus, touch toggle and Escape dismissal. */
export function SettingsHelp({ label, children }: { label: string; children: string }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerWasOpen = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = () => { clearTimeout(timer.current); setOpen(false); };
  const leave = () => { timer.current = setTimeout(() => { if (document.activeElement !== trigger.current) setOpen(false); }, 120); };
  useEffect(() => () => clearTimeout(timer.current), []);
  const place = () => {
    if (!trigger.current || !tooltip.current) return;
    const anchor = trigger.current.getBoundingClientRect();
    const box = tooltip.current.getBoundingClientRect();
    setPosition({
      left: Math.max(16, Math.min(anchor.right - box.width, window.innerWidth - box.width - 16)),
      top: Math.max(16, anchor.bottom + box.height + 8 < window.innerHeight - 16 ? anchor.bottom + 8 : anchor.top - box.height - 8),
    });
  };
  useLayoutEffect(() => { if (open) place(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !tooltip.current?.contains(e.target as Node)) hide(); };
    const dismiss = (e: KeyboardEvent) => { if (e.key === 'Escape') hide(); };
    // PHASE R UI/UX: a scroll (including the browser bringing the focused
    // button into view) moves the tip with its button; it closes only once
    // the button has left the viewport.
    const scroll = (e: Event) => {
      if (tooltip.current?.contains(e.target as Node) || !trigger.current) return;
      const r = trigger.current.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) hide(); else place();
    };
    window.addEventListener('pointerdown', outside); window.addEventListener('keydown', dismiss);
    window.addEventListener('resize', hide); window.addEventListener('scroll', scroll, true);
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', dismiss); window.removeEventListener('resize', hide); window.removeEventListener('scroll', scroll, true); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className={styles.helpButton} aria-label={`Help: ${label}`} aria-describedby={open ? id : undefined}
      onMouseEnter={show} onMouseLeave={leave} onFocus={show} onBlur={hide} onPointerDown={() => { pointerWasOpen.current = open; }} onClick={(e) => setOpen(e.detail ? !pointerWasOpen.current : !open)}>
      <CircleHelp size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={tooltip} id={id} role="tooltip" className={styles.tooltip} style={position} onMouseEnter={show} onMouseLeave={leave}>{children}</div>, document.body)}
  </>;
}
