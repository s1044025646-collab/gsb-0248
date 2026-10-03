import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { AppError } from './errors.js';

export interface RulesetRow {
  id: number;
  name: string;
  axiom: string;
  /** JSON: [{symbol, replacement}]，按插入顺序保存，但生成结果与顺序无关。 */
  rules_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ReportRow {
  id: number;
  ruleset_id: number;
  /** 生成报告时规则集的版本号（快照依据）。 */
  ruleset_version: number;
  generation: number;
  /** 生成与解释的完整快照 JSON：规则、参数、各代长度、状态、线段、包围盒等。 */
  payload_json: string;
  created_at: string;
}

let dbInstance: DatabaseSync | null = null;

export function openDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS rulesets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      axiom TEXT NOT NULL,
      rules_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ruleset_id INTEGER NOT NULL,
      ruleset_version INTEGER NOT NULL,
      generation INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (ruleset_id) REFERENCES rulesets(id)
    );
  `);
  dbInstance = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!dbInstance) {
    throw new AppError('NOT_FOUND', '数据库尚未初始化');
  }
  return dbInstance;
}

export interface RulesetInput {
  name: string;
  axiom: string;
  rules: Array<{ symbol: string; replacement: string }>;
}

export function createRuleset(input: RulesetInput): RulesetRow {
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO rulesets (name, axiom, rules_json) VALUES (?, ?, ?)
     RETURNING id, name, axiom, rules_json, version, created_at, updated_at`,
  );
  try {
    return stmt.get(input.name, input.axiom, JSON.stringify(input.rules)) as unknown as RulesetRow;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new AppError('DUPLICATE_RULE', `规则集名称已存在: ${input.name}`);
    }
    throw err;
  }
}

/** 更新规则集会让 version 自增；旧报告通过 payload_json 快照与 ruleset_version 保持不变。 */
export function updateRuleset(id: number, input: Partial<RulesetInput>): RulesetRow {
  const db = getDb();
  const existing = getRuleset(id);
  const name = input.name ?? existing.name;
  const axiom = input.axiom ?? existing.axiom;
  const rulesJson =
    input.rules !== undefined ? JSON.stringify(input.rules) : existing.rules_json;
  const stmt = db.prepare(
    `UPDATE rulesets SET name = ?, axiom = ?, rules_json = ?,
       version = version + 1, updated_at = datetime('now')
     WHERE id = ?
     RETURNING id, name, axiom, rules_json, version, created_at, updated_at`,
  );
  return stmt.get(name, axiom, rulesJson, id) as unknown as RulesetRow;
}

export function getRuleset(id: number): RulesetRow {
  const db = getDb();
  const row = db.prepare('SELECT * FROM rulesets WHERE id = ?').get(id) as RulesetRow | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', `规则集不存在: id=${id}`);
  }
  return row;
}

export function findRulesetByName(name: string): RulesetRow | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM rulesets WHERE name = ?').get(name) as
    | RulesetRow
    | undefined;
}

export function listRulesets(): Array<Omit<RulesetRow, 'rules_json'>> {
  const db = getDb();
  return db
    .prepare('SELECT id, name, axiom, version, created_at, updated_at FROM rulesets ORDER BY id')
    .all() as Array<Omit<RulesetRow, 'rules_json'>>;
}

export function saveReport(
  rulesetId: number,
  rulesetVersion: number,
  generation: number,
  payload: unknown,
): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO reports (ruleset_id, ruleset_version, generation, payload_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(rulesetId, rulesetVersion, generation, JSON.stringify(payload));
  return Number(result.lastInsertRowid);
}

export function getReport(id: number): ReportRow {
  const db = getDb();
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as ReportRow | undefined;
  if (!row) {
    throw new AppError('NOT_FOUND', `报告不存在: id=${id}`);
  }
  return row;
}

export function listReports(rulesetId?: number): Array<Omit<ReportRow, 'payload_json'>> {
  const db = getDb();
  if (rulesetId !== undefined) {
    return db
      .prepare(
        'SELECT id, ruleset_id, ruleset_version, generation, created_at FROM reports WHERE ruleset_id = ? ORDER BY id',
      )
      .all(rulesetId) as Array<Omit<ReportRow, 'payload_json'>>;
  }
  return db
    .prepare(
      'SELECT id, ruleset_id, ruleset_version, generation, created_at FROM reports ORDER BY id',
    )
    .all() as Array<Omit<ReportRow, 'payload_json'>>;
}

export function parseRules(row: RulesetRow): Array<{ symbol: string; replacement: string }> {
  return JSON.parse(row.rules_json) as Array<{ symbol: string; replacement: string }>;
}
