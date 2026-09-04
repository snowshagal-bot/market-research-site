import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = await readFile(new URL('../admin/index.html', import.meta.url), 'utf8');
const guardSource = html.match(/<script id="admin-early-drop-guard">([\s\S]*?)<\/script>/)?.[1];

function loadGuard() {
  assert.ok(guardSource, 'inline early drop guard must exist');
  const listeners = new Map();
  const status = { textContent: '' };
  const window = {};
  const document = {
    addEventListener(type, handler, capture) { listeners.set(type, { handler, capture }); },
    getElementById(id) { return id === 'parse-status' ? status : null; }
  };
  vm.runInNewContext(guardSource, { window, document });
  return { document, listeners, status, window };
}

function eventFor(type, target, file) {
  return {
    type,
    target,
    dataTransfer: { files: file ? [file] : [] },
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; }
  };
}

const dropZoneTarget = () => ({ closest: selector => selector === '#drop-zone' ? {} : null });
const outsideTarget = () => ({ closest: () => null });

test('early drop guard is installed in head before the visible drop zone', () => {
  assert.ok(html.indexOf('id="admin-early-drop-guard"') < html.indexOf('</head>'));
  assert.ok(html.indexOf('</head>') < html.indexOf('id="drop-zone"'));
  const { listeners } = loadGuard();
  assert.equal(listeners.get('dragover')?.capture, true);
  assert.equal(listeners.get('drop')?.capture, true);
  assert.equal(listeners.get('change')?.capture, true);
});

test('drop-zone HTML dropped before readiness cannot navigate and is queued', () => {
  const { listeners, status, window } = loadGuard();
  const file = { name: 'early.html' };
  const event = eventFor('drop', dropZoneTarget(), file);

  listeners.get('drop').handler(event);

  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(window.__SNOWSHAGAL_PENDING_REPORT_FILE__, file);
  assert.match(status.textContent, /선택한 파일은 잠시 보관합니다/);
});

test('ready guard prevents navigation without blocking the existing drop handler', () => {
  const { listeners, window } = loadGuard();
  window.__SNOWSHAGAL_ADMIN_READY__ = true;
  const event = eventFor('drop', dropZoneTarget(), { name: 'ready.html' });

  listeners.get('drop').handler(event);

  assert.equal(event.prevented, true);
  assert.equal(event.stopped, false);
  assert.equal(window.__SNOWSHAGAL_PENDING_REPORT_FILE__, null);
});

test('drops outside #drop-zone are not changed by the admin guard', () => {
  const { listeners, window } = loadGuard();
  const event = eventFor('drop', outsideTarget(), { name: 'outside.html' });

  listeners.get('drop').handler(event);

  assert.equal(event.prevented, false);
  assert.equal(event.stopped, false);
  assert.equal(window.__SNOWSHAGAL_PENDING_REPORT_FILE__, null);
});

test('early dragover is navigation-safe without manufacturing a pending file', () => {
  const { listeners, window } = loadGuard();
  const event = eventFor('dragover', dropZoneTarget());

  listeners.get('dragover').handler(event);

  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(window.__SNOWSHAGAL_PENDING_REPORT_FILE__, null);
});

test('file selected before readiness is queued without changing the existing picker flow', () => {
  const { listeners, status, window } = loadGuard();
  const file = { name: 'early-picker.html' };
  const event = {
    target: { id: 'html-file', files: [file] },
    stopped: false,
    stopPropagation() { this.stopped = true; }
  };

  listeners.get('change').handler(event);

  assert.equal(event.stopped, true);
  assert.equal(window.__SNOWSHAGAL_PENDING_REPORT_FILE__, file);
  assert.match(status.textContent, /선택한 파일은 잠시 보관합니다/);
});

test('file picker change after readiness remains with the existing handler', () => {
  const { listeners, window } = loadGuard();
  window.__SNOWSHAGAL_ADMIN_READY__ = true;
  const event = {
    target: { id: 'html-file', files: [{ name: 'ready-picker.html' }] },
    stopped: false,
    stopPropagation() { this.stopped = true; }
  };

  listeners.get('change').handler(event);

  assert.equal(event.stopped, false);
  assert.equal(window.__SNOWSHAGAL_PENDING_REPORT_FILE__, null);
});

test('early change outside the HTML picker is untouched', () => {
  const { listeners, window } = loadGuard();
  const event = {
    target: { id: 'cover-file', files: [{ name: 'cover.webp' }] },
    stopped: false,
    stopPropagation() { this.stopped = true; }
  };

  listeners.get('change').handler(event);

  assert.equal(event.stopped, false);
  assert.equal(window.__SNOWSHAGAL_PENDING_REPORT_FILE__, null);
});
