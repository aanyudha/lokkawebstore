import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { eq, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { adminUsers, posSessions } from '../../db/schema/index.js';

const POS_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LAST_SEEN_REFRESH_MS = 60 * 1000;
const argon2idOptions = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 1,
} as const;

export interface PosIdentity {
  id: string;
  name: string;
  email: string;
}

export interface PosSessionResult {
  sessionToken: string;
  csrf: string;
  expiresAt: Date;
}

const token = () => randomBytes(32).toString('hex');
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

export function createPosAuth(db: Database['db']) {
  const dummy = argon2.hash(token(), argon2idOptions);

  async function login(
    email: string,
    password: string,
    ipAddress: string,
    userAgent: string,
    previousToken?: string,
  ): Promise<PosSessionResult | null> {
    const [user] = await db
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.email, email.toLowerCase().trim()))
      .limit(1);
    const valid = await argon2.verify(
      user?.passwordHash ?? (await dummy),
      password,
    );
    if (!valid || !user || user.status !== 'active') return null;

    const sessionToken = token();
    const csrfToken = token();
    const expiresAt = new Date(Date.now() + POS_SESSION_TTL_MS);

    await db.transaction(async (tx) => {
      if (previousToken)
        await tx
          .delete(posSessions)
          .where(eq(posSessions.tokenHash, hashToken(previousToken)));
      await tx.delete(posSessions).where(lt(posSessions.expiresAt, new Date()));
      await tx.insert(posSessions).values({
        adminUserId: user.id,
        tokenHash: hashToken(sessionToken),
        csrfTokenHash: hashToken(csrfToken),
        ipAddress,
        userAgent: userAgent.slice(0, 500),
        expiresAt,
      });
      await tx
        .update(adminUsers)
        .set({ lastLoginAt: new Date(), updatedAt: new Date() })
        .where(eq(adminUsers.id, user.id));
    });

    return { sessionToken, csrf: csrfToken, expiresAt };
  }

  async function session(
    rawToken?: string,
  ): Promise<{ user: PosIdentity } | null> {
    if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) return null;
    const [row] = await db
      .select({
        session: posSessions,
        user: adminUsers,
      })
      .from(posSessions)
      .innerJoin(adminUsers, eq(adminUsers.id, posSessions.adminUserId))
      .where(eq(posSessions.tokenHash, hashToken(rawToken)))
      .limit(1);
    if (!row) return null;
    if (row.session.expiresAt < new Date()) return null;
    if (row.user.status !== 'active') return null;

    const elapsed = Date.now() - row.session.lastSeenAt.getTime();
    if (elapsed > LAST_SEEN_REFRESH_MS) {
      await db
        .update(posSessions)
        .set({ lastSeenAt: new Date() })
        .where(eq(posSessions.id, row.session.id));
    }

    return {
      user: {
        id: row.user.id,
        name: row.user.name,
        email: row.user.email,
      },
    };
  }

  async function logout(rawToken?: string): Promise<void> {
    if (!rawToken || !/^[0-9a-f]{64}$/i.test(rawToken)) return;
    await db
      .delete(posSessions)
      .where(eq(posSessions.tokenHash, hashToken(rawToken)));
  }

  return { login, session, logout };
}
