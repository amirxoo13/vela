export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Maps documented One-Api status codes to client-facing errors. */
export function mapUpstreamStatus(status: number, upstreamMessage?: string): ApiError {
  const m = upstreamMessage ? ` (${upstreamMessage})` : '';
  switch (status) {
    case 400: return new ApiError(400, 'INVALID_PARAMS', `Invalid parameters${m}`);
    case 401: return new ApiError(502, 'UPSTREAM_AUTH', 'Upstream rejected the API token (missing or invalid token on server)');
    case 403: return new ApiError(503, 'UPSTREAM_CREDIT', 'Upstream API credit exhausted; please try again later');
    case 404: return new ApiError(404, 'NOT_FOUND', `Item not found or removed${m}`);
    case 409: return new ApiError(404, 'NOT_FOUND', 'Requested upstream path does not exist');
    case 429: return new ApiError(429, 'RATE_LIMITED', 'Upstream rate limit reached; slow down');
    case 500: return new ApiError(502, 'UPSTREAM_EMPTY', 'Upstream returned an empty response');
    default: return new ApiError(502, 'UPSTREAM_ERROR', `Upstream error (status ${status})${m}`);
  }
}
