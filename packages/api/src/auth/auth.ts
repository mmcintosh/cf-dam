/**
 * Better Auth configuration.
 *
 * Better Auth owns identity: credentials, sessions, verification values and the second factor.
 * Authorization (roles and permissions) is ours, in `user_roles` and `role_permissions`.
 *
 * Several settings below are fixes Infowall learned in production; each is explained where it is
 * set. Build a fresh instance per request (`createAuth`): the Workers isolate model shares module
 * state between unrelated requests, and the instance closes over request-scoped options.
 */
import { betterAuth } from 'better-auth'
import { twoFactor } from 'better-auth/plugins'
import type { DamBindings } from '../env'
import { nowIso } from '../lib/time'
import { hashPassword, verifyPassword } from './password'
import { assignRole } from './roles'

export const AUTH_BASE_PATH = '/api/auth'

export interface CreateAuthOptions {
  /**
   * Request-scoped permission to create a user. Without it, account creation is refused unless an
   * admin has opened registration. Set by the setup and admin user-creation routes only.
   */
  allowSignUp?: boolean
  /** Role given to a user created by this instance. Defaults to `viewer`. */
  role?: string
}

/** Better Auth's `baseURL`: the pinned origin if configured, else the request's own origin. */
export function authOrigin(env: Pick<DamBindings, 'BETTER_AUTH_URL'>, request: Request): string {
  return env.BETTER_AUTH_URL ?? new URL(request.url).origin
}

async function registrationOpen(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'auth.registration_open'")
    .first<{ value: string }>()
  return row?.value === 'true'
}

export function createAuth(env: DamBindings, request: Request, options: CreateAuthOptions = {}) {
  const secret = env.BETTER_AUTH_SECRET
  if (!secret) {
    throw new Error(
      'BETTER_AUTH_SECRET is not set. Locally, add it to .dev.vars; deployed, run `wrangler secret put BETTER_AUTH_SECRET`.',
    )
  }
  const origin = authOrigin(env, request)
  const db = env.DB

  return betterAuth({
    appName: 'cf-dam',
    secret,
    baseURL: origin,
    basePath: AUTH_BASE_PATH,
    trustedOrigins: [origin],
    // Better Auth recognises a D1 binding and uses its own D1 dialect. Sessions stay in D1:
    // a KV session cache would let a sign-out take up to a minute to reach other locations.
    database: db,

    user: {
      modelName: 'users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      additionalFields: {
        isActive: { type: 'boolean', fieldName: 'is_active', input: false, defaultValue: true },
        lastLoginAt: { type: 'date', fieldName: 'last_login_at', input: false, required: false },
      },
    },
    account: {
      modelName: 'account',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    session: {
      modelName: 'session',
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'verification',
      // Single-use values (2FA challenges, reset links) are consumed in a D1 transaction.
      // Infowall #1328: the KV path is not atomic and broke every single-use consume.
      storeInDatabase: true,
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(password, hash),
      },
    },

    // Our KV limiter meters /api/auth/* (see rate-limit.ts). Better Auth's own limiter turns
    // itself on when NODE_ENV is "production", which a Worker var can set, so it is off explicitly.
    rateLimit: { enabled: false },

    advanced: {
      cookiePrefix: 'cfdam',
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // Better Auth validates the schema by introspecting sqlite_master, which D1 refuses
      // (SQLITE_AUTH), failing every sign-in. Infowall #1328.
      database: { validateSchema: false },
    },

    plugins: [
      twoFactor({
        issuer: 'cf-dam',
        twoFactorTable: 'two_factor',
        // Plugin fields are mapped here, not in `user.fields`: Better Auth spreads plugin fields
        // verbatim, so a mapping in `user.fields` would be ignored.
        schema: {
          user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
          twoFactor: {
            fields: {
              userId: 'user_id',
              backupCodes: 'backup_codes',
              failedVerificationCount: 'failed_verification_count',
              lockedUntil: 'locked_until',
            },
          },
        },
        // A six-digit code is a million guesses; per-IP limits don't stop a distributed guesser,
        // so the account locks after repeated failures.
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
        // 0, not omitted: omitted means a 30-day "trust this device" cookie any client can request
        // by posting trustDevice: true. Infowall closed the same hole.
        trustDeviceMaxAge: 0,
      }),
    ],

    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!options.allowSignUp && !(await registrationOpen(db))) return false
            return { data: user }
          },
          after: async (user) => {
            await assignRole(db, user.id, options.role ?? 'viewer')
          },
        },
      },
      session: {
        create: {
          // Better Auth checks no account flag of ours; refuse sessions for deactivated users.
          before: async (session) => {
            const row = await db
              .prepare('SELECT is_active FROM users WHERE id = ?')
              .bind(session.userId)
              .first<{ is_active: number }>()
            return row?.is_active === 0 ? false : undefined
          },
          after: async (session) => {
            await db
              .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
              .bind(nowIso(), session.userId)
              .run()
          },
        },
      },
    },
  })
}

export type DamAuth = ReturnType<typeof createAuth>
