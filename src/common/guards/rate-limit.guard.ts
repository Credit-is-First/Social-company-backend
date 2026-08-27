import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../decorators/rate-limit.decorator';
import { env } from '../../config/env';

interface Counter {
  count: number;
  expiresAt: number;
}

/** Entries are swept once the map grows past this, to bound memory. */
const SWEEP_THRESHOLD = 5000;

/**
 * Fixed-window rate limiter held in process memory.
 *
 * Deliberately dependency-free. The trade-off is that the counters are per
 * process: running multiple backend instances multiplies the effective limit,
 * and a restart clears it. For a single-instance deployment that is fine; for a
 * cluster this wants a shared store.
 *
 * It also keys on the socket address, so it must not sit behind a reverse proxy
 * without `trust proxy` configured, or every client looks like one IP.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly counters = new Map<string, Counter>();

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options || !env.rateLimitEnabled) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const key = `${context.getClass().name}.${context.getHandler().name}:${this.clientKey(request)}`;
    const now = Date.now();

    this.sweep(now);

    const counter = this.counters.get(key);

    if (!counter || counter.expiresAt <= now) {
      this.counters.set(key, { count: 1, expiresAt: now + options.windowMs });
      return true;
    }

    counter.count++;

    if (counter.count > options.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((counter.expiresAt - now) / 1000));
      const response = context.switchToHttp().getResponse();
      if (response && typeof response.setHeader === 'function') {
        response.setHeader('Retry-After', String(retryAfterSeconds));
      }
      throw new HttpException(
        `Too many requests. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? '' : 's'}.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private clientKey(request: any): string {
    return (
      (request && request.ip) ||
      (request && request.connection && request.connection.remoteAddress) ||
      'unknown'
    );
  }

  private sweep(now: number): void {
    if (this.counters.size < SWEEP_THRESHOLD) {
      return;
    }
    this.counters.forEach((counter, key) => {
      if (counter.expiresAt <= now) {
        this.counters.delete(key);
      }
    });
  }

  /** Test seam: drops all counters. */
  reset(): void {
    this.counters.clear();
  }
}
