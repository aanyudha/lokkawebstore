import 'dotenv/config';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { readEnv } from '../src/config/env.js';
import { createDatabase } from '../src/db/client.js';
import {
  adminUsers,
  vendors,
  products,
  productVariants,
  sales,
  saleItems,
  salePayments,
  inventoryMovements,
  financialTransactions,
  posSessions,
} from '../src/db/schema/index.js';
import { hashPassword, token } from '../src/modules/auth/service.js';
import type { FastifyInstance } from 'fastify';

const run = randomUUID();
const env = readEnv({
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  APP_URL: 'http://localhost:3000',
  CATALOG_STORAGE_ROOT: `storage/tests/${run}`,
});
const database = createDatabase(env.databaseUrl);

let app: FastifyInstance;
let userId = '';
let posCookie = '';
let posCsrf = '';
const password = token();
const productIds: string[] = [];
const variantIds: string[] = [];
const pid = (i: number) => productIds[i]!;
const vid = (i: number) => variantIds[i]!;

async function posLogin(pass = password) {
  const page = await app.inject('/pos/login');
  const loginCookie =
    page.cookies.find((c) => c.name === 'lokka_pos_login_csrf')?.value ?? '';
  return app.inject({
    method: 'POST',
    url: '/pos/login',
    cookies: { lokka_pos_login_csrf: loginCookie },
    payload: {
      csrf: loginCookie,
      email: `${run}@example.test`,
      password: pass,
    },
  });
}

async function adminLogin() {
  const page = await app.inject('/admin/login');
  const loginCookie =
    page.cookies.find((c) => c.name === 'lokka_login_csrf')?.value ?? '';
  return app.inject({
    method: 'POST',
    url: '/admin/login',
    cookies: { lokka_login_csrf: loginCookie },
    payload: {
      csrf: loginCookie,
      email: `${run}@example.test`,
      password,
    },
  });
}

beforeAll(async () => {
  await database.check();
  await database.db
    .insert(vendors)
    .values({ slug: 'lokka', name: 'LOKKA', status: 'active' })
    .onConflictDoNothing();
  const vendorRows = await database.db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.slug, 'lokka'))
    .limit(1);
  const vendorId = vendorRows[0]!.id;
  const [user] = await database.db
    .insert(adminUsers)
    .values({
      email: `${run}@example.test`,
      name: 'POS Test Admin',
      passwordHash: await hashPassword(password),
      status: 'active',
    })
    .returning({ id: adminUsers.id });
  userId = user!.id;

  for (let i = 0; i < 3; i++) {
    const [product] = await database.db
      .insert(products)
      .values({
        vendorId,
        name: `POS Test Product ${i + 1} [${run.slice(0, 8)}]`,
        slug: `pos-test-product-${i + 1}-${run}`,
        status: 'active',
      })
      .returning({ id: products.id });
    productIds.push(product!.id);
    const [variant] = await database.db
      .insert(productVariants)
      .values({
        productId: product!.id,
        sku: `PTV${i + 1}${run.slice(0, 8)}`,
        name: `Variant ${i + 1}`,
        price: BigInt(100000 * (i + 1)),
        weightGrams: 200,
        stockQuantity: 10,
        status: 'active',
      })
      .returning({ id: productVariants.id });
    variantIds.push(variant!.id);
  }

  app = await buildApp(env, {
    database: { db: database.db, check: database.check, close: database.close },
  });
  await app.ready();
}, 30000);

afterAll(async () => {
  for (const vid of variantIds) {
    await database.db
      .delete(inventoryMovements)
      .where(eq(inventoryMovements.variantId, vid));
  }
  for (const pid of productIds) {
    await database.db.delete(saleItems).where(eq(saleItems.productId, pid));
    await database.db.delete(products).where(eq(products.id, pid));
  }
  if (userId) {
    await database.db
      .delete(posSessions)
      .where(eq(posSessions.adminUserId, userId));
    await database.db.delete(adminUsers).where(eq(adminUsers.id, userId));
  }
  if (app) {
    await app.close();
  } else {
    await database.close();
  }
});

