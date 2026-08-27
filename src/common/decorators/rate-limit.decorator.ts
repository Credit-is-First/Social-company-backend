import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  /** Maximum number of requests allowed per client within the window. */
  limit: number;
  /** Length of the window in milliseconds. */
  windowMs: number;
}

/**
 * Throttles a route per client IP. Applied to the unauthenticated auth
 * endpoints, which are otherwise free to brute-force.
 */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
