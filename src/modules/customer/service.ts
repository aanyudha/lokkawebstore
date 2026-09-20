import argon2 from 'argon2';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { customers, customerSessions } from '../../db/schema/index.js';
import { argon2idOptions, hashToken, token } from '../auth/service.js';
import { FormError } from '../catalog/validation.js';
import { normalizeCustomerEmail } from './validation.js';

export const CUSTOMER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const CUSTOMER_MIN_PASSWORD = 10;
export const CUSTOMER_MAX_PASSWORD = 128;
const LAST_SEEN_REFRESH_MS = 60 * 1000;

type CustomerTransaction = Parameters<
  Parameters<Database['db']['transaction']>[0]
>[0];

export type CustomerRecord = typeof customers.$inferSelect;
export type CustomerSessionRecord = typeof customerSessions.$inferSelect;

export interface CustomerSessionBundle {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
}

export interface CustomerIdentity {
  customer: CustomerRecord;
  session: CustomerSessionRecord;
}

export async function hashCustomerPassword(password: string): Promise<string> {
  if (
    password.length < CUSTOMER_MIN_PASSWORD ||
    password.length > CUSTOMER_MAX_PASSWORD
  )
    throw new FormError('password', 'account.error.passwordLength');
  return argon2.hash(password, argon2idOptions);
}

function uniqueViolation(error: unknown): boolean {
  let current = error;
  for (let i = 0; i < 3 && current instanceof Error; i++) {
    if ('code' in current && current.code === '23505') return true;
    current = current.cause;
  }
  return false;
}

export function createCustomerAuth(db: Database['db']) {
  const dummy = hashCustomerPassword(token());

  async function createSession(
    tx: CustomerTransaction,
    customerId: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<CustomerSessionBundle> {
    const sessionToken = token();
    const csrfToken = token();
    const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_TTL_MS);
    await tx.insert(customerSessions).values({
      customerId,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      ipAddress,
      userAgent,
      expiresAt,
    });
    return { sessionToken, csrfToken, expiresAt };
  }

  return {
    async register(
      input: { name: string; email: string; password: string },
      ipAddress: string | null,
      userAgent: string | null,
    ) {
      const emailNormalized = normalizeCustomerEmail(input.email);
      const passwordHash = await hashCustomerPassword(input.password);
      try {
        return await db.transaction(async (tx) => {
          const [customer] = await tx
            .insert(customers)
            .values({
              email: input.email.trim(),
              emailNormalized,
              name: input.name.trim(),
              passwordHash,
            })
            .returning();
          const session = await createSession(
            tx,
            customer!.id,
            ipAddress,
            userAgent,
          );
          return { customer, ...session };
        });
      } catch (error) {
        if (uniqueViolation(error))
          throw new FormError('email', 'account.error.emailTaken');
        throw error;
      }
    },

    async login(
      email: string,
      password: string,
      ipAddress: string | null,
      userAgent: string | null,
      previousToken?: string | null,
    ) {
      const emailNormalized = normalizeCustomerEmail(email);
      const [customer] = await db
        .select()
        .from(customers)
        .where(eq(customers.emailNormalized, emailNormalized));
      const valid = await argon2.verify(
        customer?.passwordHash ?? (await dummy),
        password,
      );
      if (!valid || !customer || customer.status !== 'ACTIVE') return null;
      return db.transaction(async (tx) => {
        if (previousToken)
          await tx
            .delete(customerSessions)
            .where(eq(customerSessions.tokenHash, hashToken(previousToken)));
        await tx
          .delete(customerSessions)
          .where(lt(customerSessions.expiresAt, new Date()));
        const session = await createSession(
          tx,
          customer.id,
          ipAddress,
          userAgent,
        );
        await tx
          .update(customers)
          .set({ lastLoginAt: new Date(), updatedAt: new Date() })
          .where(eq(customers.id, customer.id));
        return { customer, ...session };
      });
    },

    async session(
      rawToken: string | undefined,
    ): Promise<CustomerIdentity | null> {
      if (!rawToken || !/^[a-f0-9]{64}$/.test(rawToken)) return null;
      const [row] = await db
        .select({ session: customerSessions, customer: customers })
        .from(customerSessions)
        .innerJoin(customers, eq(customers.id, customerSessions.customerId))
        .where(
          and(
            eq(customerSessions.tokenHash, hashToken(rawToken)),
            gt(customerSessions.expiresAt, new Date()),
            eq(customers.status, 'ACTIVE'),
          ),
        );
      if (!row) return null;
      if (Date.now() - row.session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS)
        await db
          .update(customerSessions)
          .set({ lastSeenAt: new Date() })
          .where(eq(customerSessions.id, row.session.id));
      return row;
    },

    async logout(rawToken: string | undefined): Promise<void> {
      if (!rawToken || !/^[a-f0-9]{64}$/.test(rawToken)) return;
      await db
        .delete(customerSessions)
        .where(eq(customerSessions.tokenHash, hashToken(rawToken)));
    },

    async updateName(customerId: string, name: string) {
      const [customer] = await db
        .update(customers)
        .set({ name: name.trim(), updatedAt: new Date() })
        .where(eq(customers.id, customerId))
        .returning();
      return customer;
    },

    async changePassword(
      identity: CustomerIdentity,
      currentPassword: string,
      newPassword: string,
      ipAddress: string | null,
      userAgent: string | null,
    ) {
      const valid = await argon2.verify(
        identity.customer.passwordHash,
        currentPassword,
      );
      if (!valid)
        throw new FormError('currentPassword', 'account.error.currentPassword');
      const passwordHash = await hashCustomerPassword(newPassword);
      const customerId = identity.customer.id;
      return db.transaction(async (tx) => {
        const [customer] = await tx
          .update(customers)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(customers.id, customerId))
          .returning();
        await tx
          .delete(customerSessions)
          .where(eq(customerSessions.customerId, customerId));
        const session = await createSession(
          tx,
          customerId,
          ipAddress,
          userAgent,
        );
        return { customer, ...session };
      });
    },
  };
}

export type CustomerAuth = ReturnType<typeof createCustomerAuth>;
