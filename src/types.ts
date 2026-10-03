function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * 公开的资源限制（硬上限，防止指数爆炸）。
 * 默认值为对外承诺值；可通过环境变量调小用于测试/演示（LSYSTEM_MAX_*）。
 */
export const LIMITS = {
  /** 允许请求的最大代数（0..MAX_GENERATIONS）。 */
  MAX_GENERATIONS: envInt('LSYSTEM_MAX_GENERATIONS', 12),
  /** 单次生成允许的最大字符串符号数。 */
  MAX_SYMBOLS: envInt('LSYSTEM_MAX_SYMBOLS', 1_000_000),
  /** 单次几何解释允许输出的最大线段数。 */
  MAX_SEGMENTS: envInt('LSYSTEM_MAX_SEGMENTS', 100_000),
} as const;

/** 生成最终状态。 */
export const GenerationStatus = {
  /** 在限制内完整生成到目标代数。 */
  COMPLETE: 'complete',
  /** 在某一代触及符号数上限：未截断，停在可完整表示的最后一代。 */
  SYMBOL_LIMIT: 'symbol_limit',
  /** 解释线段时触及线段数上限：未截断，不产出线段结果。 */
  SEGMENT_LIMIT: 'segment_limit',
} as const;

export type GenerationStatusValue =
  (typeof GenerationStatus)[keyof typeof GenerationStatus];

export interface RuleSetInput {
  name: string;
  axiom: string;
  /** 键为单个 ASCII 符号，值为替换串（空串表示删除该符号）。 */
  rules: Record<string, string>;
  description?: string;
}

export interface RuleSet extends RuleSetInput {
  id: number;
  created_at: string;
}

/** 海龟解释参数。坐标单位为「步长单位」，角度单位为「度」。 */
export interface TurtleParams {
  /** 每步 F/f 前进距离，必须 > 0。 */
  step: number;
  /** +/- 转角（度），必须 >= 0；+ 为逆时针，- 为顺时针。 */
  angleDeg: number;
  /** 初始朝向角度（度），0 = 朝 +x 方向（东），90 = 朝北（+y）。 */
  initialAngleDeg?: number;
  /** 起点 x，默认 0。 */
  initialX?: number;
  /** 起点 y，默认 0。 */
  initialY?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GeometryResult {
  segmentCount: number;
  segments: Segment[];
  totalLength: number;
  bounds: BoundingBox;
}

export interface GenerationResult {
  rulesetId: number;
  rulesetVersion: number;
  requestedGenerations: number;
  /** 实际完整生成到的代数（触限时可能小于请求代数）。 */
  completedGenerations: number;
  status: GenerationStatusValue;
  /** 各代长度：lengths[g] 为第 g 代符号数（g 从 0 起）。 */
  lengths: number[];
  /** 最终完整字符串（绝不返回截断串）。 */
  string: string;
  symbolCount: number;
  limits: typeof LIMITS;
  geometry: GeometryResult | null;
  geometryRejected: boolean;
}
