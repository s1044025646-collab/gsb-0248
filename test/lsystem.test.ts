import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  generate,
  MAX_GENERATION,
  referenceRewrite,
  rewriteOnce,
} from '../src/lsystem.ts';
import { AppError } from '../src/errors.ts';

test('互相替换规则必须同时改写（A<->B），不能递归连锁', () => {
  // 错误的递归式替换会把 A->B 后立刻再把 B->A，结果回到 AA；
  // 正确的并行改写一轮只扫描旧串一次：AA -> BB。
  const rules = [
    { symbol: 'A', replacement: 'B' },
    { symbol: 'B', replacement: 'A' },
  ];
  assert.equal(rewriteOnce('AA', new Map(rules.map((r) => [r.symbol, r.replacement]))), 'BB');
  assert.equal(rewriteOnce('AB', new Map(rules.map((r) => [r.symbol, r.replacement]))), 'BA');
  const r = generate('AA', rules, 2);
  assert.equal(r.string, 'AA'); // 第1代 BB，第2代 AA
  assert.deepEqual(
    r.generations.map((g) => g.length),
    [2, 2, 2],
  );
});

test('规则给出顺序不影响结果', () => {
  const axiom = 'AB';
  const r1 = [
    { symbol: 'A', replacement: 'AB' },
    { symbol: 'B', replacement: 'A' },
  ];
  const r2 = [...r1].reverse();
  assert.equal(generate(axiom, r1, 4).string, generate(axiom, r2, 4).string);
  // A->AB, B->A 是斐波那契词：长度 2,3,5,8,13
  assert.equal(generate(axiom, r1, 4).string, 'ABAABABAABAAB');
});

test('空初始串', () => {
  const r = generate('', [{ symbol: 'F', replacement: 'FF' }], 5);
  assert.equal(r.string, '');
  assert.equal(r.status, 'complete');
  assert.ok(r.generations.every((g) => g.length === 0));
});

test('空替换表示删除符号', () => {
  const r = generate('aXb', [{ symbol: 'X', replacement: '' }], 1);
  assert.equal(r.string, 'ab');
});

test('未定义符号原样保留', () => {
  const r = generate('FX+', [{ symbol: 'F', replacement: 'FF' }], 2);
  assert.equal(r.string, 'FFFFX+');
});

test('零代返回原始公理', () => {
  const axiom = 'F+F-F';
  const r = generate(axiom, [{ symbol: 'F', replacement: 'FFFFFF' }], 0);
  assert.equal(r.string, axiom);
  assert.deepEqual(r.generations, [{ generation: 0, length: axiom.length, truncated: false }]);
});

test('小代数与独立参考替换器核对', () => {
  const rules = new Map([
    ['F', 'FF+[+F-F-F]-[-F+F+F]'],
  ]);
  const prev = 'F+F';
  assert.equal(rewriteOnce(prev, rules), referenceRewrite(prev, rules));
});

test('超最大代数被拒绝', () => {
  assert.throws(() => generate('F', [], MAX_GENERATION + 1), AppError);
});

test('预算不足：返回明确限制状态且不标记为完整', () => {
  const r = generate('F', [{ symbol: 'F', replacement: 'FFF' }], 10, { maxSymbols: 50 });
  assert.equal(r.status, 'limit_symbols');
  const last = r.generations[r.generations.length - 1];
  assert.equal(last.truncated, true);
  assert.ok(last.length > 50);
  // 当前 string 仍是上一个完整代（长度 <= 预算），不是截断串
  assert.ok(r.string.length <= 50);
});

test('重复规则与非 ASCII 符号被拒绝', () => {
  assert.throws(
    () =>
      generate('F', [
        { symbol: 'F', replacement: 'A' },
        { symbol: 'F', replacement: 'B' },
      ], 1),
    /多条规则/,
  );
  assert.throws(() => generate('F', [{ symbol: '中', replacement: 'A' }], 1), AppError);
});

test('直角 F 图案（只有 F）按代翻倍', () => {
  const r = generate('F', [{ symbol: 'F', replacement: 'F+F-F-F+F' }], 2);
  assert.equal(r.generations[0].length, 1);
  assert.equal(r.generations[1].length, 9); // F+F-F-F+F：5F+4符号
  assert.equal(r.generations[2].length, 49); // 5*5 + 4*6 = 49
});
