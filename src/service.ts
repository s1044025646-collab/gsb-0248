import { AppError, ErrorCode } from './errors.js';
import { checkBrackets, iterate } from './lsystem.js';
import { reportToResult, Store, type StoredReport } from './store.js';
import { interpret } from './turtle.js';
import {
  LIMITS,
  GenerationStatus,
  type GenerationResult,
  type GeometryResult,
  type RuleSet,
  type RuleSetInput,
  type TurtleParams,
} from './types.js';

export interface GenerateOptions {
  generations: number;
  /** 提供则在字符串生成后解释几何；括号不平衡等错误会整体拒绝。 */
  turtle?: TurtleParams;
  /** 是否把成功结果写入 SQLite 报告。默认 true。 */
  save?: boolean;
  /** 使用规则集的指定版本；默认当前版本。 */
  version?: number;
}

export interface GenerateResponse {
  reportId: number | null;
  result: GenerationResult;
}

export class LSystemService {
  constructor(readonly store: Store) {}

 createRuleSet(input: RuleSetInput): RuleSet {
    return this.store.createRuleSet(input);
  }

  updateRuleSet(id: number, input: RuleSetInput): RuleSet {
    return this.store.updateRuleSet(id, input);
  }

  getRuleSet(id: number, version?: number): RuleSet {
    const rs = this.store.getRuleSet(id, version);
    if (rs === null) {
      throw new AppError(ErrorCode.NOT_FOUND, `规则集 id=${id} 不存在`);
    }
    return rs;
  }

  listRuleSets() {
    return this.store.listRuleSets();
  }

  /** 按代生成；可选解释线段。任何输入错误先抛异常，绝不写入报告。 */
  generate(rulesetId: number, options: GenerateOptions): GenerateResponse {
    const gens = options.generations;
    const rs = this.getRuleSet(rulesetId, options.version);
    const version = options.version ?? this.store.getCurrentVersion(rs.id);

    const outcome = iterate(rs.axiom, rs.rules, gens);
    const finalString = outcome.strings[outcome.strings.length - 1] ?? rs.axiom;

    let geometry: GeometryResult | null = null;
    let geometryRejected = false;
    let status = outcome.status;

    if (options.turtle !== undefined) {
      // 括号不平衡：在任何资源消耗前直接拒绝，不保存报告。
      if (!checkBrackets(finalString)) {
        throw new AppError(
          ErrorCode.UNBALANCED_BRACKETS,
          `第 ${outcome.generations} 代字符串括号不平衡，拒绝生成几何结果`,
        );
      }
      try {
        geometry = interpret(finalString, options.turtle);
      } catch (err) {
        if (err instanceof AppError && err.code === ErrorCode.RESOURCE_LIMIT) {
          status = GenerationStatus.SEGMENT_LIMIT;
          geometry = null;
          geometryRejected = true;
        } else {
          throw err;
        }
      }
    }

    const result: GenerationResult = {
      rulesetId: rs.id,
      rulesetVersion: version,
      requestedGenerations: gens,
      completedGenerations:
        status === GenerationStatus.SEGMENT_LIMIT ? outcome.generations : outcome.generations,
      status,
      lengths: outcome.lengths,
      string: finalString,
      symbolCount: finalString.length,
      limits: { ...LIMITS },
      geometry,
      geometryRejected,
    };

    let reportId: number | null = null;
    if (options.save !== false) {
      reportId = this.store.saveReport({
        ruleset: rs,
        version,
        generations: gens,
        turtle: options.turtle ?? null,
        result,
      });
    }
    return { reportId, result };
  }

  getReport(id: number): { report: StoredReport; result: GenerationResult } {
    const report = this.store.getReport(id);
    if (report === null) {
      throw new AppError(ErrorCode.NOT_FOUND, `报告 id=${id} 不存在`);
    }
    return { report, result: reportToResult(report) };
  }

  listReports(rulesetId?: number) {
    return this.store.listReports(rulesetId);
  }
}
