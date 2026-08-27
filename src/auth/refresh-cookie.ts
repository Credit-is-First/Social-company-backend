import { Request, Response } from 'express';
import { parse as parseCookies } from 'cookie';
import { env } from '../config/env';

export const REFRESH_COOKIE_NAME = 'library_refresh_token';

/**
 * Scoped to the auth routes, so the cookie is not attached to ordinary API
 * calls at all. Combined with httpOnly + SameSite it means the refresh token is
 * unreadable by page script and unreachable from another origin.
 */
export const REFRESH_COOKIE_PATH = '/auth';

function baseOptions() {
  const options: any = {
    httpOnly: true,
    secure: env.cookies.secure,
    sameSite: env.cookies.sameSite,
    path: REFRESH_COOKIE_PATH,
  };
  if (env.cookies.domain) {
    options.domain = env.cookies.domain;
  }
  return options;
}

export function setRefreshCookie(response: Response, token: string, expiresAt: Date): void {
  response.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(response: Response): void {
  // Attributes must match the ones used to set it or the browser keeps the
  // original cookie.
  response.clearCookie(REFRESH_COOKIE_NAME, baseOptions());
}

/**
 * Reads the refresh cookie straight off the header.
 *
 * cookie-parser is not installed (and cannot be, offline), but `cookie` ships
 * as an express dependency and is all that is needed here.
 */
export function readRefreshCookie(request: Request): string | null {
  const header = request.headers && request.headers.cookie;
  if (!header) {
    return null;
  }
  try {
    const jar = parseCookies(header);
    return jar[REFRESH_COOKIE_NAME] || null;
  } catch (error) {
    return null;
  }
}
