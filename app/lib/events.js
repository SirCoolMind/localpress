// Server-sent events: the UI subscribes once and re-renders from what arrives.
const clients = new Set();

export function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write('retry: 1500\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

export function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 20000).unref();
