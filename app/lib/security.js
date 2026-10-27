// Request gate for the local server (docs/DESIGN.md "Server security").

export function allowedOrigins(port) {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
}

/**
 * Returns null when the request may proceed, or a short reason when it must be rejected.
 * - Host must be our own address (blocks DNS rebinding).
 * - Requests that change state must come from our own page (Origin check).
 * - Browsers label cross-site loads with Sec-Fetch-Site; refuse those even for GET so other
 *   sites cannot embed library media.
 */
export function rejectReason(req, port) {
  const host = req.headers.host;
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'bad host';

  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return 'cross-site request';

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (!allowedOrigins(port).includes(req.headers.origin)) return 'bad origin';
  }
  return null;
}
