// Role constants organized by resource and action
export enum RoleResource {
  ROLE = 'role',
  USER = 'user',
  USER_ROLE = 'user_role',
  GROUP = 'group',
  BOOK = 'book',
  BOOK_LENDING = 'book_lending',
}

export enum RoleAction {
  CREATE = 'create',
  READ = 'read',
  UPDATE = 'update',
  DELETE = 'delete',
  APPROVE = 'approve',
  DECLINE = 'decline',
  REQUEST = 'request',
  BLOCK = 'block',
  RESET_PASSWORD = 'reset_password',
}

// Role name format: resource:action
export const Roles = {
  // Role Management
  ROLE_READ: 'role:read',

  // User Management
  USER_CREATE: 'user:create',
  USER_READ: 'user:read',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_BLOCK: 'user:block',
  USER_RESET_PASSWORD: 'user:reset_password',

  // User Role Management
  USER_ROLE_CREATE: 'user_role:create',
  USER_ROLE_READ: 'user_role:read',
  USER_ROLE_UPDATE: 'user_role:update',
  USER_ROLE_DELETE: 'user_role:delete',

  // Group Management
  GROUP_CREATE: 'group:create',
  GROUP_READ: 'group:read',
  GROUP_UPDATE: 'group:update',
  GROUP_DELETE: 'group:delete',

  // Book Management
  BOOK_READ: 'book:read',
  BOOK_CREATE: 'book:create',
  BOOK_UPDATE: 'book:update',
  BOOK_DELETE: 'book:delete',
  BOOK_APPROVE: 'book:approve',
  BOOK_DECLINE: 'book:decline',

  // Book Lending Management
  BOOK_LENDING_REQUEST: 'book_lending:request',
  BOOK_LENDING_READ: 'book_lending:read',
  BOOK_LENDING_APPROVE: 'book_lending:approve',
  BOOK_LENDING_DECLINE: 'book_lending:decline',
  BOOK_LENDING_DELETE: 'book_lending:delete',
} as const;

export type RoleName = typeof Roles[keyof typeof Roles];

// Role definitions with descriptions
export const ROLE_DEFINITIONS = [
  // Role Management
  {
    name: Roles.ROLE_READ,
    resource: RoleResource.ROLE,
    action: RoleAction.READ,
    description: 'View the role catalogue',
  },

  // User Management
  {
    name: Roles.USER_CREATE,
    resource: RoleResource.USER,
    action: RoleAction.CREATE,
    description: 'Create user accounts',
  },
  {
    name: Roles.USER_READ,
    resource: RoleResource.USER,
    action: RoleAction.READ,
    description: 'View users',
  },
  {
    name: Roles.USER_UPDATE,
    resource: RoleResource.USER,
    action: RoleAction.UPDATE,
    description: 'Update existing users',
  },
  {
    name: Roles.USER_DELETE,
    resource: RoleResource.USER,
    action: RoleAction.DELETE,
    description: 'Delete users',
  },
  {
    name: Roles.USER_BLOCK,
    resource: RoleResource.USER,
    action: RoleAction.BLOCK,
    description: 'Block/unblock users',
  },
  {
    name: Roles.USER_RESET_PASSWORD,
    resource: RoleResource.USER,
    action: RoleAction.RESET_PASSWORD,
    description: 'Reset user passwords',
  },

  // User Role Management
  {
    name: Roles.USER_ROLE_CREATE,
    resource: RoleResource.USER_ROLE,
    action: RoleAction.CREATE,
    description: 'Assign roles to users',
  },
  {
    name: Roles.USER_ROLE_READ,
    resource: RoleResource.USER_ROLE,
    action: RoleAction.READ,
    description: 'View user roles',
  },
  {
    name: Roles.USER_ROLE_UPDATE,
    resource: RoleResource.USER_ROLE,
    action: RoleAction.UPDATE,
    description: 'Update user roles',
  },
  {
    name: Roles.USER_ROLE_DELETE,
    resource: RoleResource.USER_ROLE,
    action: RoleAction.DELETE,
    description: 'Remove roles from users',
  },

  // Group Management
  {
    name: Roles.GROUP_CREATE,
    resource: RoleResource.GROUP,
    action: RoleAction.CREATE,
    description: 'Create new groups',
  },
  {
    name: Roles.GROUP_READ,
    resource: RoleResource.GROUP,
    action: RoleAction.READ,
    description: 'View groups',
  },
  {
    name: Roles.GROUP_UPDATE,
    resource: RoleResource.GROUP,
    action: RoleAction.UPDATE,
    description: 'Update existing groups',
  },
  {
    name: Roles.GROUP_DELETE,
    resource: RoleResource.GROUP,
    action: RoleAction.DELETE,
    description: 'Delete groups',
  },

  // Book Management
  {
    name: Roles.BOOK_READ,
    resource: RoleResource.BOOK,
    action: RoleAction.READ,
    description: 'View books',
  },
  {
    name: Roles.BOOK_CREATE,
    resource: RoleResource.BOOK,
    action: RoleAction.CREATE,
    description: 'Create new books',
  },
  {
    name: Roles.BOOK_UPDATE,
    resource: RoleResource.BOOK,
    action: RoleAction.UPDATE,
    description: 'Update existing books',
  },
  {
    name: Roles.BOOK_DELETE,
    resource: RoleResource.BOOK,
    action: RoleAction.DELETE,
    description: 'Delete books',
  },
  {
    name: Roles.BOOK_APPROVE,
    resource: RoleResource.BOOK,
    action: RoleAction.APPROVE,
    description: 'Approve books',
  },
  {
    name: Roles.BOOK_DECLINE,
    resource: RoleResource.BOOK,
    action: RoleAction.DECLINE,
    description: 'Decline books',
  },

  // Book Lending Management
  {
    name: Roles.BOOK_LENDING_REQUEST,
    resource: RoleResource.BOOK_LENDING,
    action: RoleAction.REQUEST,
    description: 'Request book lending',
  },
  {
    name: Roles.BOOK_LENDING_READ,
    resource: RoleResource.BOOK_LENDING,
    action: RoleAction.READ,
    description: 'View book lending records',
  },
  {
    name: Roles.BOOK_LENDING_APPROVE,
    resource: RoleResource.BOOK_LENDING,
    action: RoleAction.APPROVE,
    description: 'Approve book lending requests',
  },
  {
    name: Roles.BOOK_LENDING_DECLINE,
    resource: RoleResource.BOOK_LENDING,
    action: RoleAction.DECLINE,
    description: 'Decline book lending requests',
  },
  {
    name: Roles.BOOK_LENDING_DELETE,
    resource: RoleResource.BOOK_LENDING,
    action: RoleAction.DELETE,
    description: 'Delete book lending records',
  },
];

