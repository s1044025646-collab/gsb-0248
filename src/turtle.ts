import { AppError, ErrorCode, validationError } from './errors.js';
import { checkBrackets } from './lsystem.js';
import { LIMITS, type BoundingBox, type GeometryResult, type Point, type Segment, type TurtleParams } from './types.js';

/**
 * 海龟图形解释。
 *
 * 坐标约定：普通笛卡尔平面，x 向右为正、y 向上为正。
 * 角度单位：度。初始朝向 0° = +x 轴（东）；+ 逆时针（朝 +y），- 顺时针。
 * 指令：
 *   F 前进 step 并画一条线段
 *   f 前进 step，不画线
 *   + 逆时针转 angleDeg
 *   - 顺时针转 angleDeg
 *   [ 把当前位置与朝向压栈
 *   ] 出栈恢复位置与朝向（恢复本身不产生连接线）
 * 其余符号忽略（它们只参与字符串改写）。
 */
export function interpret(input: string, params: TurtleParams): GeometryResult {
  const step = params.step;
  const angleDeg = params.angleDeg;
  if (typeof step !== 'number' || !Number.isFinite(step) || step <= 0) {
    throw validationError('step（步长）必须是有限正数');
  }
  if (typeof angleDeg !== 'number' || !Number.isFinite(angleDeg) || angleDeg < 0) {
    throw validationError('angleDeg（转角）必须是有限且非负的度数');
  }
  const initialAngleDeg = params.initialAngleDeg ?? 0;
  const start: Point = { x: params.initialX ?? 0, y: params.initialY ?? 0 };
  for (const v of [initialAngleDeg, start.x, start.y]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw validationError('初始姿态必须是有限数值');
    }
  }

  if (!checkBrackets(input)) {
    throw new AppError(
      ErrorCode.UNBALANCED_BRACKETS,
      '字符串括号不平衡：[ 与 ] 未正确配对，拒绝生成几何结果',
    );
  }

  const segments: Segment[] = [];
  let x = start.x;
  let y = start.y;
  let heading = (initialAngleDeg * Math.PI) / 180;
  const turn = (angleDeg * Math.PI) / 180;

  interface State {
    x: number;
    y: number;
    heading: number;
  }
  const stack: State[] = [];

  let totalLength = 0;
  let minX = x;
  let minY = y;
  let maxX = x;
  let maxY = y;

  const visit = (px: number, py: number): void => {
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  };

  for (const ch of input) {
    switch (ch) {
      case 'F': {
        const nx = x + step * Math.cos(heading);
        const ny = y + step * Math.sin(heading);
        if (segments.length >= LIMITS.MAX_SEGMENTS) {
          throw new AppError(
            ErrorCode.RESOURCE_LIMIT,
            `线段数超过上限 ${LIMITS.MAX_SEGMENTS}，已停止且不输出截断几何`,
          );
        }
        segments.push({ x1: x, y1: y, x2: nx, y2: ny });
        totalLength += step;
        x = nx;
        y = ny;
        visit(x, y);
        break;
      }
      case 'f': {
        x += step * Math.cos(heading);
        y += step * Math.sin(heading);
        visit(x, y);
        break;
      }
      case '+':
        heading += turn;
        break;
      case '-':
        heading -= turn;
        break;
      case '[':
        stack.push({ x, y, heading });
        break;
      case ']': {
        const state = stack.pop();
        if (state === undefined) {
          throw new AppError(ErrorCode.UNBALANCED_BRACKETS, '出现多余的 ]');
        }
        x = state.x;
        y = state.y;
        heading = state.heading;
        break;
      }
      default:
        break;
    }
  }

  const bounds: BoundingBox = {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };

  return { segmentCount: segments.length, segments, totalLength, bounds };
}
