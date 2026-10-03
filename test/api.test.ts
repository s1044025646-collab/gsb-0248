import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { LSystemService } from '../src/service.js';
import { startHttp, type HttpServer } from '../src/server.js';
import { Store } from '../src/store.js';

describe('HTTP API', () => {
  let http: HttpServer;
  let base: string;
  let store: Store;

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lsystem-api-'));
    store = new Store(join(dir, 'api.db'));
    const service = new LSystemService(store);
    http = await startHttp(service);
    base = `http://127.0.0.1:${http.port}`;
  });

  after(async () => {
    await http.close();
    store.close();
  });

  it('health and limits', async () => {
    const h = await fetch(`${base}/health`);
    assert.equal(h.status, 200);
    assert.deepEqual(await h.json(), { ok: true });
    const l = await (await fetch(`${base}/limits`)).json() as { maxGenerations: number };
    assert.equal(l.maxGenerations, 12);
  });

  it('create, generate with geometry, fetch report and svg', async () => {
    const create = await fetch(`${base}/api/rulesets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'api-koch', axiom: 'F', rules: { F: 'F+F-F' } }),
    });
    assert.equal(create.status, 201);
    const rs = (await create.json()) as { id: number };

    const gen = await fetch(`${base}/api/rulesets/${rs.id}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generations: 3, turtle: { step: 5, angleDeg: 90 } }),
    });
    assert.equal(gen.status, 200);
    const body = (await gen.json()) as { reportId: number; result: { status: string } };
    assert.equal(body.result.status, 'complete');
    assert.ok(body.reportId > 0);

    const rep = await fetch(`${base}/api/reports/${body.reportId}`);
    assert.equal(rep.status, 200);

    const svg = await fetch(`${base}/api/reports/${body.reportId}/svg`);
    assert.equal(svg.status, 200);
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.ok((await svg.text()).includes('<svg'));
  });

  it('validation error has explicit code; 404 for missing resource', async () => {
    const bad = await fetch(`${base}/api/rulesets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', axiom: 'F', rules: {} }),
    });
    assert.equal(bad.status, 400);
    const j = (await bad.json()) as { code: string };
    assert.equal(j.code, 'VALIDATION_ERROR');

    const missing = await fetch(`${base}/api/rulesets/9999`);
    assert.equal(missing.status, 404);
  });

  it('unbalanced brackets -> 422 with code', async () => {
    const create = await fetch(`${base}/api/rulesets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'api-bad', axiom: '[', rules: {} }),
    });
    const rs = (await create.json()) as { id: number };
    const gen = await fetch(`${base}/api/rulesets/${rs.id}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ generations: 0, turtle: { step: 1, angleDeg: 90 } }),
    });
    assert.equal(gen.status, 422);
    const j = (await gen.json()) as { code: string };
    assert.equal(j.code, 'UNBALANCED_BRACKETS');
  });
});
