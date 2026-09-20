import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { adminUsers, adminSessions } from '../../db/schema/index.js';
import { FormError } from '../catalog/validation.js';
/** Shared Argon2id parameters. Admin and customer hashing must stay aligned. */
export const argon2idOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;
export const token = () => randomBytes(32).toString('hex');
export const hashToken = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export function tokenMatches(raw: unknown, hash: string) {
  return (
    typeof raw === 'string' &&
    /^[a-f0-9]{64}$/.test(raw) &&
    timingSafeEqual(
      Buffer.from(hashToken(raw), 'hex'),
      Buffer.from(hash, 'hex'),
    )
  );
}
export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new FormError('email', 'Email tidak valid.');
  return email;
}
export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128)
    throw new FormError('password', 'Gunakan kata sandi 12–128 karakter.');
  return argon2.hash(password, argon2idOptions);
}
export function createAuth(db: Database['db']) {
  // A valid dummy hash gives unknown users the same password-verification work.
  const dummy = hashPassword(token());
  return {
    async login(
      email: string,
      password: string,
      ip: string,
      agent: string,
      oldToken?: string,
    ) {
      const [user] = await db
        .select()
        .from(adminUsers)
        .where(eq(adminUsers.email, normalizeEmail(email)));
      const valid = await argon2.verify(
        user?.passwordHash ?? (await dummy),
        password,
      );
      if (!valid || !user || user.status !== 'active') return null;
      const sessionToken = token();
      const csrf = token();
      const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
      await db.transaction(async (tx) => {
        if (oldToken)
          await tx
            .delete(adminSessions)
            .where(eq(adminSessions.tokenHash, hashToken(oldToken)));
        await tx
          .delete(adminSessions)
          .where(lt(adminSessions.expiresAt, new Date()));
        await tx.insert(adminSessions).values({
          adminUserId: user.id,
          tokenHash: hashToken(sessionToken),
          csrfTokenHash: hashToken(csrf),
          ipAddress: ip,
          userAgent: agent.slice(0, 500),
          expiresAt,
        });
        await tx
          .update(adminUsers)
          .set({ lastLoginAt: new Date(), updatedAt: new Date() })
          .where(eq(adminUsers.id, user.id));
      });
      return { sessionToken, csrf, expiresAt };
    },
    async session(raw?: string) {
      if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
      const [row] = await db
        .select({
          session: adminSessions,
          user: { id: adminUsers.id, name: adminUsers.name },
        })
        .from(adminSessions)
        .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.adminUserId))
        .where(
          and(
            eq(adminSessions.tokenHash, hashToken(raw)),
            gt(adminSessions.expiresAt, new Date()),
            eq(adminUsers.status, 'active'),
          ),
        );
      if (!row) return null;
      if (Date.now() - row.session.lastSeenAt.getTime() > 60000)
        await db
          .update(adminSessions)
          .set({ lastSeenAt: new Date() })
          .where(eq(adminSessions.id, row.session.id));
      return row;
    },
    async logout(raw: string) {
      await db
        .delete(adminSessions)
        .where(eq(adminSessions.tokenHash, hashToken(raw)));
    },
  };
}
