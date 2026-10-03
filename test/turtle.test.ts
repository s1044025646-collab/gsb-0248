import assert from 'node:assert/strict';
import test from 'node:test';
import { AppError } from '../src/errors.ts';
import { checkBrackets, interpret } from '../src/turtle.ts';

const EPS = 1e-9;

function close(actual: number, expected: number, eps = EPS): void {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `期望 ${expected}，实际 ${actual}，误差超 ${eps}`,
  );
}

test('沿 +x 前进：手算坐标', () => {
  const r = interpret('FF', { step: 10, angleDeg: 90, startX: 0, startY: 0, startHeadingDeg: 0 });
  assert.equal(r.segmentCount, 2);
  close(r.segments[0].x2, 10);
  close(r.segments[0].y2, 0);
  close(r.segments[1].x2, 20);
  close(r.totalLength, 20);
  close(r.bounds.width, 20);
  close(r.bounds.height, 0);
});

test('转向手算：直角正方形三边回到原点附近', () => {
  // heading 0 -> '+' 左转 90 朝 +y；画一个开口正方形的三条边
  const r = interpret('F+F+F', { step: 5, angleDeg: 90, startHeadingDeg: 0 });
  const last = r.segments[r.segments.length - 1];
  close(last.x2, 0);
  close(last.y2, 5);
  close(r.bounds.minX, 0);
  close(r.bounds.maxX, 5);
  close(r.bounds.minY, 0);
  close(r.bounds.maxY, 5);
});

test('右转角度为逆时针约定的反向', () => {
  const r = interpret('F-F', { step: 7, angleDeg: 90, startHeadingDeg: 0 });
  const last = r.segments[r.segments.length - 1];
  close(last.x2, 7);
  close(last.y2, -7);
});

test('嵌套分支：栈恢复位置与朝向，恢复不画线', () => {
  // 从原点向上画主干，分支后必须精确回到分叉点继续
  const r = interpret('F[+F][-F]F', {
    step: 1,
    angleDeg: 45,
    startX: 0,
    startY: 0,
    startHeadingDeg: 90,
  });
  assert.equal(r.segmentCount, 4); // 主干2 + 左右分支各1
  // 两个分支都从 (0,1) 出发
  const branch1 = r.segments[1];
  const branch2 = r.segments[2];
  close(branch1.x1, 0);
  close(branch1.y1, 1);
  close(branch2.x1, 0);
  close(branch2.y1, 1);
  // 主干第二段仍从 (0,1) 向上到 (0,2)
  const trunk2 = r.segments[3];
  close(trunk2.x1, 0);
  close(trunk2.y1, 1);
  close(trunk2.x2, 0);
  close(trunk2.y2, 2);
});

test('f 移动但不画线，仍影响包围盒', () => {
  const r = interpret('FfF', { step: 10, angleDeg: 90, startHeadingDeg: 0 });
  assert.equal(r.segmentCount, 2);
  close(r.bounds.maxX, 30);
  close(r.totalLength, 20);
});

test('括号不平衡：未闭合与多余右括号都拒绝', () => {
  assert.throws(() => checkBrackets('F[+F'), (err: unknown) => err instanceof AppError && err.code === 'UNBALANCED_BRACKETS');
  assert.throws(() => checkBrackets('F]F'), (err: unknown) => err instanceof AppError && err.code === 'UNBALANCED_BRACKETS');
  assert.throws(() => interpret('F[', { step: 1, angleDeg: 90 }), AppError);
});

test('线段预算不足给出 limit_segments', () => {
  const r = interpret('FFFFFF', { step: 1, angleDeg: 90 }, 3);
  assert.equal(r.geometryStatus ?? r.status, 'limit_segments');
  assert.equal(r.segmentCount, 3);
});

test('参数校验', () => {
  assert.throws(() => interpret('F', { step: 0, angleDeg: 90 }), AppError);
  assert.throws(() => interpret('F', { step: 1, angleDeg: NaN }), AppError);
});
