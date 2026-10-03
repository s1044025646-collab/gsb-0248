import './support/segments-env.js';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { LSystemService } from '../src/service.js';
import { Store } from '../src/store.js';

describe('segment budget (LSYSTEM_MAX_SEGMENTS=100)', () => {
  let store: Store;
  let service: LSystemService;

  before(() => {
    const dir = mkdtempSync(join(tmpdir(), 'lsystem-seg-'));
    store = new Store(join(dir, 'seg.db'));
    service = new LSystemService(store);
  });
  after(() => store.close());

  it('returns segment_limit and null geometry without truncation', () => {
    const rs = service.createRuleSet({ name: 'seg', axiom: 'F', rules: { F: 'FF' } });
    const { result } = service.generate(rs.id, {
      generations: 10, // 1024 个 F > 100 上限
      turtle: { step: 1, angleDeg: 90 },
      save: false,
    });
    assert.equal(result.status, 'segment_limit');
    assert.equal(result.geometry, null);
    assert.equal(result.geometryRejected, true);
    assert.equal(result.symbolCount, 1024);
    assert.equal(result.string.length, 1024);
    assert.equal(result.completedGenerations, 10);
  });
});
