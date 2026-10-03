import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { AppError } from '../src/errors.js';
import { BRANCH_TREE, RIGHT_ANGLE } from '../src/examples.js';
import { LSystemService } from '../src/service.js';
import { Store } from '../src/store.js';
import { toSvg } from '../src/svg.js';

const EPS = 1e-9;

describe('service + sqlite', () => {
  let dir = '';
  let dbFile = '';
  let store: Store;
  let service: LSystemService;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'lsystem-'));
    dbFile = join(dir, 'test.db');
    store = new Store(dbFile);
    service = new LSystemService(store);
  });

  after(() => {
    store.close();
  });

  it('full flow: import -> generate -> geometry -> report -> svg', () => {
    const rs = service.createRuleSet(RIGHT_ANGLE);
    const { reportId, result } = service.generate(rs.id, {
      generations: 3,
      turtle: RIGHT_ANGLE.turtle,
    });
    assert.ok(typeof reportId === 'number');
    assert.equal(result.status, 'complete');
    assert.equal(result.lengths.length, 4);
    assert.ok(result.geometry !== null);
    assert.ok(result.geometry.segmentCount > 0);
    const svg = toSvg(result);
    assert.ok(svg.startsWith('<?xml'));
    assert.ok(svg.includes('<line'));
  });

  it('branch tree nested brackets', () => {
    const rs = service.createRuleSet(BRANCH_TREE);
    const { result } = service.generate(rs.id, { generations: 4, turtle: BRANCH_TREE.turtle });
    assert.equal(result.status, 'complete');
    assert.ok(result.geometry!.segmentCount > 0);
    const b = result.geometry!.bounds;
    assert.ok(b.height > 0);
  });

  it('invalid update does not overwrite saved results', () => {
    const rs = service.createRuleSet({ name: 'guard', axiom: 'F', rules: { F: 'FF' } });
    const before = service.generate(rs.id, { generations: 3, turtle: { step: 1, angleDeg: 90 } });
    const versionBefore = store.getCurrentVersion(rs.id);
    assert.throws(
      () =>
        service.updateRuleSet(rs.id, {
          name: 'guard',
          axiom: 'F',
          rules: { bad: 1 as unknown as string },
        }),
      (e: unknown) => e instanceof AppError && e.code === 'VALIDATION_ERROR',
    );
    assert.equal(store.getCurrentVersion(rs.id), versionBefore);
    const reread = service.getReport(before.reportId!).result;
    assert.equal(reread.symbolCount, before.result.symbolCount);
  });

  it('rule update creates a new version; old report snapshot stays unchanged', () => {
    const rs = service.createRuleSet({ name: 'versioned', axiom: 'F', rules: { F: 'FF' } });
    const old = service.generate(rs.id, { generations: 4, turtle: { step: 1, angleDeg: 90 } });
    service.updateRuleSet(rs.id, { name: 'versioned', axiom: 'F', rules: { F: 'F' } });
    assert.equal(store.getCurrentVersion(rs.id), 2);
    const oldReport = service.getReport(old.reportId!).result;
    assert.equal(oldReport.rulesetVersion, 1);
    assert.equal(oldReport.symbolCount, 16);
    const fresh = service.generate(rs.id, {
      generations: 4,
      turtle: { step: 1, angleDeg: 90 },
      save: false,
    });
    assert.equal(fresh.result.symbolCount, 1);
  });

  it('can generate against an explicit old version', () => {
    const rs = service.createRuleSet({ name: 'hist', axiom: 'F', rules: { F: 'FFF' } });
    service.updateRuleSet(rs.id, { name: 'hist', axiom: 'F', rules: { F: 'F' } });
    const v1 = service.generate(rs.id, { generations: 2, save: false, version: 1 });
    assert.equal(v1.result.string, 'FFFFFFFFF');
    assert.equal(service.getRuleSet(rs.id, 1).rules.F, 'FFF');
  });

  it('restart persistence: reopening the same DB yields identical report', () => {
    const rs = service.createRuleSet({ name: 'persist', axiom: 'F+F', rules: { F: 'F-F+F' } });
    const { reportId, result } = service.generate(rs.id, {
      generations: 5,
      turtle: { step: 2.5, angleDeg: 60, initialAngleDeg: 30 },
    });
    store.close();
    const store2 = new Store(dbFile);
    const service2 = new LSystemService(store2);
    const again = service2.getReport(reportId!).result;
    assert.equal(JSON.stringify(again), JSON.stringify(result));
    assert.ok(Math.abs(again.geometry!.totalLength - result.geometry!.totalLength) < EPS);
    store2.close();
    store = new Store(dbFile);
    service = new LSystemService(store);
  });

  it('segment count equals number of F symbols (nested branches)', () => {
    const rs = service.createRuleSet({ name: 'countf', axiom: 'F', rules: { F: 'F[+F]F' } });
    const { result } = service.generate(rs.id, {
      generations: 8,
      turtle: { step: 1, angleDeg: 25 },
      save: false,
    });
    const fCount = result.string.split('').filter((c) => c === 'F').length;
    assert.equal(result.geometry!.segmentCount, fCount);
  });

  it('unbalanced brackets in final string reject geometry and save nothing', () => {
    const rs = service.createRuleSet({ name: 'bracket', axiom: '[', rules: {} });
    assert.throws(
      () => service.generate(rs.id, { generations: 0, turtle: { step: 1, angleDeg: 90 } }),
      (e: unknown) => e instanceof AppError && e.code === 'UNBALANCED_BRACKETS',
    );
  });
});
