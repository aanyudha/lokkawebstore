import { desc, sql } from 'drizzle-orm';
import { paymentAttempts } from '../../db/schema/index.js';

type PaymentStatus = typeof paymentAttempts.$inferSelect.status;

export const effectivePaymentOrder = [
  sql`case ${paymentAttempts.status} when 'PAID' then 0 when 'REVIEW' then 1 else 2 end`,
  desc(paymentAttempts.sequence),
] as const;

export function effectivePaymentStatus(now: Date) {
  return sql<PaymentStatus>`case
    when ${paymentAttempts.status} = 'PENDING' and ${paymentAttempts.expiresAt} <= ${now.toISOString()}::timestamptz then 'EXPIRED'
    else ${paymentAttempts.status}
  end`;
}
