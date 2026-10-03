import { AppError } from './errors.js';
import { MAX_SEGMENTS } from './lsystem.js';

/**
 * 坐标约定：
 * - 平面直角坐标系，x 轴向右为正，y 轴向上为正。
 * - 角度单位：度（degree）。heading=0 指向 +x 方向，正角度逆时针旋转，
 *   '+' 左转 angle，'-' 右转 angle（标准海龟/数学约定）。
 * - F：沿当前朝向前进 step 并画线段；f：同样前进但不留线段。
 * - '[' 压栈保存 (x, y, heading)；']' 弹栈恢复，恢复本身不产生连接线。
 * - 其余符号（含 A、B 等）忽略其几何动作，仅参与字符串改写。
 */
export interface TurtleParams {
  step: number;
  angleDeg: number;
  startX?: number;
  startY?: number;
  startHeadingDeg?: number;
}

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  length: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface TurtleResult {
  segments: Segment[];
  segmentCount: number;
  totalLength: number;
  bounds: BoundingBox;
}

export interface InterpretStatus {
  status: 'complete' | 'limit_segments';
}

const DEG2RAD = Math.PI / 180;

export function validateParams(p: TurtleParams): void {
  if (typeof p.step !== 'number' || !Number.isFinite(p.step) || p.step <= 0) {
    throw new AppError('INVALID_PARAM', `step 必须是正数，收到: ${p.step}`);
  }
  if (typeof p.angleDeg !== 'number' || !Number.isFinite(p.angleDeg)) {
    throw new AppError('INVALID_PARAM', `angleDeg 必须是有限数值，收到: ${p.angleDeg}`);
  }
  for (const [name, value] of [
    ['startX', p.startX],
    ['startY', p.startY],
    ['startHeadingDeg', p.startHeadingDeg],
  ] as const) {
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new AppError('INVALID_PARAM', `${name} 必须是有限数值，收到: ${value}`);
    }
  }
}

/** 检查方括号是否平衡且嵌套合法；不平衡直接拒绝几何生成。 */
export function checkBrackets(s: string): void {
  let depth = 0;
  for (const ch of s) {
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth < 0) {
        throw new AppError('UNBALANCED_BRACKETS', "遇到多余的 ']'（栈下溢），拒绝生成几何结果");
      }
    }
  }
  if (depth !== 0) {
    throw new AppError('UNBALANCED_BRACKETS', `存在 ${depth} 个未闭合的 '['，拒绝生成几何结果`);
  }
}

export function interpret(input: string, params: TurtleParams, maxSegments = MAX_SEGMENTS): TurtleResult & InterpretStatus {
  validateParams(params);
  checkBrackets(input);

  const step = params.step;
  const angle = params.angleDeg;
  let x = params.startX ?? 0;
  let y = params.startY ?? 0;
  let heading = params.startHeadingDeg ?? 90;

  const stack: Array<{ x: number; y: number; heading: number }> = [];
  const segments: Segment[] = [];
  let totalLength = 0;
  let minX = x;
  let minY = y;
  let maxX = x;
  let maxY = y;
  let status: InterpretStatus['status'] = 'complete';

  const visit = (nx: number, ny: number) => {
    if (nx < minX) minX = nx;
    if (ny < minY) minY = ny;
    if (nx > maxX) maxX = nx;
    if (ny > maxY) maxY = ny;
  };

  for (const ch of input) {
    switch (ch) {
      case 'F': {
        const nx = x + step * Math.cos(heading * DEG2RAD);
        const ny = y + step * Math.sin(heading * DEG2RAD);
        if (segments.length >= maxSegments) {
          status = 'limit_segments';
          x = nx;
          y = ny;
          visit(nx, ny);
          break;
        }
        segments.push({ x1: x, y1: y, x2: nx, y2: ny, length: step });
        totalLength += step;
        x = nx;
        y = ny;
        visit(nx, ny);
        break;
      }
      case 'f': {
        x += step * Math.cos(heading * DEG2RAD);
        y += step * Math.sin(heading * DEG2RAD);
        visit(x, y);
        break;
      }
      case '+':
        heading += angle;
        break;
      case '-':
        heading -= angle;
        break;
      case '[':
        stack.push({ x, y, heading });
        break;
      case ']': {
        const saved = stack.pop();
        if (!saved) {
          throw new AppError('UNBALANCED_BRACKETS', "多余的 ']'（理论上已被前置检查拦截）");
        }
        x = saved.x;
        y = saved.y;
        heading = saved.heading;
        break;
      }
      default:
        break;
    }
  }

  return {
    segments,
    segmentCount: segments.length,
    totalLength,
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
    status,
  };
}
