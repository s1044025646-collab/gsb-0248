import {
  createRuleset,
  getReport,
  getRuleset,
  listReports,
  listRulesets,
  parseRules,
  saveReport,
  updateRuleset,
  type RulesetInput,
} from './db.js';
import { AppError } from './errors.js';
import { generate, MAX_GENERATION, MAX_SEGMENTS, MAX_SYMBOLS } from './lsystem.js';
import { toSvg } from './svg.js';
import { interpret, type TurtleParams } from './turtle.js';

export { MAX_GENERATION, MAX_SEGMENTS, MAX_SYMBOLS };

export interface GeneratePreviewInput {
  axiom: string;
  rules: Array<{ symbol: string; replacement: string }>;
  generation: number;
  /** 仅用于 CLI/API 直接预览时的资源限制覆盖（测试用）。 */
  maxSymbols?: number;
}

export interface PreviewOutput {
  generation: number;
  /** 各代长度与截断标志。 */
  generations: Array<{ generation: number; length: number; truncated: boolean }>;
  stringLength: number;
  /** 终端友好：前 N 个字符的片段。 */
  preview: string;
  previewLimit: number;
  status: 'complete' | 'limit_symbols';
}

const PREVIEW_CHARS = 200;

export function previewGenerate(input: GeneratePreviewInput): PreviewOutput {
  const result = generate(input.axiom, input.rules, input.generation, {
    maxSymbols: input.maxSymbols,
  });
  return {
    generation: input.generation,
    generations: result.generations,
    stringLength: result.string.length,
    preview: result.string.slice(0, PREVIEW_CHARS),
    previewLimit: PREVIEW_CHARS,
    status: result.status,
  };
}

export interface InterpretRequest {
  rulesetId: number;
  generation: number;
  params: TurtleParams;
  /** 是否把结果保存为不可变报告。 */
  persist?: boolean;
  maxSymbols?: number;
  maxSegments?: number;
}

export interface InterpretOutput {
  reportId?: number;
  rulesetId: number;
  rulesetVersion: number;
  generation: number;
  stringLength: number;
  rewriteStatus: 'complete' | 'limit_symbols';
  geometryStatus: 'complete' | 'limit_segments';
  generations: Array<{ generation: number; length: number; truncated: boolean }>;
  params: TurtleParams;
  segmentCount: number;
  totalLength: number;
  bounds: ReturnType<typeof interpret>['bounds'];
  segments?: ReturnType<typeof interpret>['segments'];
}

export function interpretRuleset(req: InterpretRequest, includeSegments = false): InterpretOutput {
  const row = getRuleset(req.rulesetId);
  const rules = parseRules(row);
  const gen = generate(row.axiom, rules, req.generation, { maxSymbols: req.maxSymbols });

  if (gen.status === 'limit_symbols') {
    // 截断字符串绝不解释为几何结果，更不能标记为完整。
    throw new AppError(
      'GENERATION_LIMIT',
      `第 ${gen.generations.find((g) => g.truncated)?.generation} 代超过符号上限 ${req.maxSymbols ?? MAX_SYMBOLS}，拒绝解释截断字符串`,
      { generations: gen.generations, limit: req.maxSymbols ?? MAX_SYMBOLS },
    );
  }

  const geo = interpret(gen.string, req.params, req.maxSegments);

  const output: InterpretOutput = {
    rulesetId: row.id,
    rulesetVersion: row.version,
    generation: req.generation,
    stringLength: gen.string.length,
    rewriteStatus: gen.status,
    geometryStatus: geo.status,
    generations: gen.generations,
    params: req.params,
    segmentCount: geo.segmentCount,
    totalLength: geo.totalLength,
    bounds: geo.bounds,
    segments: includeSegments ? geo.segments : undefined,
  };

  if (req.persist) {
    const payload = {
      ...output,
      // 报告保存完整线段（用于重启后导出同一结果），不含瞬态 segments 省略标记。
      segments: geo.segments,
      axiomSnapshot: row.axiom,
      rulesSnapshot: rules,
      string: gen.string,
    };
    output.reportId = saveReport(row.id, row.version, req.generation, payload);
  }

  return output;
}

export interface StoredReport {
  id: number;
  rulesetId: number;
  rulesetVersion: number;
  generation: number;
  createdAt: string;
  payload: Record<string, unknown>;
}

export function readReport(id: number): StoredReport {
  const row = getReport(id);
  return {
    id: row.id,
    rulesetId: row.ruleset_id,
    rulesetVersion: row.ruleset_version,
    generation: row.generation,
    createdAt: row.created_at,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
  };
}

export function reportSvg(id: number): string {
  const report = readReport(id);
  const segments = report.payload.segments as Parameters<typeof toSvg>[0];
  const bounds = report.payload.bounds as Parameters<typeof toSvg>[1];
  if (!Array.isArray(segments) || !bounds) {
    throw new AppError('NOT_FOUND', '报告缺少几何快照数据');
  }
  return toSvg(segments, bounds);
}

export function listAllRulesets() {
  return listRulesets();
}

export function listAllReports(rulesetId?: number) {
  return listReports(rulesetId);
}

export function saveRuleset(input: RulesetInput): ReturnType<typeof getRuleset> {
  // 先跑一遍规范化校验，拒绝非法输入，保证库里只有有效规则。
  generate(input.axiom, input.rules, 0);
  return createRuleset(input);
}

export function modifyRuleset(id: number, input: Partial<RulesetInput>) {
  const existing = getRuleset(id);
  const merged: RulesetInput = {
    name: input.name ?? existing.name,
    axiom: input.axiom ?? existing.axiom,
    rules: input.rules ?? parseRules(existing),
  };
  generate(merged.axiom, merged.rules, 0);
  return updateRuleset(id, merged);
}
