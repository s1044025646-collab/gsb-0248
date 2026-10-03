import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AppError } from '../src/errors.js';
import { interpret } from '../src/turtle.js';

const EPS = 1e-9;

describe('海龟解释 —— 手算坐标核对', () => {
  it('F 沿 +x 前进并画线，总长度与包围盒正确', () => {
    const g = interpret('FFF', { step: 10, angleDeg: 90 });
    assert.equal(g.segmentCount, 3);
    assert.equal(g.totalLength, 30);
    assert.deepEqual(g.segments[0], { x1: 0, y1: 0, x2: 10, y2: 0 });
    assert.deepEqual(g.bounds, { minX: 0, minY: 0, maxX: 30, maxY: 0, width: 30, height: 0 });
  });

  it('+90 逆时针转向 +y；-90 顺时针转向 -y', () => {
    const g = interpret('F+F-F', { step: 10, angleDeg: 90 });
    // (0,0)->(10,0)->(10,10)->(20,10)
    assert.equal(g.segmentCount, 3);
    assert.ok(Math.abs(g.segments[1]!.y2 - 10) < EPS);
    assert.ok(Math.abs(g.segments[2]!.x2 - 20) < EPS);
    assert.ok(Math.abs(g.segments[2]!.y2 - 10) < EPS);
    assert.equal(g.bounds.maxY, 10);
  });

  it('初始姿态 initialAngleDeg=90 时 F 朝 +y', () => {
    const g = interpret('F', { step: 5, angleDeg: 90, initialAngleDeg: 90 });
    assert.ok(Math.abs(g.segments[0]!.y2 - 5) < EPS);
  });

  it('嵌套分支：栈恢复位置与朝向，且不画连接线', () => {
    // F [ + F ] F ：主干 0->10；分支 10->(10,10)；] 恢复到 (10,0) 朝 0；主干继续 ->20
    const g = interpret('F[+F]F', { step: 10, angleDeg: 90 });
    assert.equal(g.segmentCount, 3);
    assert.deepEqual(g.segments[0], { x1: 0, y1: 0, x2: 10, y2: 0 });
    assert.deepEqual(g.segments[1], { x1: 10, y1: 0, x2: 10, y2: 10 });
    // 恢复后线段起点必须是 (10,0) 而不是分支末端 (10,10)
    assert.deepEqual(g.segments[2], { x1: 10, y1: 0, x2: 20, y2: 0 });
  });

  it('更深嵌套与负坐标包围盒', () => {
    const g = interpret('F[-F[+F]]', { step: 10, angleDeg: 90 });
    // 0->(10,0); 转 -90 朝 -y：(10,0)->(10,-10); 转 +90 朝 +x：(10,-10)->(20,-10)
    assert.equal(g.segmentCount, 3);
    assert.equal(g.bounds.minY, -10);
    assert.equal(g.bounds.maxX, 20);
  });

  it('f 只移动不画线，并影响包围盒', () => {
    const g = interpret('FffF', { step: 10, angleDeg: 90 });
    assert.equal(g.segmentCount, 2);
    assert.equal(g.totalLength, 20);
    assert.equal(g.bounds.maxX, 40);
  });

  it('其他符号（X 等）被忽略，只影响字符串', () => {
    const g = interpret('XFX', { step: 10, angleDeg: 90 });
    assert.equal(g.segmentCount, 1);
  });

  it('括号不平衡拒绝生成几何（缺少 ]）', () => {
    assert.throws(
      () => interpret('F[F', { step: 10, angleDeg: 90 }),
      (e: unknown) => e instanceof AppError && e.code === 'UNBALANCED_BRACKETS',
    );
  });

  it('多余的 ] 被拒绝', () => {
    assert.throws(
      () => interpret('F]', { step: 10, angleDeg: 90 }),
      (e: unknown) => e instanceof AppError && e.code === 'UNBALANCED_BRACKETS',
    );
  });

  it('参数校验：步长必须为正、角度非负', () => {
    assert.throws(() => interpret('F', { step: 0, angleDeg: 90 }), /步长/);
    assert.throws(() => interpret('F', { step: 10, angleDeg: -1 }), /转角/);
  });
});
