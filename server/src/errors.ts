export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'VALIDATION_ERROR', message, details);
