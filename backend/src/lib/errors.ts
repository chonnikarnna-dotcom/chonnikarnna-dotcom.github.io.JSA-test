export type FieldError = { path: string; code: string; message: string; params?: Record<string, unknown> };

/** Application error with a stable machine-readable code (translated by the frontend). */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: FieldError[] | Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string, details?: AppError['details']) => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHENTICATED', msg);
export const forbidden = (code = 'FORBIDDEN', msg = 'You are not allowed to perform this action') => new AppError(403, code, msg);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, msg: string, details?: AppError['details']) => new AppError(409, code, msg, details);
export const unprocessable = (code: string, msg: string, details?: AppError['details']) => new AppError(422, code, msg, details);
