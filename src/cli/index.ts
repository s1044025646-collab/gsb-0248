#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EXAMPLES } from '../examples.js';
import { AppError, ErrorCode } from '../errors.js';
import { LSystemService } from '../service.js';
import { defaultDbPath, Store } from '../store.js';
import { startHttp } from '../server.js';
import { toSvg } from '../svg.js';
import { LIMITS, type GenerationResult, type RuleSetInput, type TurtleParams } from '../types.js';

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function flag(flags: Map<string, string | boolean>, key: string): string | undefined {
  const v = flags.get(key);
  return typeof v === 'string' ? v : undefined;
}

function flagInt(flags: Map<string, string | boolean>, key: string): number | undefined {
  const v = flag(flags, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n)) throw new AppError(ErrorCode.VALIDATION, `--${key} 必须是整数`);
  return n;
}

function snippet(s: string, max = 80): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…（共 ${s.length} 个符号）`;
}

function printResult(result: GenerationResult, showString: boolean): void {
  console.log('状态: ' + result.status);
  console.log(`请求代数: ${result.requestedGenerations}，完成代数: ${result.completedGenerations}`);
  console.log('各代长度: ' + result.lengths.map((n, g) => `g${g}=${n}`).join(' '));
  console.log('最终符号数: ' + result.symbolCount);
  if (showString) console.log('字符串片段: ' + snippet(result.string));
  if (result.geometry) {
    const b = result.geometry.bounds;
    console.log(`线段数: ${result.geometry.segmentCount}`);
    console.log(`总长度: ${round(result.geometry.totalLength)}`);
    console.log(
      `包围盒: x[${round(b.minX)}, ${round(b.maxX)}] y[${round(b.minY)}, ${round(b.maxY)}] 宽=${round(b.width)} 高=${round(b.height)}`,
    );
  }
  if (result.geometryRejected) console.log('几何结果因线段数上限被拒绝（字符串完整，未截断）');
}

function round(n: number): number {
  return Math.round(n * 1e9) / 1e9;
}

function turtleFromFlags(flags: Map<string, string | boolean>): TurtleParams | undefined {
  const step = flag(flags, 'step');
  const angle = flag(flags, 'angle');
  if (step === undefined && angle === undefined) return undefined;
  return {
    step: Number(step ?? '10'),
    angleDeg: Number(angle ?? '90'),
    initialAngleDeg: Number(flag(flags, 'initial-angle') ?? '0'),
    initialX: Number(flag(flags, 'x') ?? '0'),
    initialY: Number(flag(flags, 'y') ?? '0'),
  };
}

function loadRulesetSpec(args: ParsedArgs): RuleSetInput {
  const file = flag(args.flags, 'file');
  if (file !== undefined) {
    const text = readFileSync(resolve(file), 'utf8');
    return JSON.parse(text) as RuleSetInput;
  }
  const axiom = flag(args.flags, 'axiom');
  const rules = flag(args.flags, 'rules');
  const name = flag(args.flags, 'name') ?? positional0(args) ?? 'ad-hoc';
  if (axiom === undefined) {
    throw new AppError(ErrorCode.VALIDATION, '需要 --file <ruleset.json> 或 --axiom 与 --rules');
  }
  return {
    name,
    axiom,
    rules: rules === undefined || rules === '' ? {} : (JSON.parse(rules) as Record<string, string>),
    description: flag(args.flags, 'description'),
  };
}

function positional0(args: ParsedArgs): string | undefined {
  return args.positional[0];
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  const args = parseArgs(process.argv.slice(3));
  const dbPath = flag(args.flags, 'db') ?? defaultDbPath();
  const store = new Store(dbPath);
  const service = new LSystemService(store);

  try {
    switch (command) {
      case 'import': {
        const input = loadRulesetSpec(args);
        const rs = service.createRuleSet(input);
        console.log(`已导入规则集 id=${rs.id} name=${rs.name}（版本 1）`);
        break;
      }
      case 'list': {
        for (const r of service.listRuleSets()) {
          console.log(`#${r.id} ${r.name} v${r.currentVersion} - ${r.description}`);
        }
        break;
      }
      case 'show': {
        const id = requireId(args);
        const rs = service.getRuleSet(id, flagInt(args.flags, 'version'));
        console.log(JSON.stringify(rs, null, 2));
        break;
      }
      case 'update': {
        const id = requireId(args);
        const rs = service.updateRuleSet(id, loadRulesetSpec(args));
        console.log(`已更新规则集 id=${rs.id}，新版本 v${store.getCurrentVersion(rs.id)}（旧报告不变）`);
        break;
      }
      case 'generate':
      case 'gen': {
        const id = requireId(args);
        const generations = flagInt(args.flags, 'generations') ?? flagInt(args.flags, 'n') ?? 0;
        const { reportId, result } = service.generate(id, {
          generations,
          turtle: turtleFromFlags(args.flags),
          save: args.flags.has('no-save') ? false : true,
          version: flagInt(args.flags, 'version'),
        });
        printResult(result, true);
        if (reportId !== null) console.log('报告 id: ' + reportId);
        break;
      }
      case 'lengths': {
        const id = requireId(args);
        const generations = flagInt(args.flags, 'generations') ?? flagInt(args.flags, 'n') ?? 0;
        const { result } = service.generate(id, { generations, save: false, version: flagInt(args.flags, 'version') });
        result.lengths.forEach((len, g) => console.log(`g${g}: ${len}`));
        console.log('状态: ' + result.status);
        break;
      }
      case 'reports': {
        const rsId = flagInt(args.flags, 'ruleset');
        for (const r of service.listReports(rsId)) {
          console.log(
            `报告 #${r.id} 规则集#${r.rulesetId}v${r.rulesetVersion} 代数=${r.generations} 状态=${r.status} 时间=${r.createdAt}`,
          );
        }
        break;
      }
      case 'report': {
        const id = requireId(args);
        const { result } = service.getReport(id);
        printResult(result, args.flags.has('full'));
        break;
      }
      case 'export': {
        const id = requireId(args);
        const { result } = service.getReport(id);
        const out = flag(args.flags, 'out') ?? `report-${id}.svg`;
        writeFileSync(resolve(out), toSvg(result), 'utf8');
        console.log(`已导出 SVG: ${resolve(out)}`);
        break;
      }
      case 'limits': {
        console.log(JSON.stringify({ ...LIMITS, angleUnit: 'degree', coords: '+x 右, +y 上, + 逆时针' }, null, 2));
        break;
      }
      case 'seed': {
        seed(service);
        break;
      }
      case 'serve': {
        const preferred = flagInt(args.flags, 'port');
        const http = await startHttp(service, preferred);
        console.log(`HTTP API 已启动: http://127.0.0.1:${http.port}`);
        console.log('数据库: ' + dbPath + '（Ctrl+C 退出）');
        process.on('SIGINT', () => {
          void http.close().then(() => process.exit(0));
        });
        break;
      }
      case 'demo': {
        await runDemo(service, dbPath);
        break;
      }
      default:
        usage();
        if (command !== 'help') process.exitCode = 1;
    }
  } catch (err) {
    if (err instanceof AppError) {
      console.error(`[${err.code}] ${err.message}`);
      process.exitCode = 1;
    } else {
      throw err;
    }
  }
}

