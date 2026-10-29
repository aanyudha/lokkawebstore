import { commercialDatabase } from './commercial-database.js';
import {
  adminUsers,
  directCosts,
  products,
  productVariants,
  vendors,
} from '../../src/db/schema/index.js';
import { createAccounting } from '../../src/modules/finance/accounting.js';
import { createLedger } from '../../src/modules/finance/ledger.js';
import { createSalesService } from '../../src/modules/sales/service.js';
import { hashPassword } from '../../src/modules/auth/service.js';

// Synthetic accounting example, inserted only into a fresh migrated database.
export async function accountingFixture() {
  const fixture = await commercialDatabase();
  const db = fixture.database.db;
  try {
    const [vendor] = await db
      .insert(vendors)
      .values({ slug: 'lokka', name: 'LOKKA', status: 'active' })
      .returning();
    const [admin] = await db
      .insert(adminUsers)
      .values({
        email: 'accounting@example.test',
        name: 'Accounting admin',
        passwordHash: await hashPassword('temporary-accounting-password'),
        status: 'active',
      })
      .returning();
    const [product] = await db
      .insert(products)
      .values({
        vendorId: vendor!.id,
        name: 'Accounting fixture',
        slug: 'accounting-fixture',
        status: 'active',
      })
      .returning();
    const [variant] = await db
      .insert(productVariants)
      .values({
        productId: product!.id,
        sku: 'ACC-M',
        name: 'M',
        price: 795000n,
        weightGrams: 200,
        stockQuantity: 100,
        status: 'active',
      })
      .returning();
    const [cost] = await db
      .insert(directCosts)
      .values({
        productId: product!.id,
        name: 'Direct material',
        category: 'DIRECT_MATERIAL',
        amountRupiah: 300000n,
      })
      .returning();
    return {
      ...fixture,
      db,
      admin: admin!,
      product: product!,
      variant: variant!,
      cost: cost!,
      accounting: createAccounting(db),
      ledger: createLedger(db),
      salesService: createSalesService(db),
      async sell(source: 'POS' | 'WEBSTORE' = 'POS', quantity = 1) {
        return createSalesService(db).completeSale({
          source,
          cashierId: admin!.id,
          items: [{ variantId: variant!.id, quantity }],
          cashTendered: 1000000n * BigInt(quantity),
        });
      },
      async expense(
        amountRupiah = '50000',
        occurredAt = new Date().toISOString().slice(0, 16),
      ) {
        return createLedger(db).recordManual(
          {
            direction: 'EXPENSE',
            category: 'PACKAGING',
            amountRupiah,
            occurredAt,
            notes: 'Actual packaging expense',
          },
          admin!.id,
        );
      },
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}
