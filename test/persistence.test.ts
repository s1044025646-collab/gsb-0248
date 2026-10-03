import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getRuleset, listReports, openDb, parseRules } from '../src/db.ts';
import { interpretRuleset, readReport, reportSvg } from '../src/service.ts';

function freshDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lsys-'));
  const path = join(dir, 'test.db');
  openDb(path);
  return path;
}

test('重启后重新打开数据库导出同一结果；修改规则后旧报告保持快照', () => {
  const path = freshDb();
  const db = openDb(path);
  db.prepare('DELETE FROM rulesets').run();
  db.prepare('DELETE FROM reports').run();

  const info = db
    .prepare('INSERT INTO rulesets (name, axiom, rules_json) VALUES (?, ?, ?)')
    .run('tree', 'F', JSON.stringify([{ symbol: 'F', replacement: 'F[+F]F' }]));
  const id = Number(info.lastInsertRowid);

  const first = interpretRuleset(
    { rulesetId: id, generation: 2, params: { step: 5, angleDeg: 25 }, persist: true },
    true,
  );
  assert.ok(first.reportId);
  const reportId = first.reportId as number;
  const svg1 = reportSvg(reportId);
  const firstSegCount = first.segmentCount;

  // 修改规则 -> 版本递增
  db.prepare('UPDATE rulesets SET rules_json = ?, version = version + 1 WHERE id = ?').run(
    JSON.stringify([{ symbol: 'F', replacement: 'FF' }]),
    id,
  );
  const updated = getRuleset(id);
  assert.equal(updated.version, 2);

  // 重新打开数据库（模拟服务重启）
  openDb(path);
  assert.equal(listReports().length, 1);
  const stored = readReport(reportId);
  assert.equal(stored.rulesetVersion, 1);
  assert.equal(stored.payload.segmentCount, firstSegCount);
  assert.deepEqual(stored.payload.rulesSnapshot, [{ symbol: 'F', replacement: 'F[+F]F' }]);
  const svg2 = reportSvg(reportId);
  assert.equal(svg2, svg1);

  // 当前规则已经改变，重新解释新代数结果会不同，但旧报告不变
  const second = interpretRuleset(
    { rulesetId: id, generation: 2, params: { step: 5, angleDeg: 25 } },
    false,
  );
  assert.notEqual(second.segmentCount, firstSegCount);
  const storedAgain = readReport(reportId);
  assert.equal(storedAgain.payload.segmentCount, firstSegCount);
  assert.equal(parseRules(getRuleset(id))[0].replacement, 'FF');
});

test('错误输入不覆盖已保存结果：非法更新被拒绝时行不变', () => {
  const path = freshDb();
  const db = openDb(path);
  db.prepare('DELETE FROM rulesets').run();
  const info = db
    .prepare('INSERT INTO rulesets (name, axiom, rules_json) VALUES (?, ?, ?)')
    .run('ok', 'F', JSON.stringify([{ symbol: 'F', replacement: 'F+F' }]));
  const id = Number(info.lastInsertRowid);

  assert.throws(() => {
    interpretRuleset(
      {
        rulesetId: id,
        generation: 30,
        params: { step: 1, angleDeg: 90 },
      },
      false,
    );
  });
  // 没有任何报告写入
  assert.equal(listReports().length, 0);
  const row = getRuleset(id);
  assert.equal(row.axiom, 'F');
});
