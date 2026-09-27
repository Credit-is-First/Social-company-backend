import { ForbiddenException } from '@nestjs/common';
import { User } from '../users/entities/user.entity';

/**
 * Privilege containment, shared by every path that hands out or takes away
 * roles — user role/group assignment, account creation, and group editing.
 *
 * The rule: nobody can grant, or revoke, a role they do not hold themselves.
 * Without it an Admin could give themselves (or a group they belong to, or an
 * account they control) every role, which is Super Admin in all but name; or
 * strip roles from a more privileged group or user. Only the roles that
 * actually change are checked, so editing something that already carries a
 * role the caller lacks still works as long as that role is left alone.
 *
 * `actor` must have its roles, groups and groups' roles loaded, as the user
 * JwtStrategy attaches to every request does.
 */

function missing(actor: User, roleNames: string[]): string[] {
  const held = actor.getAllRoleNames();
  const beyond = roleNames.filter(name => held.indexOf(name) === -1);
  return Array.from(new Set(beyond));
}

export function assertCanGrant(actor: User, roleNames: string[]): void {
  const beyond = missing(actor, roleNames);
  if (beyond.length > 0) {
    throw new ForbiddenException(`You cannot grant roles you do not hold yourself: ${beyond.join(', ')}`);
  }
}

export function assertCanRevoke(actor: User, roleNames: string[]): void {
  const beyond = missing(actor, roleNames);
  if (beyond.length > 0) {
    throw new ForbiddenException(`You cannot remove roles you do not hold yourself: ${beyond.join(', ')}`);
  }
}

/**
 * Taking over an account means taking over its roles, so acting as someone
 * (resetting their password) is only allowed when the caller already holds
 * everything they do. This is what stops an Admin resetting the Super Admin's
 * password.
 */
export function assertCanActAs(actor: User, target: User): void {
  if (missing(actor, target.getAllRoleNames()).length > 0) {
    throw new ForbiddenException('You cannot reset the password of an account with more privileges than your own');
  }
}

/** Role names in `next` that are not in `current`, and vice versa. */
export function diffRoleNames(current: string[], next: string[]): { added: string[]; removed: string[] } {
  return {
    added: next.filter(name => current.indexOf(name) === -1),
    removed: current.filter(name => next.indexOf(name) === -1),
  };
}
