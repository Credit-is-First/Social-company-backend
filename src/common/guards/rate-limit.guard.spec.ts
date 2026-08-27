import { HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitOptions } from '../decorators/rate-limit.decorator';

function buildContext(handlerName: string, ip: string) {
  const response = { setHeader: jest.fn() };
  return {
    context: {
      getHandler: () => ({ name: handlerName }),
      getClass: () => ({ name: 'TestController' }),
      switchToHttp: () => ({
        getRequest: () => ({ ip }),
        getResponse: () => response,
      }),
    } as any,
    response,
  };
}

function buildGuard(options: RateLimitOptions | undefined) {
  const reflector: any = { getAllAndOverride: jest.fn(() => options) };
  return new RateLimitGuard(reflector);
}

describe('RateLimitGuard', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('allows routes with no rate limit configured', () => {
    const guard = buildGuard(undefined);
    const { context } = buildContext('unlimited', '1.1.1.1');

    for (let i = 0; i < 50; i++) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it('allows requests up to the limit and rejects the next one', () => {
    const guard = buildGuard({ limit: 3, windowMs: 60000 });
    const { context } = buildContext('login', '1.1.1.1');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);

    expect(() => guard.canActivate(context)).toThrow(HttpException);
  });

  it('rejects with 429 and a Retry-After header', () => {
    const guard = buildGuard({ limit: 1, windowMs: 60000 });
    const { context, response } = buildContext('login', '1.1.1.1');

    guard.canActivate(context);

    try {
      guard.canActivate(context);
      fail('expected the guard to throw');
    } catch (error) {
      expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('counts each client IP separately', () => {
    const guard = buildGuard({ limit: 1, windowMs: 60000 });
    const first = buildContext('login', '1.1.1.1');
    const second = buildContext('login', '2.2.2.2');

    expect(guard.canActivate(first.context)).toBe(true);
    expect(guard.canActivate(second.context)).toBe(true);

    expect(() => guard.canActivate(first.context)).toThrow(HttpException);
  });

  it('counts each route separately', () => {
    const guard = buildGuard({ limit: 1, windowMs: 60000 });
    const login = buildContext('login', '1.1.1.1');
    const reset = buildContext('resetPassword', '1.1.1.1');

    expect(guard.canActivate(login.context)).toBe(true);
    expect(guard.canActivate(reset.context)).toBe(true);
  });

  it('starts a fresh window once the previous one expires', () => {
    const guard = buildGuard({ limit: 1, windowMs: 1000 });
    const { context } = buildContext('login', '1.1.1.1');

    const now = 1_000_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);

    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);

    clock.mockReturnValue(now + 1001);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('forgets everything after a reset', () => {
    const guard = buildGuard({ limit: 1, windowMs: 60000 });
    const { context } = buildContext('login', '1.1.1.1');

    expect(guard.canActivate(context)).toBe(true);
    guard.reset();
    expect(guard.canActivate(context)).toBe(true);
  });
});
