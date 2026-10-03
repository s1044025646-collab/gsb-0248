import { AppError, assertProductionString, assertSymbol } from './errors.js';

/** 资源上限（公开常量）。 */
export const MAX_GENERATION = 20;
export const MAX_SYMBOLS = 2_000_000;
export const MAX_SEGMENTS = 500_000;

export type RuleMap = ReadonlyMap<string, string>;

export interface RewriteStep {
  /** 代数，0 表示公理自身。 */
  generation: number;
  /** 该代字符串长度（符号数 = JS UTF-16 码元数，ASCII 下等于字符数）。 */
  length: number;
  /** 生成该代时是否触及符号预算。 */
  truncated: boolean;
}

export interface RewriteResult {
  generations: RewriteStep[];
  /** 最终字符串；若 truncated=true 则不保证完整，禁止标记为完整。 */
  string: string;
  status: 'complete' | 'limit_symbols';
  /** 达到上限时所处的代数（结果只保留到前一代完整串 + 说明）。 */
}

/**
 * 规范化规则输入：数组形式 [{symbol, replacement}]，每符号至多一条。
 * 空替换串表示删除该符号。
 */
export function normalizeRules(
  input: ReadonlyArray<{ symbol: string; replacement: string }> | Record<string, string>,
): Map<string, string> {
  const entries: Array<[string, string]> = [];
  const push = (symbol: unknown, replacement: unknown) => {
    if (typeof symbol !== 'string') {
      throw new AppError('INVALID_SYMBOL', `规则符号必须是字符串: ${JSON.stringify(symbol)}`);
    }
    assertSymbol(symbol);
    if (typeof replacement !== 'string') {
      throw new AppError('INVALID_PARAM', `符号 ${symbol} 的替换内容必须是字符串`);
    }
    assertProductionString(replacement);
    entries.push([symbol, replacement]);
  };

  if (Array.isArray(input)) {
    for (const r of input) {
      if (!r || typeof r !== 'object') {
        throw new AppError('INVALID_RULESET', '规则必须是 {symbol, replacement} 对象');
      }
      push(r.symbol, r.replacement);
    }
  } else if (input && typeof input === 'object') {
    for (const [symbol, replacement] of Object.entries(input)) {
      push(symbol, replacement);
    }
  } else {
    throw new AppError('INVALID_RULESET', '规则必须是数组或对象映射');
  }

  const map = new Map<string, string>();
  for (const [symbol, replacement] of entries) {
    if (map.has(symbol)) {
      throw new AppError('DUPLICATE_RULE', `符号 ${JSON.stringify(symbol)} 存在多条规则；确定性系统每符号仅允许一条规则`, {
        symbol,
      });
    }
    map.set(symbol, replacement);
  }
  return map;
}

/**
 * 单代并行（同时）改写：只扫描“上一代”字符串一次，
 * 每个符号独立查表一次，新产生的字符在本代绝不会被再次替换。
 * 无规则的符号原样保留；空替换串等价于删除。
 */
export function rewriteOnce(prev: string, rules: RuleMap): string {
  let out = '';
  for (const ch of prev) {
    const replacement = rules.get(ch);
    out += replacement === undefined ? ch : replacement;
  }
  return out;
}

/**
 * 有界多代生成。
 * - generation=0 返回公理。
 * - 规则在 Map 中的遍历顺序不影响结果（逐字符查表）。
 * - 任一代长度达到 MAX_SYMBOLS 即停止，status='limit_symbols'，
 *   truncated=true 的那一代不写入完整串（保留最后一个完整代）。
 */
export function generate(
  axiom: string,
  rulesInput: ReadonlyArray<{ symbol: string; replacement: string }> | Record<string, string>,
  targetGeneration: number,
  limits: { maxGeneration?: number; maxSymbols?: number } = {},
): RewriteResult {
  if (typeof axiom !== 'string') {
    throw new AppError('INVALID_PARAM', '公理(axiom)必须是字符串');
  }
  assertProductionString(axiom);
  const maxGen = limits.maxGeneration ?? MAX_GENERATION;
  const maxSymbols = limits.maxSymbols ?? MAX_SYMBOLS;
  if (!Number.isInteger(targetGeneration) || targetGeneration < 0) {
    throw new AppError('INVALID_PARAM', `代数必须是非负整数，收到: ${targetGeneration}`);
  }
  if (targetGeneration > maxGen) {
    throw new AppError('INVALID_PARAM', `代数 ${targetGeneration} 超过最大代数 ${maxGen}`);
  }

  const rules = normalizeRules(rulesInput);
  const steps: RewriteStep[] = [{ generation: 0, length: axiom.length, truncated: axiom.length > maxSymbols }];

  let current = axiom;
  let status: RewriteResult['status'] = 'complete';

  for (let gen = 1; gen <= targetGeneration; gen++) {
    const next = rewriteOnce(current, rules);
    if (next.length > maxSymbols) {
      steps.push({ generation: gen, length: next.length, truncated: true });
      status = 'limit_symbols';
      break;
    }
    steps[steps.length - 1].truncated = false;
    steps.push({ generation: gen, length: next.length, truncated: false });
    current = next;
  }

  return { generations: steps, string: current, status };
}

/** 简单独立替换器：与规则顺序无关的参考实现（测试核对用，逻辑等同 rewriteOnce）。 */
export function referenceRewrite(prev: string, rules: RuleMap): string {
  return Array.from(prev, (ch) => (rules.has(ch) ? (rules.get(ch) as string) : ch)).join('');
}
