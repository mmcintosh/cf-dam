import { nowIso } from '../lib/time'

export interface Grants {
  roles: string[]
  permissions: Set<string>
}

/** Give a user a role by name. A no-op if they already hold it or the role does not exist. */
export async function assignRole(db: D1Database, userId: string, roleName: string): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO user_roles (user_id, role_id, created_at)
       SELECT ?, id, ? FROM roles WHERE name = ?`,
    )
    .bind(userId, nowIso(), roleName)
    .run()
}

/** Replace a user's roles. Unknown role names are ignored. */
export async function setUserRoles(db: D1Database, userId: string, roleNames: string[]): Promise<void> {
  const now = nowIso()
  await db.batch([
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(userId),
    ...roleNames.map((name) =>
      db
        .prepare(
          `INSERT OR IGNORE INTO user_roles (user_id, role_id, created_at)
           SELECT ?, id, ? FROM roles WHERE name = ?`,
        )
        .bind(userId, now, name),
    ),
  ])
}

/** A user's role names and the union of their roles' permissions, in one query. */
export async function loadGrants(db: D1Database, userId: string): Promise<Grants> {
  const { results } = await db
    .prepare(
      `SELECT r.name AS role, rp.permission_id AS permission
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE ur.user_id = ?`,
    )
    .bind(userId)
    .all<{ role: string; permission: string | null }>()
  const roles = new Set<string>()
  const permissions = new Set<string>()
  for (const row of results) {
    roles.add(row.role)
    if (row.permission) permissions.add(row.permission)
  }
  return { roles: [...roles].sort(), permissions }
}

export interface RoleRow {
  name: string
  label: string
  description: string
  permissions: string[]
}

export async function listRoles(db: D1Database): Promise<RoleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.name, r.label, r.description, group_concat(rp.permission_id) AS permissions
       FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id ORDER BY r.is_system DESC, r.name`,
    )
    .all<{ name: string; label: string; description: string; permissions: string | null }>()
  return results.map((r) => ({ ...r, permissions: r.permissions ? r.permissions.split(',').sort() : [] }))
}

/** True when `userId` is the only active admin. Used to stop the last admin locking everyone out. */
export async function isLastActiveAdmin(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS admins,
              SUM(CASE WHEN u.id = ? THEN 1 ELSE 0 END) AS is_this_user
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'admin' AND u.is_active = 1`,
    )
    .bind(userId)
    .first<{ admins: number; is_this_user: number | null }>()
  return row !== null && row.admins === 1 && row.is_this_user === 1
}
