import { listInput, pagination, searchPattern } from '../catalog/listing.js';
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { fixedAssets, vendors, adminUsers } from '../../db/schema/index.js';
import {
  FormError,
  choice,
  id,
  integer,
  textField,
  type Form,
} from '../catalog/validation.js';
import { dateInput, rupiah } from './calculations.js';
type Connection =
  Database['db'] | Parameters<Parameters<Database['db']['transaction']>[0]>[0];
export function createFixedAssets(db: Connection) {
  async function owner() {
    const [row] = await db
      .select()
      .from(vendors)
      .where(eq(vendors.slug, 'lokka'));
    if (!row) throw new FormError('vendor', 'LOKKA vendor is not configured.');
    return row.id;
  }
  async function list() {
    return db
      .select()
      .from(fixedAssets)
      .where(eq(fixedAssets.vendorId, await owner()))
      .orderBy(asc(fixedAssets.assetName), asc(fixedAssets.id));
  }
  async function listPage(query: Record<string, unknown> = {}) {
    const input = listInput(query);
    const vendorId = await owner();
    const pattern = searchPattern(input.q);
    const condition = and(
      eq(fixedAssets.vendorId, vendorId),
      input.q
        ? or(
            ilike(fixedAssets.assetName, pattern),
            ilike(fixedAssets.unit, pattern),
            ilike(fixedAssets.status, pattern),
          )
        : undefined,
    );
    const assets = await db
      .select()
      .from(fixedAssets)
      .where(condition)
      .orderBy(asc(fixedAssets.assetName), asc(fixedAssets.id))
      .limit(input.limit)
      .offset(input.offset);
    const [total] = await db
      .select({ value: count() })
      .from(fixedAssets)
      .where(condition);
    const [active] = await db
      .select({
        value: sql<string>`coalesce(sum(${fixedAssets.quantity}::numeric * ${fixedAssets.acquisitionCostPerUnit}),0)::text`,
      })
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.vendorId, vendorId),
          eq(fixedAssets.status, 'ACTIVE'),
        ),
      );
    return {
      assets,
      activeTotal: BigInt(active!.value),
      listing: pagination(total!.value, input, '/admin/finance/fixed-assets'),
    };
  }
  async function get(assetId: string) {
    const [row] = await db
      .select()
      .from(fixedAssets)
      .where(
        and(
          eq(fixedAssets.id, id(assetId)),
          eq(fixedAssets.vendorId, await owner()),
        ),
      );
    if (!row) throw new FormError('id', 'Fixed asset not found.');
    return row;
  }
  async function save(form: Form, adminId: string, assetId?: string) {
    const [admin] = await db
      .select({ id: adminUsers.id })
      .from(adminUsers)
      .where(
        and(eq(adminUsers.id, id(adminId)), eq(adminUsers.status, 'active')),
      );
    if (!admin)
      throw new FormError('admin', 'An active owner admin is required.');
    const vendorId = await owner();
    if (assetId) await get(assetId);
    const values = {
      assetName: textField(form, 'assetName', 200, true),
      quantity: integer(form, 'quantity', 1),
      unit: textField(form, 'unit', 30, true),
      acquisitionCostPerUnit: rupiah(form, 'acquisitionCostPerUnit'),
      acquisitionDate: dateInput(form, 'acquisitionDate', true),
      notes: textField(form, 'notes', 2000) || null,
      status: choice(form, 'status', ['ACTIVE', 'DISPOSED']),
      updatedAt: new Date(),
    };
    const [row] = assetId
      ? await db
          .update(fixedAssets)
          .set(values)
          .where(
            and(
              eq(fixedAssets.id, id(assetId)),
              eq(fixedAssets.vendorId, vendorId),
            ),
          )
          .returning()
      : await db
          .insert(fixedAssets)
          .values({ ...values, vendorId, createdBy: adminId })
          .returning();
    if (!row) throw new FormError('id', 'Fixed asset not found.');
    return row;
  }
  return { list, listPage, get, save };
}
