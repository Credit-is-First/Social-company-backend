import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    // Check for role requirements
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles required, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Get all roles from user's direct roles and groups
    const userRoles = new Set<string>();
    
    // Check user's direct roles
    if (user.roles && Array.isArray(user.roles)) {
      user.roles.forEach((role: any) => {
        if (role.name) {
          userRoles.add(role.name);
        }
      });
    }
    
    // Check roles from groups (user in a group has all roles in the group)
    if (user.groups && Array.isArray(user.groups)) {
      user.groups.forEach((group: any) => {
        if (group.roles && Array.isArray(group.roles)) {
          group.roles.forEach((role: any) => {
            if (role.name) {
              userRoles.add(role.name);
            }
          });
        }
      });
    }

    // Check if user has any of the required roles
    const hasRole = requiredRoles.some((role) =>
      userRoles.has(role),
    );
    
    return hasRole;
  }
}
