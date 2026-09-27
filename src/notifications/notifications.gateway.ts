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
  private readonly socketUser = new Map<string, string>();

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
    this.socketUser.delete(client.id);
  }

  /**
   * Verifies the access token the same way the HTTP guard does: a valid
   * signature, not expired, and an existing user who is not blocked. Sending
   * it again (after a token refresh or a sign-in as someone else) moves the
   * socket to the new user's room.
   */
  @SubscribeMessage('authenticate')
  async authenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { token?: string },
  ): Promise<{ ok: boolean; message?: string }> {
    const userId = await this.verify(body && body.token);
    if (!userId) {
      this.clearPending(client.id);
      client.emit('unauthorized', { message: 'Invalid or expired token' });
      client.disconnect(true);
      return { ok: false, message: 'Invalid or expired token' };
    }

    const previous = this.socketUser.get(client.id);
    if (previous && previous !== userId) {
      client.leave(userRoom(previous));
    }
    this.clearPending(client.id);
    this.socketUser.set(client.id, userId);
    client.join(userRoom(userId));
    return { ok: true };
  }

  /** Pushes an event to every connected socket of one user. */
  sendToUser(userId: string, event: string, payload: any): void {
    if (!this.server) {
      return; // Not listening (unit tests, or before the app has started).
    }
    this.server.to(userRoom(userId)).emit(event, payload);
  }

  private async verify(token: string | undefined): Promise<string | null> {
    if (!token || typeof token !== 'string') {
      return null;
    }
    try {
      const payload: any = this.jwtService.verify(token);
      const user = await this.usersRepository.findOne({ where: { id: payload.sub } });
      return user && !user.blocked ? user.id : null;
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
}
