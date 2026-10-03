#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDb } from './db.js';
import { AppError, errorStatusCode } from './errors.js';
import { MAX_GENERATION, MAX_SEGMENTS, MAX_SYMBOLS } from './lsystem.js';
import {
  interpretRuleset,
  listAllReports,
  listAllRulesets,
  modifyRuleset,
  previewGenerate,
  readReport,
  reportSvg,
  saveRuleset,
} from './service.js';

const DATA_DIR = resolve(process.env.LSYS_DATA_DIR ?? join(process.cwd(), 'data'));

interface ParsedArgs {
  positional: string[];
  flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq >= 0) {
        flags.set(token.slice(2, eq), token.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags.set(token.slice(2), next);
          i++;
        } else {
          flags.set(token.slice(2), 'true');
        }
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function num(flags: Map<string, string>, key: string, fallback: number): number {
  const v = flags.get(key);
  return v === undefined ? fallback : Number(v);
}

function parseRulesArg(value: string | undefined): Array<{ symbol: string; replacement: string }> {
  if (!value) return [];
  // 支持 JSON：'[{"symbol":"F","replacement":"F+F"}]'
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
  const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) throw new AppError('INVALID_RULESET', '--rules 必须是规则数组');
    return parsed as Array<{ symbol: string; replacement: string }>;
  }
  // 简写：F=F+F;A=BF （分号分隔，空替换写 F=）
  return trimmed
    .split(';')
    .filter((part) => part.length > 0)
    .map((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) throw new AppError('INVALID_RULESET', `规则缺少 '=': ${part}`);
      return { symbol: part.slice(0, eq), replacement: part.slice(eq + 1) };
    });
}

function fmtBounds(b: {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}): string {
  return `x:[${b.minX}, ${b.maxX}] y:[${b.minY}, ${b.maxY}] 宽=${b.width} 高=${b.height}`;
}

const HELP = `lsys — 确定性 L 系统改写与海龟线段生成 CLI

用法:
  lsys preview --axiom "F" --rules "F=F+F" --generation 3
  lsys ruleset-add --name tree --axiom "F" --rules "F=F[+F]F"
  lsys ruleset-list
  lsys ruleset-update <id> --axiom "F" --rules "F=F+F"
  lsys generate <rulesetId> --generation 3 --step 10 --angle 90 [--persist]
  lsys report-list [--ruleset <id>]
  lsys report <id>
  lsys export <reportId> --out data/out.svg
  lsys limits

规则简写: --rules "F=F+F;A=BF"；删除符号写空替换如 "X="。
也接受 JSON 数组: --rules "[{\\"symbol\\":\\"F\\",\\"replacement\\":\\"F+F\\"}]"

环境变量:
  LSYS_DATA_DIR   数据目录（默认 ./data）
`;

export function runCli(argv: string[]): number {
  const { positional, flags } = parseArgs(argv);
  const command = positional[0];

  openDb(join(DATA_DIR, 'lsystem.db'));

  try {
    switch (command) {
      case 'preview': {
        const result = previewGenerate({
          axiom: flags.get('axiom') ?? '',
          rules: parseRulesArg(flags.get('rules')),
          generation: num(flags, 'generation', 0),
        });
        console.log(`状态: ${result.status}`);
        for (const g of result.generations) {
          console.log(`  第 ${g.generation} 代长度=${g.length}${g.truncated ? ' [截断]' : ''}`);
        }
        console.log(`字符片段(前 ${result.previewLimit}): ${result.preview}`);
        return 0;
      }
      case 'ruleset-add': {
        const row = saveRuleset({
          name: flags.get('name') ?? '',
          axiom: flags.get('axiom') ?? '',
          rules: parseRulesArg(flags.get('rules')),
        });
        console.log(`已保存规则集 id=${row.id} name=${row.name} version=${row.version}`);
        return 0;
      }
      case 'ruleset-list': {
        for (const r of listAllRulesets()) {
          console.log(`id=${r.id} name=${r.name} version=${r.version} axiom=${r.axiom}`);
        }
        return 0;
      }
      case 'ruleset-update': {
        const id = Number(positional[1]);
        const row = modifyRuleset(id, {
          axiom: flags.get('axiom'),
          rules: flags.has('rules') ? parseRulesArg(flags.get('rules')) : undefined,
          name: flags.get('name'),
        });
        console.log(`已更新规则集 id=${row.id} version=${row.version}（旧报告不受影响）`);
        return 0;
      }
      case 'generate': {
        const id = Number(positional[1]);
        const result = interpretRuleset(
          {
            rulesetId: id,
            generation: num(flags, 'generation', 0),
            params: {
              step: num(flags, 'step', 10),
              angleDeg: num(flags, 'angle', 90),
              startHeadingDeg: flags.has('heading') ? num(flags, 'heading', 90) : undefined,
            },
            persist: flags.has('persist'),
          },
          false,
        );
        console.log(`改写状态: ${result.rewriteStatus}  几何状态: ${result.geometryStatus}`);
        for (const g of result.generations) {
          console.log(`  第 ${g.generation} 代长度=${g.length}${g.truncated ? ' [截断]' : ''}`);
        }
        console.log(`线段数量: ${result.segmentCount}`);
        console.log(`总长度: ${result.totalLength}`);
        console.log(`包围盒: ${fmtBounds(result.bounds)}`);
        if (result.reportId !== undefined) console.log(`已保存报告 id=${result.reportId}`);
        return 0;
      }
      case 'report-list': {
        const rs = flags.has('ruleset') ? num(flags, 'ruleset', 0) : undefined;
        for (const r of listAllReports(rs)) {
          console.log(
            `id=${r.id} ruleset=${r.ruleset_id}@v${r.ruleset_version} gen=${r.generation} at=${r.created_at}`,
          );
        }
        return 0;
      }
      case 'report': {
        const report = readReport(Number(positional[1]));
        const b = report.payload.bounds as Parameters<typeof fmtBounds>[0];
        console.log(
          `报告 id=${report.id} ruleset=${report.rulesetId}@v${report.rulesetVersion} gen=${report.generation}`,
        );
        console.log(`线段数量: ${String(report.payload.segmentCount)}  总长度: ${String(report.payload.totalLength)}`);
        console.log(`包围盒: ${fmtBounds(b)}`);
        return 0;
      }
      case 'export': {
        const id = Number(positional[1]);
        const out = flags.get('out') ?? join(DATA_DIR, `report-${id}.svg`);
        mkdirSync(dirname(resolve(out)), { recursive: true });
        writeFileSync(out, reportSvg(id), 'utf8');
        console.log(`已导出 SVG: ${resolve(out)}`);
        return 0;
      }
      case 'limits':
        console.log(`maxGeneration=${MAX_GENERATION}`);
        console.log(`maxSymbols=${MAX_SYMBOLS}`);
        console.log(`maxSegments=${MAX_SEGMENTS}`);
        return 0;
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        console.log(HELP);
        return 0;
      default:
        console.error(`未知命令: ${command}\n`);
        console.error(HELP);
        return 2;
    }
  } catch (err) {
    if (err instanceof AppError) {
      console.error(`错误[${err.code}] (HTTP ${errorStatusCode(err.code)}): ${err.message}`);
      return 1;
    }
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

const invoked = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (invoked.endsWith('/dist/cli.js') || invoked.endsWith('/src/cli.ts')) {
  process.exit(runCli(process.argv.slice(2)));
}
