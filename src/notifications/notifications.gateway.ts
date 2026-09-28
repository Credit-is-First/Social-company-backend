import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { env } from '../config/env';

/** How long a new connection has to authenticate before it is dropped. */
export const AUTH_TIMEOUT_MS = 10000;

/** Longest delay setTimeout accepts (about 24.8 days). */
const MAX_TIMER_MS = 2147483647;

export const userRoom = (userId: string): string => `user:${userId}`;

/**
 * Browsers always send Origin on a WebSocket handshake, so only the configured
 * frontend origins may connect. A request without one is not from a page on
 * another site (same-origin polling can omit it), and still has to present a
 * valid access token before it receives anything.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  return !origin || origin === '*' || env.corsOrigins.indexOf(origin) !== -1;
}

/**
 * Live delivery for notifications.
 *
 * The client connects, then sends its access token in an `authenticate`
 * message: socket.io 2 has no handshake auth field, and a token in the query
 * string would end up in proxy and server logs. Until that succeeds the socket
 * is in no room and receives nothing; if it never succeeds it is disconnected.
 * Each user's sockets share a room, so every open tab gets the notification.
 */
@WebSocketGateway({
  namespace: '/notifications',
  // engine.io's hook; replaces socket.io 2's looser `origins` check.
  allowRequest: (req: any, callback: (err: any, success: boolean) => void) =>
    callback(null, isAllowedOrigin(req.headers.origin)),
} as any)
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private readonly pendingAuth = new Map<string, NodeJS.Timeout>();
  /** Signed-in sockets, and whose they are. */
  private readonly sockets = new Map<string, { socket: Socket; userId: string }>();
  /** Drops each signed-in socket when the access token it signed in with expires. */
  private readonly expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  handleConnection(client: Socket): void {
    const timer = setTimeout(() => {
      this.pendingAuth.delete(client.id);
      client.emit('unauthorized', { message: 'Authentication timed out' });
      client.disconnect(true);
    }, AUTH_TIMEOUT_MS);
    this.pendingAuth.set(client.id, timer);
  }

  handleDisconnect(client: Socket): void {
    this.clearPending(client.id);
    this.clearExpiry(client.id);
    this.sockets.delete(client.id);
  }

  /**
   * Verifies the access token the same way the HTTP guard does: a valid
   * signature, not expired, and an existing user who is not blocked. Sending
   * it again (after a token refresh or a sign-in as someone else) moves the
   * socket to the new user's room.
   *
   * A socket stays signed in only as long as its token is valid, as a request
   * would: when the token expires the socket is sent `unauthorized` and
   * dropped, and the page refreshes its session and reconnects.
   */
  @SubscribeMessage('authenticate')
  async authenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { token?: string },
  ): Promise<{ ok: boolean; message?: string }> {
    const verified = await this.verify(body && body.token);

    // The socket may have gone while the user was being looked up; its
    // disconnect cleanup has already run, so record nothing for it.
    if (client.disconnected) {
      return { ok: false, message: 'Disconnected' };
    }

    if (!verified) {
      this.clearPending(client.id);
      this.drop(client, 'Invalid or expired token');
      return { ok: false, message: 'Invalid or expired token' };
    }

    const previous = this.sockets.get(client.id);
    if (previous && previous.userId !== verified.userId) {
      client.leave(userRoom(previous.userId));
    }
    this.clearPending(client.id);
    this.sockets.set(client.id, { socket: client, userId: verified.userId });
    client.join(userRoom(verified.userId));
    this.scheduleExpiry(client, verified.expiresAt);
    return { ok: true };
  }

  /** Pushes an event to every connected socket of one user. */
  sendToUser(userId: string, event: string, payload: any): void {
    if (!this.server) {
      return; // Not listening (unit tests, or before the app has started).
    }
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  /**
   * Drops every socket a user has signed in, at once: their account was
   * blocked or deleted, so they must stop receiving notifications now rather
   * than when their token runs out.
   */
  disconnectUser(userId: string, reason: string): void {
    this.sockets.forEach(entry => {
      if (entry.userId === userId) {
        this.drop(entry.socket, reason);
      }
    });
  }

  private drop(client: Socket, message: string): void {
    client.emit('unauthorized', { message });
    client.disconnect(true);
  }

  private scheduleExpiry(client: Socket, expiresAt: number | null): void {
    this.clearExpiry(client.id);
    if (!expiresAt) {
      return; // A token without an expiry lasts as long as the connection.
    }
    // setTimeout overflows past ~24.8 days; tokens here last minutes.
    const delay = Math.min(Math.max(expiresAt - Date.now(), 0), MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.expiryTimers.delete(client.id);
      this.drop(client, 'Session expired');
    }, delay);
    this.expiryTimers.set(client.id, timer);
  }

  private async verify(token: string | undefined): Promise<{ userId: string; expiresAt: number | null } | null> {
    if (!token || typeof token !== 'string') {
      return null;
    }
    try {
      const payload: any = this.jwtService.verify(token);
      const user = await this.usersRepository.findOne({ where: { id: payload.sub } });
      if (!user || user.blocked) {
        return null;
      }
      return { userId: user.id, expiresAt: typeof payload.exp === 'number' ? payload.exp * 1000 : null };
    } catch (error) {
      this.logger.debug(`Socket authentication failed: ${error && error.message}`);
      return null;
    }
  }

  private clearPending(socketId: string): void {
    const timer = this.pendingAuth.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.pendingAuth.delete(socketId);
    }
  }

  private clearExpiry(socketId: string): void {
    const timer = this.expiryTimers.get(socketId);
    if (timer) {
      clearTimeout(timer);
      this.expiryTimers.delete(socketId);
    }
  }
}
