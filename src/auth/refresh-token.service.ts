import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { RefreshToken } from './entities/refresh-token.entity';
import { env } from '../config/env';

const TOKEN_BYTES = 48;

/**
 * How long after a token is consumed a repeat presentation is treated as a race
 * rather than as theft.
 *
 * Two tabs restoring their session at the same moment both send the cookie the
 * browser had before either response arrived. Without this window the second
 * one looks like a replay and would revoke every session the user has, which
 * turns an ordinary double-load into a forced sign-out. A genuine stolen token
 * is replayed long after this.
 */
const REUSE_GRACE_MS = env.refreshReuseGraceMs;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class RefreshTokenService {
  constructor(
    @InjectRepository(RefreshToken)
    private refreshTokensRepository: Repository<RefreshToken>,
  ) {}

  /** Mints a new refresh token and returns the raw value (stored hashed). */
  async issue(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(TOKEN_BYTES).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.refreshTokenTtlDays);

    await this.refreshTokensRepository.save(
      this.refreshTokensRepository.create({
        userId,
        tokenHash: hashToken(token),
        expiresAt,
      }),
    );

    return { token, expiresAt };
  }

  /**
   * Validates a presented token and consumes it (rotation).
   *
   * If a token that was already used is presented again, treat it as a stolen
   * credential and revoke the whole family — the legitimate holder will be
   * forced to sign in again, which is the safe outcome.
   */
  async consume(token: string): Promise<string> {
    if (!token) {
      throw new UnauthorizedException('Refresh token is required');
    }

    const record = await this.refreshTokensRepository.findOne({
      where: { tokenHash: hashToken(token) },
    });

    if (!record) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (record.revokedAt) {
      if (Date.now() - record.revokedAt.getTime() <= REUSE_GRACE_MS) {
        // Concurrent refresh, not theft: reject this one but leave the
        // freshly-rotated session the other caller just received intact.
        throw new UnauthorizedException('A refresh is already in progress. Please retry.');
      }

      await this.revokeAllForUser(record.userId);
      throw new UnauthorizedException('Refresh token has already been used. Please sign in again.');
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token has expired. Please sign in again.');
    }

    record.revokedAt = new Date();
    await this.refreshTokensRepository.save(record);

    return record.userId;
  }

  async revoke(token: string): Promise<void> {
    if (!token) {
      return;
    }
    await this.refreshTokensRepository.update(
      { tokenHash: hashToken(token), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Used on password change/reset and on refresh-token reuse. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshTokensRepository.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /** Drops rows that can no longer be used. Called opportunistically on login. */
  async purgeExpired(): Promise<void> {
    await this.refreshTokensRepository.delete({ expiresAt: LessThan(new Date()) });
  }
}
