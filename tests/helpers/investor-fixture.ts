import { commercialDatabase } from './commercial-database.js';
import { adminUsers } from '../../src/db/schema/index.js';
import { seedDevelopmentData } from '../../src/db/seed-dev-data.js';
import { hashPassword } from '../../src/modules/auth/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
export function syntheticOwnerPayload() {
  return {
    sourceIdentity: 'synthetic-investor-fixture',
    workbookHash: 'a'.repeat(64),
    products: Array.from({ length: 34 }, (_, index) => ({
      sourceRow: index + 2,
      name: `Synthetic inventory ${index + 1}`,
      stock: index < 28 ? '2' : null,
      unit: 'pcs',
      price: '500',
      material: index === 0 ? '150' : '100',
      labor: index === 0 ? '0' : '50',
      hpp: '150',
    })),
    assets: Array.from({ length: 20 }, (_, index) => ({
      sourceRow: index + 2,
      name: `Synthetic asset ${index + 1}`,
      quantity: '2',
      unit: 'pcs',
      cost: '1000',
    })),
  };
}
export async function investorFixture() {
  const fixture = await commercialDatabase();
  try {
    await seedDevelopmentData(fixture.database);
    const [admin] = await fixture.database.db
      .insert(adminUsers)
      .values({
        email: 'investor@example.test',
        name: 'Synthetic investor admin',
        status: 'active',
        passwordHash: await hashPassword('temporary-investor-password'),
      })
      .returning();
    return {
      ...fixture,
      db: fixture.database.db,
      admin: admin!,
      payload: syntheticOwnerPayload(),
      storage: new LocalCatalogImageStorage('storage/tests/investor'),
    };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}
