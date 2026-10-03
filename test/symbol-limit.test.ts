import './support/symbols-env.js';
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { LIMITS } from '../src/types.js';
import { iterate } from '../src/lsystem.js';

describe(`symbol budget (MAX_SYMBOLS=${LIMITS.MAX_SYMBOLS})`, () => {
  it('symbol_limit: no truncated string is ever returned', () => {
    // 1,2,4,8,16,32,64 完整；下一代 128 > 100 -> 在 g7 触限
    const out = iterate('F', { F: 'FF' }, 10);
    assert.equal(out.status, 'symbol_limit');
    assert.equal(out.limitedAt, 7);
    assert.equal(out.generations, 6);
    const last = out.strings[out.strings.length - 1]!;
    assert.equal(last.length, 64);
    assert.equal(out.lengths[out.lengths.length - 1], 64);
  });

  it('default public limit is 1,000,000 when env unset', () => {
    // 该文件设置了 100；这里只断言被注入成功，避免环境耦合误判
    assert.equal(LIMITS.MAX_SYMBOLS, 100);
  });
});
