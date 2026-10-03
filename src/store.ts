import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppError, ErrorCode, validationError } from './errors.js';
import { assertAsciiString, assertAsciiSymbol } from './lsystem.js';
import type { GenerationResult, RuleSet, RuleSetInput, TurtleParams } from './types.js';

export interface StoredReport {
  id: number;
  ruleset_id: number;
  ruleset_version: number;
  ruleset_name: string;
  axiom_snapshot: string;
  rules_snapshot_json: string;
  generations: number;
  turtle_json: string;
  status: string;
  result_json: string;
  created_at: string;
}

export function defaultDbPath(): string {
  return process.env.LSYSTEM_DB ?? resolve(process.cwd(), 'data', 'lsystem.db');
}

export class Store {
  readonly db: DatabaseSync;

  constructor(dbPath: string = defaultDbPath()) {
    const full = isAbsolute(dbPath) ? dbPath : resolve(process.cwd(), dbPath);
    mkdirSync(dirname(full), { recursive: true });
    this.db = new DatabaseSync(full);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rulesets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS ruleset_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ruleset_id INTEGER NOT NULL REFERENCES rulesets(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        axiom TEXT NOT NULL,
        rules_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (ruleset_id, version)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ruleset_id INTEGER NOT NULL,
        ruleset_version INTEGER NOT NULL,
        ruleset_name TEXT NOT NULL,
        axiom_snapshot TEXT NOT NULL,
        rules_snapshot_json TEXT NOT NULL,
        generations INTEGER NOT NULL,
        turtle_json TEXT NOT NULL,
        status TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_reports_ruleset ON reports(ruleset_id);
    `);
  }

  /** 校验规则集输入并归一化（去掉空名等）。 */
  static validate(input: RuleSetInput): { name: string; axiom: string; rules: Record<string, string>; description: string } {
    if (typeof input?.name !== 'string' || input.name.trim().length === 0) {
      throw validationError('name 不能为空');
    }
    if (typeof input.axiom !== 'string') {
      throw validationError('axiom 必须是字符串（可为空串）');
    }
    assertAsciiString(input.axiom, 'axiom');
    if (input.axiom.length > 100_000) {
      throw validationError('axiom 长度不能超过 100000');
    }
    const rulesObj = input.rules as unknown;
    if (rulesObj === null || typeof rulesObj !== 'object' || Array.isArray(rulesObj)) {
      throw validationError('rules 必须是对象，键为单个 ASCII 符号');
    }
    const rules: Record<string, string> = {};
    for (const [key, value] of Object.entries(rulesObj as Record<string, unknown>)) {
      assertAsciiSymbol(key, '规则键');
      if (typeof value !== 'string') {
        throw validationError(`符号 ${JSON.stringify(key)} 的替换必须是字符串（空串表示删除）`);
      }
      assertAsciiString(value, `符号 ${JSON.stringify(key)} 的替换`);
      if (value.length > 100_000) {
        throw validationError(`符号 ${JSON.stringify(key)} 的替换长度不能超过 100000`);
      }
      rules[key] = value;
    }
    const description = typeof input.description === 'string' ? input.description : '';
    return { name: input.name.trim(), axiom: input.axiom, rules, description };
  }

  /** 新建规则集（版本 1）。 */
  createRuleSet(input: RuleSetInput): RuleSet {
    const v = Store.validate(input);
    try {
      const info = this.db
        .prepare('INSERT INTO rulesets (name, description) VALUES (?, ?)')
        .run(v.name, v.description);
      const id = Number(info.lastInsertRowid);
      this.db
        .prepare(
          'INSERT INTO ruleset_versions (ruleset_id, version, axiom, rules_json) VALUES (?, 1, ?, ?)',
        )
        .run(id, v.axiom, JSON.stringify(v.rules));
      return this.getRuleSet(id)!;
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        throw new AppError(ErrorCode.CONFLICT, `规则集名称 ${JSON.stringify(v.name)} 已存在`);
      }
      throw err;
    }
  }

  /** 更新规则集：成功则追加新版本；输入非法时抛错，旧版本与报告不受影响。 */
  updateRuleSet(id: number, input: RuleSetInput): RuleSet {
    const existing = this.getRuleSet(id);
    if (existing === null) {
      throw new AppError(ErrorCode.NOT_FOUND, `规则集 id=${id} 不存在`);
    }
    const v = Store.validate(input);
    const nextVersion = this.currentVersion(id) + 1;
    const tx = this.db;
    try {
      tx.prepare(
        'INSERT INTO ruleset_versions (ruleset_id, version, axiom, rules_json) VALUES (?, ?, ?, ?)',
      ).run(id, nextVersion, v.axiom, JSON.stringify(v.rules));
      tx.prepare(
        `UPDATE rulesets SET name = ?, description = ?, current_version = ?, updated_at = datetime('now') WHERE id = ?`,
      ).run(v.name, v.description, nextVersion, id);
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) {
        throw new AppError(ErrorCode.CONFLICT, `规则集名称 ${JSON.stringify(v.name)} 已存在`);
      }
      throw err;
    }
    return this.getRuleSet(id)!;
  }

  private currentVersion(id: number): number {
    const row = this.db.prepare('SELECT current_version AS v FROM rulesets WHERE id = ?').get(id) as
      | { v: number }
      | undefined;
    return row?.v ?? 0;
  }

  /** 当前版本号（公开包装）。 */
  getCurrentVersion(id: number): number {
    return this.currentVersion(id);
  }

  getRuleSet(id: number, version?: number): RuleSet | null {
    const head = this.db.prepare('SELECT * FROM rulesets WHERE id = ?').get(id) as
      | {
          id: number;
          name: string;
          description: string;
          current_version: number;
          created_at: string;
        }
      | undefined;
    if (head === undefined) return null;
    const ver = version ?? head.current_version;
    const snap = this.db
      .prepare('SELECT axiom, rules_json FROM ruleset_versions WHERE ruleset_id = ? AND version = ?')
      .get(id, ver) as { axiom: string; rules_json: string } | undefined;
    if (snap === undefined) return null;
    return {
      id: head.id,
      name: head.name,
      description: head.description,
      axiom: snap.axiom,
      rules: JSON.parse(snap.rules_json) as Record<string, string>,
      created_at: head.created_at,
    };
  }

  listRuleSets(): Array<{ id: number; name: string; currentVersion: number; description: string; createdAt: string }> {
    const rows = this.db
      .prepare('SELECT id, name, current_version, description, created_at FROM rulesets ORDER BY id')
      .all() as Array<{
      id: number;
      name: string;
      current_version: number;
      description: string;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      currentVersion: r.current_version,
      description: r.description,
      createdAt: r.created_at,
    }));
  }

  /** 只增：保存一次成功生成的报告快照。 */
  saveReport(args: {
    ruleset: RuleSet;
    version: number;
    generations: number;
    turtle: TurtleParams | null;
    result: GenerationResult;
  }): number {
    const info = this.db
      .prepare(
        `INSERT INTO reports
          (ruleset_id, ruleset_version, ruleset_name, axiom_snapshot, rules_snapshot_json,
           generations, turtle_json, status, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.ruleset.id,
        args.version,
        args.ruleset.name,
        args.ruleset.axiom,
        JSON.stringify(args.ruleset.rules),
        args.generations,
        JSON.stringify(args.turtle),
        args.result.status,
        JSON.stringify(args.result),
      );
    return Number(info.lastInsertRowid);
  }

  getReport(id: number): StoredReport | null {
    const row = this.db.prepare('SELECT * FROM reports WHERE id = ?').get(id) as StoredReport | undefined;
    return row ?? null;
  }

  listReports(rulesetId?: number): Array<{ id: number; rulesetId: number; rulesetVersion: number; status: string; generations: number; createdAt: string }> {
    const sql = rulesetId === undefined
      ? 'SELECT id, ruleset_id, ruleset_version, status, generations, created_at FROM reports ORDER BY id'
      : 'SELECT id, ruleset_id, ruleset_version, status, generations, created_at FROM reports WHERE ruleset_id = ? ORDER BY id';
    const rows = (rulesetId === undefined
      ? (this.db.prepare(sql).all() as Array<Record<string, unknown>>)
      : (this.db.prepare(sql).all(rulesetId) as Array<Record<string, unknown>>)) as Array<{
      id: number;
      ruleset_id: number;
      ruleset_version: number;
      status: string;
      generations: number;
      created_at: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      rulesetId: r.ruleset_id,
      rulesetVersion: r.ruleset_version,
      status: r.status,
      generations: r.generations,
      createdAt: r.created_at,
    }));
  }
}

export function reportToResult(report: StoredReport): GenerationResult {
  return JSON.parse(report.result_json) as GenerationResult;
}
