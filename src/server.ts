import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { AppError, ErrorCode } from './errors.js';
import type { StoredReport } from './store.js';
import { LSystemService } from './service.js';
import { toSvg } from './svg.js';
import type { TurtleParams } from './types.js';

interface JsonBody {
  [key: string]: unknown;
}

async function readJson(req: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 5_000_000) {
      throw new AppError(ErrorCode.VALIDATION, '请求体超过 5MB 上限');
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AppError(ErrorCode.VALIDATION, '请求体必须是 JSON 对象');
    }
    return parsed as JsonBody;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(ErrorCode.VALIDATION, '请求体不是合法 JSON');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function errorBody(err: unknown): { status: number; code: string; message: string; details?: unknown } {
  if (err instanceof AppError) {
    const status =
      err.code === ErrorCode.VALIDATION ? 400
      : err.code === ErrorCode.NOT_FOUND ? 404
      : err.code === ErrorCode.CONFLICT ? 409
      : err.code === ErrorCode.UNBALANCED_BRACKETS ? 422
      : err.code === ErrorCode.RESOURCE_LIMIT ? 422
      : 500;
    return { status, code: err.code, message: err.message, details: err.details };
  }
  const message = err instanceof Error ? err.message : '未知错误';
  return { status: 500, code: ErrorCode.INTERNAL, message };
}

function parseTurtle(body: JsonBody): TurtleParams | undefined {
  const t = body.turtle;
  if (t === undefined || t === null) return undefined;
  if (typeof t !== 'object' || Array.isArray(t)) {
    throw new AppError(ErrorCode.VALIDATION, 'turtle 必须是对象 {step, angleDeg, initialAngleDeg?, initialX?, initialY?}');
  }
  return t as TurtleParams;
}

export interface HttpServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

export async function startHttp(service: LSystemService, preferredPort?: number): Promise<HttpServer> {
  const server = createServer((req, res) => {
    void handle(service, req, res);
  });

  const port = await listen(server, preferredPort);
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function listen(server: Server, preferredPort?: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (preferredPort !== undefined && err.code === 'EADDRINUSE') {
        server.listen(0, '127.0.0.1');
      } else {
        reject(err);
      }
    });
    server.listen(preferredPort ?? 0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function handle(service: LSystemService, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = req.method ?? 'GET';

  try {
    // 健康检查与限制说明
    if (method === 'GET' && path === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (method === 'GET' && path === '/limits') {
      sendJson(res, 200, LIMITS_VIEW);
      return;
    }

    // 规则集
    if (method === 'POST' && path === '/api/rulesets') {
      const body = await readJson(req);
      const rs = service.createRuleSet(body as never);
      sendJson(res, 201, rs);
      return;
    }
    if (method === 'GET' && path === '/api/rulesets') {
      sendJson(res, 200, service.listRuleSets());
      return;
    }
    const rsMatch = /^\/api\/rulesets\/(\d+)$/.exec(path);
    if (rsMatch) {
      const id = Number(rsMatch[1]);
      const version = url.searchParams.get('version');
      if (method === 'GET') {
        sendJson(res, 200, service.getRuleSet(id, version === null ? undefined : Number(version)));
        return;
      }
      if (method === 'PUT') {
        const body = await readJson(req);
        sendJson(res, 200, service.updateRuleSet(id, body as never));
        return;
      }
    }

    // 生成（导入规则并生成也可由两步完成）
    const genMatch = /^\/api\/rulesets\/(\d+)\/generate$/.exec(path);
    if (genMatch && method === 'POST') {
      const id = Number(genMatch[1]);
      const body = await readJson(req);
      const generations = Number(body.generations);
      const out = service.generate(id, {
        generations,
        turtle: parseTurtle(body),
        save: body.save === false ? false : true,
        version: typeof body.version === 'number' ? body.version : undefined,
      });
      sendJson(res, 200, out);
      return;
    }

    // 报告
    if (method === 'GET' && path === '/api/reports') {
      const rsParam = url.searchParams.get('rulesetId');
      sendJson(res, 200, service.listReports(rsParam === null ? undefined : Number(rsParam)));
      return;
    }
    const repMatch = /^\/api\/reports\/(\d+)$/.exec(path);
    if (repMatch && method === 'GET') {
      const { report, result } = service.getReport(Number(repMatch[1]));
      sendJson(res, 200, { report: reportMeta(report), result });
      return;
    }
    const svgMatch = /^\/api\/reports\/(\d+)\/svg$/.exec(path);
    if (svgMatch && method === 'GET') {
      const { result } = service.getReport(Number(svgMatch[1]));
      const svg = toSvg(result);
      res.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8' });
      res.end(svg);
      return;
    }

    sendJson(res, 404, { code: ErrorCode.NOT_FOUND, message: `无此路由: ${method} ${path}` });
  } catch (err) {
    const e = errorBody(err);
    sendJson(res, e.status, { code: e.code, message: e.message, details: e.details });
  }
}

function reportMeta(report: StoredReport) {
  return {
    id: report.id,
    rulesetId: report.ruleset_id,
    rulesetVersion: report.ruleset_version,
    rulesetName: report.ruleset_name,
    generations: report.generations,
    turtle: JSON.parse(report.turtle_json) as unknown,
    status: report.status,
    createdAt: report.created_at,
  };
}

const LIMITS_VIEW = {
  maxGenerations: 12,
  maxSymbols: 1_000_000,
  maxSegments: 100_000,
  angleUnit: 'degree',
  coordinateSystem: 'cartesian, +x right, +y up, + counterclockwise',
};
