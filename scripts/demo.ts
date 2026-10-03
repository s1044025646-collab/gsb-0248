/**
 * 端到端演示（不启动 HTTP）：
 * 1. 导入两个内置示例规则集；2. 按代生成并打印片段/线段数/包围盒；
 * 3. 保存报告、修改规则、重新打开数据库（模拟重启），验证旧报告不变且 SVG 可再次导出。
 */
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb, getDb, getRuleset } from '../src/db.ts';
import { EXAMPLES } from '../src/examples.ts';
import {
  interpretRuleset,
  modifyRuleset,
  previewGenerate,
  readReport,
  reportSvg,
  saveRuleset,
} from '../src/service.ts';
import { writeFileSync, mkdirSync } from 'node:fs';

const dataDir = resolve(process.cwd(), 'data');
mkdirSync(dataDir, { recursive: true });
const dbPath = join(dataDir, 'demo.db');
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });

openDb(dbPath);

for (const ex of EXAMPLES) {
  console.log(`\n=== 示例: ${ex.name} ===`);
  const preview = previewGenerate({ axiom: ex.axiom, rules: ex.rules, generation: 3 });
  for (const g of preview.generations) {
    console.log(`  第 ${g.generation} 代长度=${g.length}`);
  }
  console.log(`  字符片段: ${preview.preview.slice(0, 80)}${preview.stringLength > 80 ? '...' : ''}`);

  const rs = saveRuleset({ name: ex.key, axiom: ex.axiom, rules: ex.rules });
  const geo = interpretRuleset(
    {
      rulesetId: rs.id,
      generation: 3,
      params: ex.params,
      persist: true,
    },
    false,
  );
  console.log(`  线段数量: ${geo.segmentCount}`);
  console.log(
    `  包围盒: x[${geo.bounds.minX}, ${geo.bounds.maxX}] y[${geo.bounds.minY}, ${geo.bounds.maxY}] 宽=${geo.bounds.width} 高=${geo.bounds.height}`,
  );
  console.log(`  报告 id=${geo.reportId}（ruleset v${geo.rulesetVersion}）`);

  if (ex.key === 'tree') {
    const outFile = join(dataDir, 'demo-tree.svg');
    writeFileSync(outFile, reportSvg(geo.reportId as number), 'utf8');
    console.log(`  已导出 SVG: ${outFile}`);
    globalThis.__demoReportId = geo.reportId;
    globalThis.__demoRulesetId = rs.id;
  }
}

// 修改规则，验证旧报告不变
const reportId = globalThis.__demoReportId as number;
const rulesetId = globalThis.__demoRulesetId as number;
const before = readReport(reportId);
console.log('\n=== 修改 tree 规则: F -> FF（版本应变为 2）===');
modifyRuleset(rulesetId, { rules: [{ symbol: 'F', replacement: 'FF' }] });
console.log(`  当前规则版本: v${getRuleset(rulesetId).version}`);

// 重新打开数据库，模拟服务重启
getDb().close();
openDb(dbPath);
const after = readReport(reportId);
console.log(`\n=== 重启后读取旧报告 id=${reportId} ===`);
console.log(`  报告快照版本: v${after.rulesetVersion}`);
console.log(`  快照线段数量: ${String(after.payload.segmentCount)}（修改前: ${String(before.payload.segmentCount)}）`);
const ok = after.payload.segmentCount === before.payload.segmentCount;
console.log(`  旧报告保持不变: ${ok ? '是 ✅' : '否 ❌'}`);
const svg = reportSvg(reportId);
const svgFile = join(dataDir, 'demo-tree-after-restart.svg');
writeFileSync(svgFile, svg, 'utf8');
console.log(`  重启后仍可导出同一 SVG: ${svgFile}（${svg.length} 字节）`);

getDb().close();
