export type ErrorCode =
  | 'INVALID_SYMBOL'
  | 'DUPLICATE_RULE'
  | 'INVALID_PARAM'
  | 'NOT_FOUND'
  | 'GENERATION_LIMIT'
  | 'UNBALANCED_BRACKETS'
  | 'INVALID_RULESET';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

/** 校验单个 ASCII 符号（33~126，排除方括号等控制海龟结构的保留符号）。 */
export function assertSymbol(ch: string): void {
  if (typeof ch !== 'string' || ch.length !== 1) {
    throw new AppError('INVALID_SYMBOL', `符号必须是单个字符，收到: ${JSON.stringify(ch)}`);
  }
  const code = ch.charCodeAt(0);
  if (code < 33 || code > 126) {
    throw new AppError('INVALID_SYMBOL', `符号必须是可打印 ASCII 字符(33-126)，收到: ${JSON.stringify(ch)}`);
  }
}

/** 替换串中的每个字符也必须是可打印 ASCII；[] 允许出现在替换串中（分支）。 */
export function assertProductionString(s: string): void {
  if (typeof s !== 'string') {
    throw new AppError('INVALID_PARAM', '替换内容必须是字符串');
  }
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) {
      throw new AppError('INVALID_SYMBOL', `替换内容含非可打印字符: ${JSON.stringify(ch)}`);
    }
  }
}

export function errorStatusCode(code: ErrorCode): number {
  switch (code) {
    case 'NOT_FOUND':
      return 404;
    case 'GENERATION_LIMIT':
      return 422;
    case 'UNBALANCED_BRACKETS':
      return 422;
    default:
      return 400;
  }
}
