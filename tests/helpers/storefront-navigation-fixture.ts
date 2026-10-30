import { accountingFixture } from './accounting-fixture.js';
import { createCatalog } from '../../src/modules/catalog/service.js';
import { LocalCatalogImageStorage } from '../../src/modules/catalog/storage.js';
import { createCustomerAuth } from '../../src/modules/customer/service.js';

export async function storefrontNavigationFixture() {
  const f = await accountingFixture();
  const catalog = createCatalog(
    f.db,
    new LocalCatalogImageStorage('storage/tests/navigation'),
  );
  try {
    const ready = await catalog.saveCategory({
      name: 'Ready to Wear',
      slug: 'ready-to-wear',
      status: 'active',
      sortOrder: '10',
    });
    const first = await catalog.saveCategory({
      name: 'First category',
      slug: 'first-category',
      status: 'active',
      sortOrder: '0',
    });
    const hidden = await catalog.saveCategory({
      name: 'Hidden category',
      slug: 'hidden-category',
      status: 'hidden',
      sortOrder: '0',
    });
    const child = await catalog.saveCategory({
      name: 'Child category',
      slug: 'child-category',
      status: 'active',
      sortOrder: '0',
      parentId: ready.id,
    });
    for (const category of [ready, first, hidden, child]) {
      await catalog.saveCategoryTranslation(category.id, 'en', {
        name: category.name,
        slug: category.slug,
      });
      await catalog.saveCategoryTranslation(category.id, 'id', {
        name:
          category.id === ready.id
            ? 'Busana Siap Pakai'
            : `ID ${category.name}`,
        slug: category.id === ready.id ? 'siap-pakai' : `id-${category.slug}`,
      });
    }
    await catalog.saveProduct(
      {
        name: f.product.name,
        slug: f.product.slug,
        status: 'active',
        categoryId: ready.id,
      },
      f.product.id,
    );
    for (const locale of ['en', 'id'])
      await catalog.saveProductTranslation(f.product.id, locale, {
        name: f.product.name,
        slug: f.product.slug,
      });
    const auth = createCustomerAuth(f.db);
    const customer = await auth.register(
      {
        name: 'Diego',
        email: 'diego@example.test',
        password: 'temporary-customer-password',
      },
      null,
      null,
    );
    return {
      ...f,
      catalog,
      ready,
      first,
      hidden,
      child,
      auth,
      customer: { ...customer, customer: customer.customer! },
    };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}
