import { RolesGuard } from './roles.guard';

function buildContext(user: any) {
  return {
    getHandler: () => ({ name: 'handler' }),
    getClass: () => ({ name: 'Controller' }),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

/**
 * `getAllAndOverride` is called twice per request: first for the @Public flag,
 * then for the required roles.
 */
function buildGuard(isPublic: boolean, requiredRoles?: string[]) {
  const reflector: any = {
    getAllAndOverride: jest.fn((key: string) => (key === 'isPublic' ? isPublic : requiredRoles)),
  };
  return new RolesGuard(reflector);
}

const roleOf = (name: string) => ({ name });

describe('RolesGuard', () => {
  it('lets public routes through without a user', () => {
    const guard = buildGuard(true, ['book:read']);
    expect(guard.canActivate(buildContext(undefined))).toBe(true);
  });

  it('denies a non-public route with no user attached', () => {
    const guard = buildGuard(false, ['book:read']);
    expect(guard.canActivate(buildContext(undefined))).toBe(false);
  });

  it('allows any authenticated user when no roles are required', () => {
    const guard = buildGuard(false, undefined);
    expect(guard.canActivate(buildContext({ roles: [], groups: [] }))).toBe(true);
  });

  it('allows an empty required-roles list', () => {
    const guard = buildGuard(false, []);
    expect(guard.canActivate(buildContext({ roles: [], groups: [] }))).toBe(true);
  });

  it('grants access from a direct role', () => {
    const guard = buildGuard(false, ['book:read']);
    const user = { roles: [roleOf('book:read')], groups: [] };
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });

  it('grants access from a role inherited via a group', () => {
    const guard = buildGuard(false, ['book:approve']);
    const user = { roles: [], groups: [{ roles: [roleOf('book:approve')] }] };
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });

  it('grants access when any one of the required roles matches', () => {
    const guard = buildGuard(false, ['book:approve', 'book:decline']);
    const user = { roles: [roleOf('book:decline')], groups: [] };
    expect(guard.canActivate(buildContext(user))).toBe(true);
  });

  it('denies a user holding only unrelated roles', () => {
    const guard = buildGuard(false, ['user:delete']);
    const user = { roles: [roleOf('book:read')], groups: [{ roles: [roleOf('book:create')] }] };
    expect(guard.canActivate(buildContext(user))).toBe(false);
  });

  it('tolerates a user with no roles or groups loaded', () => {
    const guard = buildGuard(false, ['user:read']);
    expect(guard.canActivate(buildContext({}))).toBe(false);
  });
});
