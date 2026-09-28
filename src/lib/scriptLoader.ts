/**
 * Third-party script helpers (PHASE F). The production CSP allows scripts by
 * per-request nonce; a script added after load must carry the same nonce,
 * which Next.js stamps on its own script tags.
 */
export function scriptNonce(): string {
  // Browsers hide the nonce attribute value; the property still holds it.
  return (document.querySelector('script[nonce]') as HTMLScriptElement | null)?.nonce || '';
}

/** Adds an async external script once (by id). */
export function loadScriptOnce(id: string, src: string, attributes: Record<string, string> = {}): void {
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id;
  script.async = true;
  script.src = src;
  script.nonce = scriptNonce();
  for (const [k, v] of Object.entries(attributes)) script.setAttribute(k, v);
  document.head.appendChild(script);
}
