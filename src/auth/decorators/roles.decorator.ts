import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
// Accept role names as strings (e.g., 'admin', 'librarian', 'user')
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

