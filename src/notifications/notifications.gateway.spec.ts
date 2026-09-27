import { JwtService } from '@nestjs/jwt';
import { AUTH_TIMEOUT_MS, isAllowedOrigin, NotificationsGateway, userRoom } from './notifications.gateway';

const SECRET = 'test-secret';

function buildGateway(users: { [id: string]: { id: string; blocked: boolean } }) {
  const jwtService = new JwtService({ secret: SECRET });
  const usersRepository: any = {
    findOne: jest.fn(async (options: any) => users[options.where.id] || undefined),
  };
  const gateway = new NotificationsGateway(jwtService, usersRepository);
  return { gateway, token: (sub: string, opts: any = {}) => jwtService.sign({ sub }, opts) };
}

function fakeSocket(id = 'socket-1') {
  return {
    id,
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    disconnect: jest.fn(),
  } as any;
}

const USERS = {
  u1: { id: 'u1', blocked: false },
  u2: { id: 'u2', blocked: false },
  banned: { id: 'banned', blocked: true },
};

describe('NotificationsGateway', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('puts a socket with a valid token in its user\'s room', async () => {
    const { gateway, token } = buildGateway(USERS);
    const socket = fakeSocket();
    gateway.handleConnection(socket);

    await expect(gateway.authenticate(socket, { token: token('u1') })).resolves.toEqual({ ok: true });

    expect(socket.join).toHaveBeenCalledWith(userRoom('u1'));
    jest.advanceTimersByTime(AUTH_TIMEOUT_MS * 2);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('drops a socket that never authenticates', () => {
    const { gateway } = buildGateway(USERS);
    const socket = fakeSocket();
    gateway.handleConnection(socket);

    jest.advanceTimersByTime(AUTH_TIMEOUT_MS);

    expect(socket.emit).toHaveBeenCalledWith('unauthorized', expect.anything());
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.join).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing token', undefined],
    ['a malformed token', 'not-a-jwt'],
    ['a token signed with another secret', new JwtService({ secret: 'other' }).sign({ sub: 'u1' })],
  ])('rejects %s', async (_label, bad) => {
    const { gateway } = buildGateway(USERS);
    const socket = fakeSocket();
    gateway.handleConnection(socket);

    await expect(gateway.authenticate(socket, { token: bad as any })).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('rejects an expired token', async () => {
    const { gateway, token } = buildGateway(USERS);
    const socket = fakeSocket();
    const expired = token('u1', { expiresIn: -10 });

    await expect(gateway.authenticate(socket, { token: expired })).resolves.toEqual(
      expect.objectContaining({ ok: false }),
    );
    expect(socket.join).not.toHaveBeenCalled();
  });

  it('rejects blocked and deleted users', async () => {
    const { gateway, token } = buildGateway(USERS);

    for (const sub of ['banned', 'deleted']) {
      const socket = fakeSocket(sub);
      await expect(gateway.authenticate(socket, { token: token(sub) })).resolves.toEqual(
        expect.objectContaining({ ok: false }),
      );
      expect(socket.join).not.toHaveBeenCalled();
    }
  });

  it('moves the socket when a different user signs in on the same page', async () => {
    const { gateway, token } = buildGateway(USERS);
    const socket = fakeSocket();

    await gateway.authenticate(socket, { token: token('u1') });
    await gateway.authenticate(socket, { token: token('u2') });

    expect(socket.leave).toHaveBeenCalledWith(userRoom('u1'));
    expect(socket.join).toHaveBeenLastCalledWith(userRoom('u2'));
  });

  it('emits to the user\'s room, and is a no-op before the server exists', () => {
    const { gateway } = buildGateway(USERS);
    expect(() => gateway.sendToUser('u1', 'notification', {})).not.toThrow();

    const emit = jest.fn();
    gateway.server = { to: jest.fn(() => ({ emit })) } as any;
    gateway.sendToUser('u1', 'notification', { id: 'n1' });

    expect(gateway.server.to).toHaveBeenCalledWith(userRoom('u1'));
    expect(emit).toHaveBeenCalledWith('notification', { id: 'n1' });
  });
});

describe('isAllowedOrigin', () => {
  it('accepts the configured frontend and requests without an Origin, and nothing else', () => {
    expect(isAllowedOrigin('http://localhost:5000')).toBe(true);
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('https://evil.example')).toBe(false);
  });
});
