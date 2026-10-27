import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rejectReason } from '../../app/lib/security.js';
import { safeJoin } from '../../app/lib/http.js';

const req = (method, headers) => ({ method, headers });
const PORT = 7878;

test('accepts our own page', () => {
  assert.equal(rejectReason(req('GET', { host: '127.0.0.1:7878' }), PORT), null);
  assert.equal(rejectReason(req('GET', { host: 'localhost:7878', 'sec-fetch-site': 'same-origin' }), PORT), null);
  assert.equal(rejectReason(req('POST', { host: '127.0.0.1:7878', origin: 'http://127.0.0.1:7878' }), PORT), null);
});

test('rejects other hosts (DNS rebinding)', () => {
  assert.equal(rejectReason(req('GET', { host: 'evil.example:7878' }), PORT), 'bad host');
  assert.equal(rejectReason(req('GET', { host: '127.0.0.1:9999' }), PORT), 'bad host');
  assert.equal(rejectReason(req('GET', {}), PORT), 'bad host');
});

test('rejects state changes without our Origin', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(rejectReason(req(method, { host: '127.0.0.1:7878' }), PORT), 'bad origin');
    assert.equal(rejectReason(req(method, { host: '127.0.0.1:7878', origin: 'http://evil.example' }), PORT), 'bad origin');
    assert.equal(rejectReason(req(method, { host: '127.0.0.1:7878', origin: 'null' }), PORT), 'bad origin');
  }
});

test('rejects cross-site loads even for GET', () => {
  assert.equal(rejectReason(req('GET', { host: '127.0.0.1:7878', 'sec-fetch-site': 'cross-site' }), PORT), 'cross-site request');
  assert.equal(rejectReason(req('GET', { host: '127.0.0.1:7878', 'sec-fetch-site': 'same-site' }), PORT), 'cross-site request');
});

test('safeJoin keeps paths inside the base', () => {
  assert.match(safeJoin('C:\\app\\ui', 'js/app.js'), /app\\ui\\js\\app\.js$/);
  assert.throws(() => safeJoin('C:\\app\\ui', '../server.js'));
  assert.throws(() => safeJoin('C:\\app\\ui', '..\\..\\Windows\\win.ini'));
});