function requireId(args: ParsedArgs): number {
  const id = flagInt(args.flags, 'id') ?? (positional0(args) !== undefined ? Number(positional0(args)) : NaN);
  if (!Number.isInteger(id)) {
    throw new AppError(ErrorCode.VALIDATION, '需要规则集/报告 id（位置参数或 --id）');
  }
  return id;
}

function seed(service: LSystemService): void {
  for (const ex of EXAMPLES) {
    try {
      const rs = service.createRuleSet(ex);
      console.log(`已播种示例: #${rs.id} ${ex.name}`);
    } catch (err) {
      if (err instanceof AppError && err.code === ErrorCode.CONFLICT) {
        console.log(`示例已存在，跳过: ${ex.name}`);
      } else {
        throw err;
      }
    }
  }
}

async function runDemo(service: LSystemService, dbPath: string): Promise<void> {
  console.log('=== L 系统确定性生成演示 ===');
  console.log('数据目录数据库: ' + dbPath);

  // 幂等播种
  seed(service);

  const angle = EXAMPLES[0]!;
  const tree = EXAMPLES[1]!;
  const angleRs =
    service.listRuleSets().find((r) => r.name === angle.name) ?? service.createRuleSet(angle);
  const treeRs =
    service.listRuleSets().find((r) => r.name === tree.name) ?? service.createRuleSet(tree);

  console.log('\n--- 示例 1：直角图案（代数 3）---');
  const g1 = service.generate(angleRs.id, { generations: 3, turtle: angle.turtle });
  printResult(g1.result, true);
  console.log('已保存报告 #' + g1.reportId);

  console.log('\n--- 示例 2：分支树（代数 4）---');
  const g2 = service.generate(treeRs.id, { generations: 4, turtle: tree.turtle });
  printResult(g2.result, true);
  console.log('已保存报告 #' + g2.reportId);
  const svgPath = resolve('data', `report-${g2.reportId}.svg`);
  mkdirSync(resolve('data'), { recursive: true });
  writeFileSync(svgPath, toSvg(g2.result), 'utf8');
  console.log('树 SVG 已导出: ' + svgPath);

  console.log('\n--- 重启一致性：从 SQLite 重新读取报告 ---');
  const reread = service.getReport(g2.reportId!).result;
  console.log(
    `线段数一致=${reread.geometry?.segmentCount === g2.result.geometry?.segmentCount}，` +
      `包围盒一致=${JSON.stringify(reread.geometry?.bounds) === JSON.stringify(g2.result.geometry?.bounds)}`,
  );

  console.log('\n--- 修改规则后旧报告保持不变 ---');
  service.updateRuleSet(treeRs.id, { ...tree, rules: { ...tree.rules, F: 'F' } });
  const oldReport = service.getReport(g2.reportId!).result;
  console.log(
    `旧报告 #${g2.reportId} 仍为规则版本 v${oldReport.rulesetVersion}，线段数=${oldReport.geometry?.segmentCount}`,
  );

  console.log('\n演示完成。启动服务: npm start （或 node build/src/cli/index.js serve --port 8080）');
}

function usage(): void {
  console.log(`lsystem — 确定性 L 系统后端 CLI

规则管理:
  import --name 名 --axiom F --rules '{"F":"F+F"}' [--description ...] [--file rs.json]
  list
  show <id> [--version N]
  update <id> --name ... --axiom ... --rules ...

生成与几何:
  generate <id> --generations N [--step 10 --angle 90 --initial-angle 0 --x 0 --y 0] [--no-save] [--version N]
  lengths  <id> --generations N
  reports [--ruleset <id>]
  report <id> [--full]
  export <id> --out file.svg

其他:
  seed            写入内置示例规则集
  serve [--port P] 启动 HTTP API（默认自动选择空闲端口）
  demo            端到端演示（播种、生成、导出、重启一致、旧报告不变）
  limits          显示公开资源限制

全局可选: --db <path>   指定 SQLite 文件（默认 ./data/lsystem.db；也可用 LSYSTEM_DB）
`);
}

void main();