describe('POS Authentication', () => {
  it('redirects unauthenticated /pos to login', async () => {
    const res = await app.inject('/pos');
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/pos/login');
  });

  it('shows POS login page', async () => {
    const res = await app.inject('/pos/login');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('LOKKA');
    expect(res.body).toContain('Point of Sale');
    expect(res.body).toContain('Sign in to POS');
  });

  it('renders a non-empty CSRF token in the login form', async () => {
    const res = await app.inject('/pos/login');
    expect(res.statusCode).toBe(200);
    const csrfMatch = res.body.match(/name="csrf"\s+value="([a-f0-9]{64})"/);
    expect(csrfMatch).not.toBeNull();
    expect(csrfMatch![1]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid credentials', async () => {
    const res = await posLogin('wrongpassword');
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('Invalid email or password');
  });

  it('logs in with valid credentials and sets correct cookies', async () => {
    const res = await posLogin();
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/pos');
    const sessionCookie = res.cookies.find((c) => c.name === 'lokka_pos');
    const csrfCookie = res.cookies.find((c) => c.name === 'lokka_pos_csrf');
    expect(sessionCookie).toBeDefined();
    expect(csrfCookie).toBeDefined();
    expect(sessionCookie!.path).toBe('/pos');
    expect(csrfCookie!.path).toBe('/pos');
    posCookie = `lokka_pos=${sessionCookie!.value}; lokka_pos_csrf=${csrfCookie!.value}`;
    posCsrf = csrfCookie!.value;
  });

  it('does not grant POS access from admin cookie', async () => {
    const adminRes = await adminLogin();
    const adminSession = adminRes.cookies.find((c) => c.name === 'lokka_admin');
    if (adminSession) {
      const posRes = await app.inject({
        method: 'GET',
        url: '/pos',
        headers: { cookie: `lokka_admin=${adminSession.value}` },
      });
      expect(posRes.statusCode).toBe(303);
      expect(posRes.headers.location).toBe('/pos/login');
    }
  });

  it('logs out with CSRF', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pos/logout',
      headers: { cookie: posCookie },
      payload: { csrf: posCsrf },
    });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/pos/login');
  });
});

describe('POS Product Search', () => {
  let productSearchCookie = '';

  beforeAll(async () => {
    const res = await posLogin();
    const session = res.cookies.find((c) => c.name === 'lokka_pos');
    if (session) {
      productSearchCookie = `lokka_pos=${session.value}; lokka_pos_csrf=${res.cookies.find((c) => c.name === 'lokka_pos_csrf')?.value ?? ''}`;
    }
  });

  it('searches products via API', async () => {
    const searchTag = run.slice(0, 8);
    const res = await app.inject({
      method: 'GET',
      url: `/pos/api/products?q=${searchTag}`,
      headers: { cookie: productSearchCookie },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.products.length).toBe(3);
    expect(data.products[0].name).toContain('POS Test Product');
    expect(data.products[0].variants.length).toBeGreaterThanOrEqual(1);
  });

  it('returns all products on empty search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pos/api/products?q=',
      headers: { cookie: productSearchCookie },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.products.length).toBeGreaterThanOrEqual(3);
  });
});

