import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { checkBrackets, iterate, nextLength, rewriteOnce } from '../src/lsystem.js';

/** 独立参考替换器：与被测实现完全独立的写法（split/join）。 */
function referenceRewrite(s: string, rules: Record<string, string>): string {
  return s
    .split('')
    .map((ch) => (Object.hasOwn(rules, ch) ? rules[ch]! : ch))
    .join('');
}

describe('rewriteOnce —— 同时（并行）改写', () => {
  it('互相替换 A<->B：并行结果为 BA，递归替换会塌缩成 AA', () => {
    const rules = { A: 'B', B: 'A' };
    assert.equal(rewriteOnce('AB', rules), 'BA');
    assert.equal(rewriteOnce('BA', rules), 'AB');
    // 关键区别：递归（顺序消费新字符）会得到 AA 或 BB
    assert.notEqual(rewriteOnce('AB', rules), 'AA');
  });

  it('规则在对象中的顺序不影响结果', () => {
    const r1 = rewriteOnce('AB', { A: 'B', B: 'A' });
    const r2 = rewriteOnce('AB', { B: 'A', A: 'B' });
    assert.equal(r1, r2);
    assert.equal(r1, 'BA');
  });

  it('无规则符号原样保留，空替换表示删除', () => {
    assert.equal(rewriteOnce('ABC', { A: '', C: 'Z' }), 'BZ');
  });

  it('与独立参考替换器在小代数上一致', () => {
    const rules = { F: 'F+F-F', X: 'FX' };
    let a = 'X';
    let b = 'X';
    for (let g = 0; g < 6; g++) {
      assert.equal(a, b);
      a = rewriteOnce(a, rules);
      b = referenceRewrite(b, rules);
    }
  });
});

describe('iterate —— 有界多代生成', () => {
  it('代数 0 返回原始字符串，长度数组只有一项', () => {
    const out = iterate('F', { F: 'FF' }, 0);
    assert.equal(out.generations, 0);
    assert.deepEqual(out.lengths, [1]);
    assert.equal(out.strings[0], 'F');
  });

  it('空初始串始终为空', () => {
    const out = iterate('', { F: 'FF' }, 5);
    assert.equal(out.status, 'complete');
    assert.deepEqual(out.lengths, [0, 0, 0, 0, 0, 0]);
  });

  it('空替换逐代删除符号', () => {
    const out = iterate('FFF', { F: '' }, 2);
    assert.deepEqual(out.lengths, [3, 0, 0]);
  });

  it('未定义符号（公理 X，只定义 F）原样保留', () => {
    const out = iterate('X', { F: 'FF' }, 3);
    assert.equal(out.strings[out.strings.length - 1], 'X');
  });

  it('nextLength 与实际长度一致', () => {
    const rules = { F: 'FF', A: 'B' };
    const cur = 'FAF';
    assert.equal(nextLength(cur, rules), rewriteOnce(cur, rules).length);
  });

  it('超过最大代数被参数校验拒绝', () => {
    assert.throws(() => iterate('F', { F: 'FF' }, 13), /代数/);
    assert.throws(() => iterate('F', { F: 'FF' }, -1), /代数/);
  });

});

describe('括号平衡', () => {
  it('嵌套分支平衡', () => {
    assert.equal(checkBrackets('F[+F][-F[F]]'), true);
  });
  it('缺少 ]、多余 ]、先 ] 后 [ 均不平衡', () => {
    assert.equal(checkBrackets('F[F'), false);
    assert.equal(checkBrackets('F]F['), false);
    assert.equal(checkBrackets(']'), false);
  });
});