export const ALL_ROLE_NAMES: string[] = ROLE_DEFINITIONS.map(definition => definition.name);

export interface DefaultGroupDefinition {
  name: string;
  description: string;
  roles: string[];
}

/**
 * The groups seeded on first run, with role sets that make the application
 * usable immediately. Seeding only ever *adds* missing roles, so changes an
 * administrator makes afterwards are preserved.
 *
 * Note that browsing the approved catalogue needs no role at all — `book:read`
 * is the elevated permission that reveals unapproved, draft and deprecated
 * titles, which is why the User group does not get it.
 */
export const DEFAULT_GROUP_DEFINITIONS: DefaultGroupDefinition[] = [
  {
    name: 'Super Admin',
    description:
      'Super administrator with every role. Only one user can be in this group. Assigned to the first user during project setup.',
    roles: ALL_ROLE_NAMES,
  },
  {
    name: 'Admin',
    description: 'Full operational access. Cannot permanently delete user accounts.',
    roles: [
      Roles.ROLE_READ,
      Roles.USER_CREATE,
      Roles.USER_READ,
      Roles.USER_UPDATE,
      Roles.USER_BLOCK,
      Roles.USER_RESET_PASSWORD,
      Roles.USER_ROLE_CREATE,
      Roles.USER_ROLE_READ,
      Roles.USER_ROLE_UPDATE,
      Roles.USER_ROLE_DELETE,
      Roles.GROUP_CREATE,
      Roles.GROUP_READ,
      Roles.GROUP_UPDATE,
      Roles.GROUP_DELETE,
      Roles.BOOK_READ,
      Roles.BOOK_CREATE,
      Roles.BOOK_UPDATE,
      Roles.BOOK_DELETE,
      Roles.BOOK_APPROVE,
      Roles.BOOK_DECLINE,
      Roles.BOOK_LENDING_REQUEST,
      Roles.BOOK_LENDING_READ,
      Roles.BOOK_LENDING_APPROVE,
      Roles.BOOK_LENDING_DECLINE,
      Roles.BOOK_LENDING_DELETE,
    ],
  },
  {
    name: 'Librarian',
    description: 'Manages the catalogue and the lending desk. user:read is needed to look up borrowers.',
    roles: [
      Roles.USER_READ,
      Roles.BOOK_READ,
      Roles.BOOK_CREATE,
      Roles.BOOK_UPDATE,
      Roles.BOOK_APPROVE,
      Roles.BOOK_DECLINE,
      Roles.BOOK_LENDING_REQUEST,
      Roles.BOOK_LENDING_READ,
      Roles.BOOK_LENDING_APPROVE,
      Roles.BOOK_LENDING_DECLINE,
    ],
  },
  {
    name: 'User',
    description: 'Regular borrower. Can browse the approved catalogue and request loans.',
    roles: [Roles.BOOK_LENDING_REQUEST],
  },
];

export const SUPER_ADMIN_GROUP = 'Super Admin';
export const DEFAULT_MEMBER_GROUP = 'User';