describe('POS Sale Completion', () => {
  let saleCookie = '';
  let saleCsrf = '';

  beforeAll(async () => {
    const res = await posLogin();
    const session = res.cookies.find((c) => c.name === 'lokka_pos');
    const csrfC = res.cookies.find((c) => c.name === 'lokka_pos_csrf');
    if (session && csrfC) {
      saleCookie = `lokka_pos=${session.value}; lokka_pos_csrf=${csrfC.value}`;
      saleCsrf = csrfC.value;
    }
  });

  it('rejects sale with no items', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pos/api/sales',
      headers: { cookie: saleCookie },
      payload: { csrf: saleCsrf, items: [] },
    });
    expect(res.statusCode).toBe(422);
  });

  it('completes a single-item POS cash sale', async () => {
    const vRows = await database.db
      .select({ stock: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, vid(0)))
      .limit(1);
    const initialStock = vRows[0]!.stock;

    const res = await app.inject({
      method: 'POST',
      url: '/pos/api/sales',
      headers: { cookie: saleCookie },
      payload: {
        csrf: saleCsrf,
        items: [{ variantId: vid(0), quantity: 2 }],
        cashTendered: '300000',
      },
    });
    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.body);
    expect(result.transactionNumber).toMatch(/^POS-\d{8}-\d{6}$/);
    expect(result.source).toBe('POS');
    expect(result.total).toBe('200000');
    expect(result.cashReceived).toBe('300000');
    expect(result.changeAmount).toBe('100000');
    expect(result.items.length).toBe(1);
    expect(result.items[0].quantity).toBe(2);

    // Verify stock decremented
    const afterRows = await database.db
      .select({ stock: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, vid(0)))
      .limit(1);
    expect(afterRows[0]!.stock).toBe(initialStock - 2);

    // Verify sale record
    const saleRows = await database.db
      .select()
      .from(sales)
      .where(eq(sales.transactionNumber, result.transactionNumber))
      .limit(1);
    expect(saleRows.length).toBe(1);
    const sale = saleRows[0]!;
    expect(sale.source).toBe('POS');
    expect(sale.status).toBe('completed');
    expect(sale.cashierId).toBe(userId);

    // Verify sale item snapshot
    const itemRows = await database.db
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, sale.id))
      .limit(1);
    expect(itemRows.length).toBe(1);
    expect(itemRows[0]!.quantity).toBe(2);

    // Verify payment
    const payRows = await database.db
      .select()
      .from(salePayments)
      .where(eq(salePayments.saleId, sale.id))
      .limit(1);
    expect(payRows.length).toBe(1);
    expect(payRows[0]!.method).toBe('CASH');
    expect(payRows[0]!.status).toBe('COMPLETED');

    // Verify inventory movement
    const movRows = await database.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.referenceId, sale.id))
      .limit(1);
    expect(movRows.length).toBe(1);
    expect(movRows[0]!.type).toBe('SALE');
    expect(movRows[0]!.quantityChange).toBe(-2);

    // Verify financial transaction
    const finRows = await database.db
      .select()
      .from(financialTransactions)
      .where(eq(financialTransactions.saleId, sale.id))
      .limit(1);
    expect(finRows.length).toBeGreaterThanOrEqual(1);
    expect(finRows[0]!.source).toBe('POS');
  });

  it('rejects out-of-stock sale', async () => {
    const vRows = await database.db
      .select({ stock: productVariants.stockQuantity })
      .from(productVariants)
      .where(eq(productVariants.id, vid(0)))
      .limit(1);
    const stock = vRows[0]!.stock;
    const res = await app.inject({
      method: 'POST',
      url: '/pos/api/sales',
      headers: { cookie: saleCookie },
      payload: {
        csrf: saleCsrf,
        items: [{ variantId: vid(0), quantity: stock + 100 }],
        cashTendered: '9999999',
      },
    });
    expect(res.statusCode).toBe(422);
    const result = JSON.parse(res.body);
    expect(result.error).toContain('Insufficient stock');
  });

  it('rejects sale with inactive variant', async () => {
    const [inactive] = await database.db
      .insert(productVariants)
      .values({
        productId: pid(0),
        sku: `INACTIVE-${run.slice(0, 8)}`,
        name: 'Inactive Variant',
        price: 50000n,
        weightGrams: 100,
        stockQuantity: 5,
        status: 'inactive',
      })
      .returning({ id: productVariants.id });
    expect(inactive).toBeDefined();
    const res = await app.inject({
      method: 'POST',
      url: '/pos/api/sales',
      headers: { cookie: saleCookie },
      payload: {
        csrf: saleCsrf,
        items: [{ variantId: inactive!.id, quantity: 1 }],
        cashTendered: '50000',
      },
    });
    expect(res.statusCode).toBe(422);
    const result = JSON.parse(res.body);
    expect(result.error).toContain('not active');
    await database.db
      .delete(productVariants)
      .where(eq(productVariants.id, inactive!.id));
  });

  it('computes correct change for exact cash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/pos/api/sales',
      headers: { cookie: saleCookie },
      payload: {
        csrf: saleCsrf,
        items: [{ variantId: vid(1), quantity: 1 }],
        cashTendered: '200000',
      },
    });
    expect(res.statusCode).toBe(200);
    const result = JSON.parse(res.body);
    expect(result.changeAmount).toBe('0');
  });
});

