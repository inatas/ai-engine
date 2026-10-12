import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string,
    public readonly retryAfter?: number) { super(message); }
}
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const parserError = error as { type?: string } | null;
    const failure = error instanceof ApiError ? error : parserError?.type === 'entity.parse.failed'
      ? new ApiError(400, 'invalid_json', '请求不是有效 JSON')
      : parserError?.type === 'entity.too.large' ? new ApiError(413, 'payload_too_large', '请求过大')
      : error instanceof HttpException && error.getStatus() === 400 ? new ApiError(400, 'invalid_json', '请求不是有效 JSON')
      : error instanceof HttpException && error.getStatus() === 404 ? new ApiError(404, 'object_unavailable', '此入口不可用')
      : new ApiError(500, 'internal_error', '服务暂时不可用，请稍后重试');
    response.setHeader('Cache-Control', 'no-store');
    if (failure.retryAfter) response.setHeader('Retry-After', failure.retryAfter);
    response.status(failure.status).json({ error: { code: failure.code, message: failure.message, details: [] } });
  }
}
