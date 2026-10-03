/** 统一错误码，API 与 CLI 共用。 */
export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RESOURCE_LIMIT: 'RESOURCE_LIMIT',
  UNBALANCED_BRACKETS: 'UNBALANCED_BRACKETS',
  INTERNAL: 'INTERNAL_ERROR',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly details?: unknown;

  constructor(code: ErrorCodeValue, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError(ErrorCode.VALIDATION, message, details);
}