describe('POS Transaction Numbering', () => {
  let txnCookie = '';
  let txnCsrf = '';

  beforeAll(async () => {
    const res = await posLogin();
    const session = res.cookies.find((c) => c.name === 'lokka_pos');
    const csrfC = res.cookies.find((c) => c.name === 'lokka_pos_csrf');
    if (session && csrfC) {
      txnCookie = `lokka_pos=${session.value}; lokka_pos_csrf=${csrfC.value}`;
      txnCsrf = csrfC.value;
    }
  });

  it('generates unique sequential transaction numbers', async () => {
    const numbers = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/pos/api/sales',
        headers: { cookie: txnCookie },
        payload: {
          csrf: txnCsrf,
          items: [{ variantId: vid(2), quantity: 1 }],
          cashTendered: '500000',
        },
      });
      expect(res.statusCode).toBe(200);
      const result = JSON.parse(res.body);
      expect(result.transactionNumber).toMatch(/^POS-\d{8}-\d{6}$/);
      numbers.add(result.transactionNumber);
    }
    expect(numbers.size).toBe(3);
  });
});

describe('POS History and Detail', () => {
  let histCookie = '';

  beforeAll(async () => {
    const res = await posLogin();
    const session = res.cookies.find((c) => c.name === 'lokka_pos');
    const csrfC = res.cookies.find((c) => c.name === 'lokka_pos_csrf');
    if (session && csrfC) {
      histCookie = `lokka_pos=${session.value}; lokka_pos_csrf=${csrfC.value}`;
    }
  });

  it('shows history page', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pos/history',
      headers: { cookie: histCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Sales History');
  });

  it('shows sale detail page', async () => {
    const saleRows = await database.db
      .select({ id: sales.id })
      .from(sales)
      .where(eq(sales.source, 'POS'))
      .limit(1);
    expect(saleRows.length).toBeGreaterThan(0);
    const res = await app.inject({
      method: 'GET',
      url: `/pos/sales/${saleRows[0]!.id}`,
      headers: { cookie: histCookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('LOKKA');
  });

  it('returns 404 for nonexistent sale', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/pos/sales/00000000-0000-0000-0000-000000000000',
      headers: { cookie: histCookie },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POS Security', () => {
  it('rejects POS API without session', async () => {
    const res = await app.inject('/pos/api/products?q=');
    expect(res.statusCode).toBe(303);
  });

  it('rejects sale completion without CSRF', async () => {
    const loginRes = await posLogin();
    const session = loginRes.cookies.find((c) => c.name === 'lokka_pos');
    expect(session).toBeDefined();
    const res = await app.inject({
      method: 'POST',
      url: '/pos/api/sales',
      headers: { cookie: `lokka_pos=${session!.value}` },
      payload: {
        items: [{ variantId: vid(0), quantity: 1 }],
        cashTendered: '100000',
      },
    });
    expect(res.statusCode).toBe(403);
  });
});
