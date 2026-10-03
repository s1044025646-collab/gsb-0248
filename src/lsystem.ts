import { AppError, ErrorCode } from './errors.js';
import {
  GenerationStatus,
  LIMITS,
  type GenerationStatusValue,
} from './types.js';

const ASCII_RE = /^[\x20-\x7E]$/;

/** 校验单个 ASCII 符号。 */
export function assertAsciiSymbol(ch: string, field: string): void {
  if (!ASCII_RE.test(ch)) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `${field} 必须是单个 ASCII 字符（0x20-0x7E），实际为 ${JSON.stringify(ch)}`,
    );
  }
}

/** 校验字符串全部由 ASCII 字符组成（允许空串）。 */
export function assertAsciiString(s: string, field: string): void {
  for (const ch of s) {
    if (!ASCII_RE.test(ch)) {
      throw new AppError(
        ErrorCode.VALIDATION,
        `${field} 只能包含 ASCII 字符（0x20-0x7E），发现 ${JSON.stringify(ch)}`,
      );
    }
  }
}

/**
 * 确定性、无上下文、单符号并行替换。
 *
 * 关键点：替换表按「本代」的每个符号查一次。新串整体构建后才作为下一代，
 * 新写入的字符在本次迭代中不会再次查表（与规则在表中的顺序无关）。
 * 无规则的符号原样保留；映射到空串表示删除。
 */
export function rewriteOnce(current: string, rules: Readonly<Record<string, string>>): string {
  let out = '';
  for (const ch of current) {
    out += Object.prototype.hasOwnProperty.call(rules, ch) ? rules[ch] : ch;
  }
  return out;
}

/** 计算下一代长度（用于在不构造字符串的情况下预判超限）。 */
export function nextLength(current: string, rules: Readonly<Record<string, string>>): number {
  let total = 0;
  for (const ch of current) {
    total += Object.prototype.hasOwnProperty.call(rules, ch) ? (rules[ch]?.length ?? 0) : 1;
  }
  return total;
}

export interface IterationOutcome {
  generations: number;
  strings: string[];
  lengths: number[];
  status: GenerationStatusValue;
  /** 触限时代号（哪一代的输出会超限）。 */
  limitedAt: number | null;
}

/**
 * 有界多代生成。
 *
 * @param axiom 第 0 代字符串
 * @param rules 并行替换规则
 * @param generations 目标代数（0 返回公理）
 */
export function iterate(
  axiom: string,
  rules: Readonly<Record<string, string>>,
  generations: number,
): IterationOutcome {
  if (!Number.isInteger(generations) || generations < 0 || generations > LIMITS.MAX_GENERATIONS) {
    throw new AppError(
      ErrorCode.VALIDATION,
      `代数必须是 0..${LIMITS.MAX_GENERATIONS} 的整数，实际为 ${String(generations)}`,
    );
  }

  const strings: string[] = [axiom];
  const lengths: number[] = [axiom.length];
  let current = axiom;
  let status: GenerationStatusValue = GenerationStatus.COMPLETE;
  let limitedAt: number | null = null;

  for (let g = 1; g <= generations; g++) {
    const predicted = nextLength(current, rules);
    if (predicted > LIMITS.MAX_SYMBOLS) {
      status = GenerationStatus.SYMBOL_LIMIT;
      limitedAt = g;
      break;
    }
    current = rewriteOnce(current, rules);
    strings.push(current);
    lengths.push(current.length);
  }

  return {
    generations: strings.length - 1,
    strings,
    lengths,
    status,
    limitedAt,
  };
}

/** 括号平衡检查：[ 与 ] 必须正确配对（先 [ 后 ]，不得出现多余的 ]）。 */
export function checkBrackets(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}
