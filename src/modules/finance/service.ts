import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  vendors,
  overheadCosts,
  overheadPeriods,
  overheadItems,
  recoveryEntries,
  directCosts,
  pricingProfiles,
  products,
  productVariants,
} from '../../db/schema/index.js';
import type { Catalog } from '../catalog/service.js';
import {
  FormError,
  choice,
  id,
  integer,
  textField,
  type Form,
} from '../catalog/validation.js';
import {
  dateInput,
  defaultProfile,
  economics,
  month,
  percentage,
  periodTotals,
  recognizedAmount,
  recommend,
  rupiah,
} from './calculations.js';

export function createFinance(db: Database['db'], catalog: Catalog) {
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  // All finance mutations share one transaction lock: master snapshots, recovery and close cannot race.
  async function locked<T>(work: (tx: Tx, vendorId: string) => Promise<T>) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(724025)`);
      const [vendor] = await tx
        .select()
        .from(vendors)
        .where(eq(vendors.slug, 'lokka'));
      if (!vendor)
        throw new FormError('vendor', 'LOKKA vendor is not configured.');
      return work(tx, vendor.id);
    });
  }
  async function details(
    connection: Database['db'] | Tx,
    p: typeof overheadPeriods.$inferSelect,
  ) {
    const items = await connection
      .select()
      .from(overheadItems)
      .where(eq(overheadItems.periodId, p.id))
      .orderBy(asc(overheadItems.createdAt), asc(overheadItems.id));
    const entries = await connection
      .select()
      .from(recoveryEntries)
      .where(eq(recoveryEntries.periodId, p.id))
      .orderBy(asc(recoveryEntries.createdAt), asc(recoveryEntries.id));
    return {
      period: p,
      items,
      entries,
      ...periodTotals(
        p.openingCarryForwardRupiah,
        items,
        entries,
        p.forecastUnitsRemaining,
      ),
    };
  }
  async function openRow(tx: Tx, vendor: string, periodId: string) {
    const [p] = await tx
      .select()
      .from(overheadPeriods)
      .where(
        and(
          eq(overheadPeriods.id, id(periodId)),
          eq(overheadPeriods.vendorId, vendor),
        ),
      )
      .for('update');
    if (!p || p.status !== 'OPEN')
      throw new FormError('period', 'This period is not open.');
    return p;
  }
  async function dashboard(periodId?: string) {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
      );
      const [owner] = await tx
        .select()
        .from(vendors)
        .where(eq(vendors.slug, 'lokka'));
      if (!owner)
        throw new FormError('vendor', 'LOKKA vendor is not configured.');
      const vendor = owner.id;
      const costs = await tx
        .select()
        .from(overheadCosts)
        .where(eq(overheadCosts.vendorId, vendor))
        .orderBy(asc(overheadCosts.name));
      const periods = await tx
        .select()
        .from(overheadPeriods)
        .where(eq(overheadPeriods.vendorId, vendor))
        .orderBy(desc(overheadPeriods.periodMonth));
      const p = periodId
        ? periods.find((p) => p.id === id(periodId))
        : periods[0];
      if (periodId && !p) throw new FormError('period', 'Period not found.');
      return { costs, periods, current: p ? await details(tx, p) : null };
    });
  }
  return {
    dashboard,
    async saveOverhead(form: Form, costId?: string) {
      const startDate = dateInput(form, 'startDate')!;
      const endDate = dateInput(form, 'endDate', true);
      if (endDate && endDate < startDate)
        throw new FormError('endDate', 'End date must follow start date.');
      const values = {
        name: textField(form, 'name', 200, true),
        category: choice(form, 'category', [
          'INFRASTRUCTURE',
          'SOFTWARE',
          'FACILITY',
          'ADMINISTRATION',
          'MARKETING',
          'OTHER',
        ]),
        amountRupiah: rupiah(form, 'amountRupiah'),
        billingFrequency: choice(form, 'billingFrequency', [
          'MONTHLY',
          'ANNUAL',
          'ONE_TIME',
        ]),
        recognitionMethod: choice(form, 'recognitionMethod', [
          'SPREAD_MONTHLY',
          'CHARGE_IN_BILLING_PERIOD',
        ]),
        startDate,
        endDate,
        active: form.active === 'on',
        notes: textField(form, 'notes', 2000) || null,
        updatedAt: new Date(),
      };
      return locked(async (tx, vendorId) => {
        const [row] = costId
          ? await tx
              .update(overheadCosts)
              .set(values)
              .where(
                and(
                  eq(overheadCosts.id, id(costId)),
                  eq(overheadCosts.vendorId, vendorId),
                ),
              )
              .returning()
          : await tx
              .insert(overheadCosts)
              .values({ ...values, vendorId })
              .returning();
        if (!row) throw new FormError('id', 'Overhead not found.');
        return row;
      });
    },
    async openPeriod(form: Form) {
      const periodMonth = month(textField(form, 'periodMonth', 7, true));
      const forecastUnitsRemaining = integer(form, 'forecastUnitsRemaining', 1);
      return locked(async (tx, vendorId) => {
        const [previous] = await tx
          .select()
          .from(overheadPeriods)
          .where(eq(overheadPeriods.vendorId, vendorId))
          .orderBy(desc(overheadPeriods.periodMonth))
          .limit(1);
        if (
          previous &&
          (previous.status !== 'CLOSED' || previous.periodMonth >= periodMonth)
        )
          throw new FormError(
            'periodMonth',
            'Close the current period and choose a later month.',
          );
        const [p] = await tx
          .insert(overheadPeriods)
          .values({
            vendorId,
            periodMonth,
            forecastUnitsRemaining,
            previousPeriodId: previous?.id ?? null,
            openingCarryForwardRupiah: previous?.closingUnrecoveredRupiah ?? 0n,
          })
          .returning();
        const costs = await tx
          .select()
          .from(overheadCosts)
          .where(eq(overheadCosts.vendorId, vendorId));
        const snapshots = costs
          .map((c) => ({
            periodId: p!.id,
            overheadCostId: c.id,
            nameSnapshot: c.name,
            categorySnapshot: c.category,
            recognizedAmountRupiah: recognizedAmount(c, periodMonth),
            sourceType: 'RECURRING_COST' as const,
          }))
          .filter((i) => i.recognizedAmountRupiah > 0n);
        if (snapshots.length) await tx.insert(overheadItems).values(snapshots);
        return p!;
      });
    },
    async changePeriod(
      periodId: string,
      action: 'forecast' | 'adjustment' | 'recovery' | 'close',
      form: Form,
    ) {
      return locked(async (tx, vendorId) => {
        const p = await openRow(tx, vendorId, periodId);
        const totals = await details(tx, p);
        if (action === 'forecast') {
          await tx
            .update(overheadPeriods)
            .set({
              forecastUnitsRemaining: integer(
                form,
                'forecastUnitsRemaining',
                1,
              ),
              updatedAt: new Date(),
            })
            .where(eq(overheadPeriods.id, p.id));
        } else if (action === 'close') {
          if (
            form.confirm !== 'close' ||
            textField(form, 'expectedTarget', 40, true) !==
              totals.target.toString() ||
            textField(form, 'expectedRecovered', 40, true) !==
              totals.recovered.toString()
          )
            throw new FormError(
              'confirm',
              'Review the current totals and explicitly confirm closing.',
            );
          await tx
            .update(overheadPeriods)
            .set({
              status: 'CLOSED',
              closingUnrecoveredRupiah: totals.remaining,
              closedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(overheadPeriods.id, p.id));
        } else {
          const amount = rupiah(form, 'amountRupiah', true);
          const notes = textField(form, 'notes', 2000, true);
          if (amount === 0n)
            throw new FormError('amountRupiah', 'Adjustment must be nonzero.');
          if (action === 'recovery') {
            if (
              totals.recovered + amount < 0n ||
              totals.recovered + amount > totals.target
            )
              throw new FormError(
                'amountRupiah',
                'Recovery must stay between zero and the target. Use a negative entry to reverse recovery.',
              );
            await tx.insert(recoveryEntries).values({
              periodId: p.id,
              amountRupiah: amount,
              notes,
              reference: textField(form, 'reference', 200) || null,
            });
          } else {
            if (
              totals.target + amount < totals.recovered ||
              totals.target + amount < 0n
            )
              throw new FormError(
                'amountRupiah',
                'A target credit cannot reduce the target below recovery or zero.',
              );
            await tx.insert(overheadItems).values({
              periodId: p.id,
              nameSnapshot: notes,
              categorySnapshot: 'OTHER',
              recognizedAmountRupiah: amount,
              sourceType: 'MANUAL_ADJUSTMENT',
            });
          }
          await tx
            .update(overheadPeriods)
            .set({ updatedAt: new Date() })
            .where(eq(overheadPeriods.id, p.id));
        }
      });
    },
    async saveProductCost(productId: string, form: Form, costId?: string) {
      await catalog.product(productId);
      const values = {
        name: textField(form, 'name', 200, true),
        category: choice(form, 'category', [
          'DIRECT_MATERIAL',
          'DIRECT_LABOR',
          'PACKAGING',
          'OTHER',
        ]),
        amountRupiah: rupiah(form, 'amountRupiah'),
        notes: textField(form, 'notes', 2000) || null,
        sortOrder: integer(
          { ...form, sortOrder: form.sortOrder || '0' },
          'sortOrder',
        ),
        updatedAt: new Date(),
      };
      return db.transaction(async (tx) => {
        await tx
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .for('update');
        const [row] = costId
          ? await tx
              .update(directCosts)
              .set(values)
              .where(
                and(
                  eq(directCosts.id, id(costId)),
                  eq(directCosts.productId, productId),
                ),
              )
              .returning()
          : await tx
              .insert(directCosts)
              .values({ ...values, productId })
              .returning();
        if (!row) throw new FormError('id', 'Product cost not found.');
        return row;
      });
    },
    async deleteProductCost(productId: string, costId: string) {
      await catalog.product(productId);
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .for('update');
        const rows = await tx
          .delete(directCosts)
          .where(
            and(
              eq(directCosts.id, id(costId)),
              eq(directCosts.productId, productId),
            ),
          )
          .returning();
        if (!rows.length) throw new FormError('id', 'Product cost not found.');
      });
    },
    async saveProfile(productId: string, form: Form) {
      await catalog.product(productId);
      const values = {
        method: choice(form, 'method', ['TARGET_MARGIN', 'MARKUP']),
        profitBps: percentage(form, 'profitPercent'),
        taxBps: percentage(form, 'taxPercent'),
        roundingRupiah: rupiah(form, 'roundingRupiah'),
        updatedAt: new Date(),
      };
      recommend(1n, values);
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(products)
          .where(eq(products.id, productId))
          .for('update');
        await tx
          .insert(pricingProfiles)
          .values({ ...values, productId })
          .onConflictDoUpdate({
            target: pricingProfiles.productId,
            set: values,
          });
      });
    },
    async analysis(productId: string) {
      const product = await catalog.product(productId);
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`,
        );
        const costs = await tx
          .select()
          .from(directCosts)
          .where(eq(directCosts.productId, productId))
          .orderBy(asc(directCosts.sortOrder), asc(directCosts.id));
        const [saved] = await tx
          .select()
          .from(pricingProfiles)
          .where(eq(pricingProfiles.productId, productId));
        const profile = saved ?? defaultProfile;
        const [p] = await tx
          .select()
          .from(overheadPeriods)
          .where(
            and(
              eq(overheadPeriods.vendorId, product.vendorId),
              eq(overheadPeriods.status, 'OPEN'),
            ),
          );
        const overhead = p ? await details(tx, p) : null;
        const direct = costs.reduce((sum, c) => sum + c.amountRupiah, 0n);
        const full = direct + (overhead?.perUnit ?? 0n);
        const variants = await tx
          .select()
          .from(productVariants)
          .where(eq(productVariants.productId, productId))
          .orderBy(asc(productVariants.sortOrder), asc(productVariants.sku));
        return {
          product,
          costs,
          profile,
          overhead,
          direct,
          full,
          recommended: overhead ? recommend(full, profile) : null,
          variants: variants.map((v) => ({
            ...v,
            ...economics(v.price, full, profile.taxBps),
          })),
        };
      });
    },
  };
}
export type Finance = ReturnType<typeof createFinance>;
