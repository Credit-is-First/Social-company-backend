import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
// Accept role names as strings (e.g., 'role:create', 'book:read')
export const HasRoles = (...roles: string[]) =>
  SetMetadata(ROLES_KEY, roles);
