import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { AppError, errorStatusCode } from './errors.js';
import { openDb } from './db.js';
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
const DB_PATH = join(DATA_DIR, 'lsystem.db');

/** 请求操作系统选择一个空闲端口：先绑 0 再关闭。 */
export function pickFreePort(preferred = 0): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const srv = createNetServer();
    srv.on('error', reject);
    srv.listen(preferred, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const port = addr.port;
        srv.close(() => resolvePort(port));
      } else {
        srv.close(() => reject(new Error('无法获取空闲端口')));
      }
    });
  });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_PARAM', '请求体不是合法 JSON');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(text);
}

function sendError(res: ServerResponse, err: unknown): void {
  if (err instanceof AppError) {
    sendJson(res, errorStatusCode(err.code), {
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  sendJson(res, 500, { ok: false, error: { code: 'INTERNAL', message } });
}

function parseTurtleParams(obj: Record<string, unknown>): import('./turtle.js').TurtleParams {
  return {
    step: Number(obj.step ?? 10),
    angleDeg: Number(obj.angleDeg ?? 90),
    startX: obj.startX === undefined ? undefined : Number(obj.startX),
    startY: obj.startY === undefined ? undefined : Number(obj.startY),
    startHeadingDeg:
      obj.startHeadingDeg === undefined ? undefined : Number(obj.startHeadingDeg),
  };
}

export function createApp(): Server {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/health') {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && path === '/api/limits') {
        const { MAX_GENERATION, MAX_SEGMENTS, MAX_SYMBOLS } = await import('./service.js');
        sendJson(res, 200, { maxGeneration: MAX_GENERATION, maxSymbols: MAX_SYMBOLS, maxSegments: MAX_SEGMENTS });
        return;
      }

      // 规则集 CRUD
      if (method === 'POST' && path === '/api/rulesets') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const row = saveRuleset({
          name: String(body.name ?? ''),
          axiom: String(body.axiom ?? ''),
          rules: (body.rules ?? []) as Array<{ symbol: string; replacement: string }>,
        });
        sendJson(res, 201, { ok: true, ruleset: row });
        return;
      }
      if (method === 'GET' && path === '/api/rulesets') {
        sendJson(res, 200, { ok: true, rulesets: listAllRulesets() });
        return;
      }

      let m = path.match(/^\/api\/rulesets\/(\d+)$/);
      if (m && method === 'GET') {
        const { getRuleset, parseRules } = await import('./db.js');
        const row = getRuleset(Number(m[1]));
        sendJson(res, 200, { ok: true, ruleset: { ...row, rules: parseRules(row) } });
        return;
      }
      if (m && method === 'PUT') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const row = modifyRuleset(Number(m[1]), {
          name: body.name === undefined ? undefined : String(body.name),
          axiom: body.axiom === undefined ? undefined : String(body.axiom),
          rules: body.rules === undefined ? undefined : (body.rules as Array<{ symbol: string; replacement: string }>),
        });
        sendJson(res, 200, { ok: true, ruleset: row });
        return;
      }

      // 不落库的按代预览
      if (method === 'POST' && path === '/api/preview') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const result = previewGenerate({
          axiom: String(body.axiom ?? ''),
          rules: (body.rules ?? []) as Array<{ symbol: string; replacement: string }>,
          generation: Number(body.generation ?? 0),
        });
        sendJson(res, 200, { ok: true, result });
        return;
      }

      // 解释几何并可保存报告
      if (method === 'POST' && path === '/api/interpret') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const result = interpretRuleset(
          {
            rulesetId: Number(body.rulesetId),
            generation: Number(body.generation ?? 0),
            params: parseTurtleParams((body.params ?? {}) as Record<string, unknown>),
            persist: Boolean(body.persist),
          },
          true,
        );
        sendJson(res, 200, { ok: true, result });
        return;
      }

      // 报告
      if (method === 'GET' && path === '/api/reports') {
        const rulesetId = url.searchParams.get('rulesetId');
        sendJson(res, 200, { ok: true, reports: listAllReports(rulesetId ? Number(rulesetId) : undefined) });
        return;
      }
      m = path.match(/^\/api\/reports\/(\d+)$/);
      if (m && method === 'GET') {
        const report = readReport(Number(m[1]));
        sendJson(res, 200, { ok: true, report });
        return;
      }
      const mSvg = path.match(/^\/api\/reports\/(\d+)\/svg$/);
      if (mSvg && method === 'GET') {
        const svg = reportSvg(Number(mSvg[1]));
        res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
        res.end(svg);
        return;
      }
      if (mSvg && method === 'POST') {
        const body = (await readJson(req)) as Record<string, unknown>;
        const outPath = typeof body.path === 'string' ? body.path : '';
        const svg = reportSvg(Number(mSvg[1]));
        if (outPath) {
          mkdirSync(resolve(outPath, '..'), { recursive: true });
          writeFileSync(outPath, svg, 'utf8');
          sendJson(res, 200, { ok: true, path: resolve(outPath), bytes: svg.length });
        } else {
          res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
          res.end(svg);
        }
        return;
      }

      sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: `无此路由: ${method} ${path}` } });
    } catch (err) {
      sendError(res, err);
    }
  });
}

async function main(): Promise<void> {
  openDb(DB_PATH);
  const requested = process.env.LSYS_PORT ? Number(process.env.LSYS_PORT) : 0;
  const port = requested ? await pickFreePort(requested) : await pickFreePort(0);
  const app = createApp();
  app.listen(port, '127.0.0.1', () => {
    console.log(`[lsystem] 数据目录: ${DATA_DIR}`);
    console.log(`[lsystem] HTTP 服务已启动: http://127.0.0.1:${port}`);
  });
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, '/') : '';
if (invokedPath.endsWith('/dist/server.js') || invokedPath.endsWith('/src/server.ts') || process.env.LSYS_RUN_SERVER === '1') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
