# LOKKA Marketplace Platform
## Arsitektur Teknis dan Spesifikasi Implementasi

**Versi:** 1.0  
**Tanggal:** 7 September 2026  
**Status:** Baseline arsitektur yang disetujui  
**Target awal:** Single-vendor LOKKA dengan fondasi multi-vendor sejak hari pertama

---

## 1. Ringkasan Eksekutif

LOKKA akan dibangun ulang sebagai platform commerce modern berbasis **Fastify 5 + TypeScript + PostgreSQL** dengan pola **modular monolith**. Storefront publik, admin panel, REST API, autentikasi, commerce engine, payment integration, dan shipping integration berada dalam satu aplikasi yang modular, satu repository, dan satu deployment utama pada tahap awal.

Platform dirancang agar LOKKA dapat mulai sebagai penjual utama, lalu berkembang menjadi marketplace yang menerima vendor lain tanpa harus mengganti arsitektur inti. Setiap produk selalu memiliki `vendor_id`. Customer dapat melihat identitas vendor, masuk ke storefront vendor, memfilter produk berdasarkan vendor, dan memilih produk dari vendor yang diinginkan.

Cart dapat berisi produk dari beberapa vendor. Pada checkout, sistem mengelompokkan item berdasarkan vendor/origin, menghitung ongkir per kelompok, membuat fulfillment terpisah, tetapi tetap dapat menyediakan satu pengalaman checkout bagi customer.

Pembayaran awal menggunakan **DOKU** melalui abstraction layer `PaymentService`. Pengiriman awal menggunakan **Biteship** melalui `ShippingService`. Arsitektur provider-agnostic memastikan LOKKA dapat menambah atau mengganti provider di masa depan tanpa mengubah core order logic.

## 2. Tujuan Produk dan Arsitektur

Tujuan utama platform:

- Menjual produk LOKKA secara langsung dengan proses beli, bayar, dan kirim yang terintegrasi.
- Menyediakan storefront yang cepat, SEO-friendly, dan mudah dipakai pada perangkat mobile.
- Menyediakan admin panel yang sesuai alur operasional LOKKA.
- Menyediakan fondasi multi-vendor tanpa menanggung kompleksitas marketplace penuh pada fase pertama.
- Memungkinkan vendor lain bergabung kemudian dan memiliki katalog, stok, order, fulfillment, dan laporan sendiri.
- Menjaga payment dan shipping tetap terpisah dari domain logic melalui abstraction layer.
- Memulai dari satu VPS secara efisien, lalu dapat di-scale secara bertahap.

### Prinsip arsitektur

1. **Modular monolith first.** Satu aplikasi, tetapi domain dipisahkan per module.
2. **Server-rendered storefront first.** HTML lengkap dikirim dari server untuk SEO, performa, dan kesederhanaan.
3. **API-first boundaries.** Interaksi bisnis penting tetap memiliki service/API boundary yang jelas.
4. **Provider-agnostic integrations.** DOKU dan Biteship adalah adapter, bukan pusat business logic.
5. **Multi-vendor ready from day one.** Produk, cart grouping, fulfillment, dan data model menyimpan dimensi vendor sejak awal.
6. **Security by default.** Secret hanya di server, webhook diverifikasi, database tidak diekspos ke publik.
7. **Scale by extraction, not rewrite.** Komponen dipisahkan ke server/service lain hanya ketika beban nyata memerlukannya.

## 3. Technology Stack

| Layer | Pilihan Awal | Peran |
|---|---|---|
| Operating System | Ubuntu Server 24.04 LTS | Host production |
| Reverse Proxy | Nginx | TLS termination, proxy, static delivery |
| Runtime | Node.js 24 LTS | Runtime aplikasi |
| Backend Framework | Fastify 5 | HTTP server, routing, plugins, hooks |
| Language | TypeScript | Type safety dan maintainability |
| Database | PostgreSQL | Transactional source of truth |
| Cache / Queue | Redis | Cache, rate-limit state, locks, background jobs ringan |
| Frontend Build | Vite | Bundling CSS/TypeScript dan asset pipeline |
| Storefront UI | Server-rendered HTML + CSS + TypeScript ringan | SEO dan performa |
| Optional Interactivity | HTMX atau Alpine.js jika diperlukan | Interaksi tanpa SPA besar |
| Payment | DOKU | Payment gateway utama |
| Shipping | Biteship | Rates, shipment, tracking |
| Object Storage | S3-compatible storage | Foto produk dan media |
| CDN / Edge | Cloudflare | DNS, caching, WAF, edge protection |

## 4. Arsitektur Tingkat Tinggi

```text
                         INTERNET
                             |
                       CLOUDFLARE
                             |
                           NGINX
                             |
                 +---------------------+
                 |       FASTIFY       |
                 |                     |
                 | Storefront          |
                 | Admin Panel         |
                 | REST API            |
                 | Authentication      |
                 | Commerce Engine     |
                 +----------+----------+
                            |
                +-----------+-----------+
                |           |           |
           PostgreSQL     Redis      Object Storage
                |
        +-------+----------------+
        |                        |
      DOKU                   Biteship
    Payment                  Shipping
```

Pada fase awal seluruh komponen utama dapat berjalan pada satu VPS, kecuali layanan eksternal seperti DOKU, Biteship, Cloudflare, dan object storage. PostgreSQL dan Redis hanya dapat diakses dari private/internal interface.

## 5. Model Multi-Vendor dan Pilihan Vendor oleh Customer

Multi-vendor bukan fitur tempelan. Data model harus menganggap setiap produk dimiliki oleh satu vendor sejak awal.

### 5.1 Perilaku storefront

Customer dapat:

- Melihat nama dan identitas vendor pada halaman produk.
- Membuka storefront vendor, misalnya `/vendor/batik-sekar-solo`.
- Memfilter hasil pencarian/kategori berdasarkan vendor.
- Membandingkan produk sejenis dari vendor berbeda.
- Menambahkan produk dari satu atau beberapa vendor ke cart.
- Melihat subtotal dan ongkir yang dikelompokkan per vendor saat checkout.

Jika produk yang sama atau sejenis tersedia dari beberapa vendor, customer memilih listing/vendor yang ingin dibeli. LOKKA tidak memindahkan customer ke vendor lain secara otomatis.

### 5.2 Data vendor minimum

```text
vendors
- id
- slug
- name
- legal_name
- status
- logo_url
- description
- origin_address_id
- support_email
- support_phone
- created_at
- updated_at
```

Pada fase pertama hanya ada vendor internal:

```text
id: 1
slug: lokka
name: LOKKA
status: active
```

Semua produk LOKKA memiliki `vendor_id = 1`.

### 5.3 Vendor onboarding masa depan

Ketika marketplace dibuka, vendor baru dapat memiliki:

- Akun dan role vendor.
- Profil toko/vendor.
- Alamat origin pengiriman.
- Katalog dan varian produk.
- Inventory sendiri.
- Order items dan fulfillment sendiri.
- Laporan penjualan sendiri.
- Balance, commission, settlement, dan payout pada fase lanjutan.

## 6. Cart, Checkout, Order, dan Fulfillment Multi-Vendor

### 6.1 Cart

Satu cart boleh berisi banyak vendor.

```text
Cart
+-- Vendor: LOKKA
|   +-- Kemeja Batik A x1
|   +-- Selendang B x2
|
+-- Vendor: Batik Sekar Solo
    +-- Kain Tulis C x1
```

### 6.2 Checkout grouping

Sebelum pembayaran, checkout engine membentuk `fulfillment_group` berdasarkan vendor dan origin address.

```text
Checkout
+-- Fulfillment Group #1
|   +-- vendor: LOKKA
|   +-- origin: Bandung
|   +-- shipping option: JNE REG
|
+-- Fulfillment Group #2
    +-- vendor: Batik Sekar Solo
    +-- origin: Solo
    +-- shipping option: J&T EZ
```

Ongkir dihitung per fulfillment group. Total customer adalah:

```text
grand_total = item_subtotal
            - discount_total
            + shipping_total
            + tax_total_if_applicable
```

### 6.3 Order model

Satu checkout customer menghasilkan satu parent order untuk pengalaman customer, tetapi item dan fulfillment tetap terpisah per vendor.

```text
orders
  +-- order_items
  |     +-- vendor_id
  |
  +-- fulfillment_groups
        +-- vendor_id
        +-- shipment_id
```

Ini memungkinkan satu nomor checkout/customer order, tetapi setiap vendor hanya melihat bagian order yang menjadi tanggung jawabnya.

### 6.4 Status order

Status customer-level yang disarankan:

- `PENDING_PAYMENT`
- `PAID`
- `PROCESSING`
- `PARTIALLY_SHIPPED`
- `SHIPPED`
- `COMPLETED`
- `CANCELLED`
- `REFUNDED`

Status fulfillment per vendor:

- `PENDING`
- `ACCEPTED`
- `PACKING`
- `READY_TO_SHIP`
- `SHIPPED`
- `DELIVERED`
- `CANCELLED`
- `RETURNED`

## 7. Core Domain Modules

Struktur modular yang direkomendasikan:

```text
lokka/
+-- src/
|   +-- modules/
|   |   +-- auth/
|   |   +-- users/
|   |   +-- vendors/
|   |   +-- products/
|   |   +-- categories/
|   |   +-- inventory/
|   |   +-- cart/
|   |   +-- checkout/
|   |   +-- orders/
|   |   +-- fulfillments/
|   |   +-- payments/
|   |   +-- shipping/
|   |   +-- coupons/
|   |   +-- reviews/
|   |   +-- wishlist/
|   |   +-- content/
|   |   +-- reports/
|   |   +-- admin/
|   +-- integrations/
|   |   +-- doku/
|   |   +-- biteship/
|   |   +-- email/
|   |   +-- storage/
|   +-- web/
|   |   +-- storefront/
|   |   +-- admin/
|   +-- shared/
|   +-- server.ts
+-- public/
+-- migrations/
+-- tests/
+-- package.json
```

Setiap module idealnya memiliki route/controller, service/use-case, repository/data access, schema validation, dan test sendiri.

## 8. Database Core

Tabel minimum yang direkomendasikan:

| Domain | Tabel Utama |
|---|---|
| Identity | `users`, `roles`, `user_roles`, `sessions`, `addresses` |
| Vendor | `vendors`, `vendor_users`, `vendor_addresses` |
| Catalog | `products`, `product_variants`, `product_images`, `categories`, `product_categories` |
| Inventory | `inventory_items`, `inventory_movements`, `stock_reservations` |
| Cart | `carts`, `cart_items` |
| Checkout | `checkout_sessions`, `checkout_shipping_choices` |
| Order | `orders`, `order_items`, `order_status_history` |
| Fulfillment | `fulfillment_groups`, `shipments`, `shipment_events` |
| Payment | `payments`, `payment_attempts`, `payment_events`, `refunds` |
| Promotion | `coupons`, `coupon_rules`, `coupon_redemptions` |
| Marketplace Future | `commissions`, `vendor_balances`, `settlements`, `payouts` |
| Content | `pages`, `articles`, `banners`, `media` |
| Audit | `audit_logs`, `webhook_events` |

### Aturan penting database

- Money disimpan sebagai integer dalam unit terkecil yang disepakati, bukan floating point.
- `order_items` menyimpan snapshot nama produk, SKU, harga, vendor, dan atribut saat transaksi.
- Harga order tidak dihitung ulang dari tabel product setelah pembayaran.
- Stock reservation dibuat ketika checkout/payment sedang diproses dan memiliki expiry.
- Webhook event harus idempotent agar callback yang sama tidak memproses order dua kali.
- Soft delete hanya digunakan jika benar-benar diperlukan; transaksi historis tidak boleh hilang.

## 9. Payment Architecture - DOKU

Core application tidak memanggil DOKU secara langsung dari domain order. Gunakan interface:

```text
PaymentService
+-- DokuPaymentProvider
+-- FutureMidtransProvider
+-- FutureXenditProvider
```

Contoh capability:

```text
createPayment(order)
getPaymentStatus(paymentId)
cancelPayment(paymentId)
refundPayment(paymentId, amount)
handleWebhook(payload, headers)
```

### Payment flow

```text
Customer checkout
      |
      v
Fastify creates Order + Payment
      |
      v
DOKU payment session/request
      |
      v
Customer pays
      |
      v
DOKU webhook -> Fastify
      |
      v
Verify signature + idempotency
      |
      v
Payment = PAID
Order = PAID
```

Status pembayaran tidak boleh dipercaya hanya dari redirect browser. Webhook server-to-server yang sudah diverifikasi menjadi sumber utama konfirmasi pembayaran.

### Payment tables

`payments` minimal menyimpan:

- `id`
- `order_id`
- `provider`
- `provider_reference`
- `method`
- `amount`
- `currency`
- `status`
- `expires_at`
- `paid_at`
- `created_at`
- `updated_at`

## 10. Shipping Architecture - Biteship

Gunakan abstraction:

```text
ShippingService
+-- BiteshipShippingProvider
+-- FutureRajaOngkirProvider
```

Capability minimum:

```text
searchDestination(query)
getRates(origin, destination, items)
createShipment(fulfillment)
getTracking(shipment)
cancelShipment(shipment)
handleWebhook(payload, headers)
```

### Prinsip fulfillment

Shipment sebaiknya dibuat setelah order dibayar dan barang siap diproses, bukan otomatis pada detik yang sama setelah payment success.

Alur:

```text
PAID
  -> PROCESSING
  -> PACKING
  -> READY_TO_SHIP
  -> createShipment()
  -> SHIPPED
  -> DELIVERED
```

Untuk multi-vendor, setiap fulfillment group memiliki origin dan shipment sendiri.

## 11. Storefront dan Routing

Routing publik yang direkomendasikan:

```text
/
/batik
/pria
/wanita
/aksesoris
/kategori/:slug
/cari
/produk/:slug
/vendor/:vendorSlug
/vendor/:vendorSlug/produk
/cart
/checkout
/order/:orderNumber
/account
/account/orders
/account/orders/:orderNumber
/account/addresses
/wishlist
/tentang
/artikel
/artikel/:slug
```

Halaman produk harus menampilkan vendor secara jelas dan menyediakan link ke storefront vendor.

## 12. Admin dan Vendor Panel

### 12.1 LOKKA admin

```text
Dashboard
Products
Categories
Inventory
Orders
Fulfillments
Customers
Vendors
Promotions
Payments
Shipping
Content
Reports
Settings
Audit Logs
```

LOKKA admin dapat melihat seluruh marketplace.

### 12.2 Vendor panel masa depan

Vendor hanya dapat melihat resource miliknya sendiri:

```text
Vendor Dashboard
My Products
My Inventory
My Orders
My Fulfillments
My Sales Reports
My Store Profile
Settlement / Payout
```

Authorization harus selalu dilakukan di server berdasarkan `vendor_id` dan role, bukan hanya menyembunyikan menu di frontend.

## 13. API Baseline

Contoh endpoint internal/public:

```text
GET    /api/v1/products
GET    /api/v1/products/:slug
GET    /api/v1/vendors
GET    /api/v1/vendors/:slug

GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/:id
DELETE /api/v1/cart/items/:id

POST   /api/v1/checkout/shipping-rates
POST   /api/v1/checkout

GET    /api/v1/orders
GET    /api/v1/orders/:id

POST   /api/v1/payments
GET    /api/v1/payments/:id
POST   /api/v1/webhooks/doku

POST   /api/v1/shipments
GET    /api/v1/shipments/:id/tracking
POST   /api/v1/webhooks/biteship
```

API admin/vendor dipisahkan secara authorization dan dapat diberi namespace sendiri jika diperlukan.

## 14. Authentication dan Authorization

Role awal:

- `customer`
- `admin`
- `staff`
- `vendor_owner`
- `vendor_staff`

Rekomendasi:

- Session menggunakan secure, HTTP-only cookie untuk web.
- Password di-hash dengan algorithm modern yang sesuai library production.
- CSRF protection untuk operasi berbasis cookie.
- Rate limiting untuk login, OTP, password reset, dan endpoint sensitif.
- MFA dapat ditambahkan untuk admin dan vendor.
- Session revocation dan device/session list tersedia untuk akun privileged.

## 15. Security Baseline

Production baseline:

- Hanya port 22, 80, dan 443 yang dibuka sesuai kebutuhan.
- PostgreSQL 5432 tidak diekspos ke internet.
- Redis 6379 tidak diekspos ke internet.
- SSH menggunakan key authentication; password login dinonaktifkan bila memungkinkan.
- UFW dan Fail2ban diaktifkan.
- TLS/HTTPS wajib.
- Secret disimpan di environment/secret manager, tidak masuk repository.
- API key provider tidak pernah dikirim ke browser kecuali key yang memang bersifat public/client key.
- Webhook DOKU/Biteship diverifikasi dan diproses idempotent.
- Semua input divalidasi dengan JSON Schema/type-safe schema.
- Query database menggunakan parameterization/ORM query builder yang aman.
- Upload media divalidasi ukuran, MIME type, dan extension; tidak dieksekusi dari upload directory.
- Audit log untuk perubahan harga, stok, order, refund, settlement, dan role.
- Backup database terenkripsi dan memiliki salinan off-site.

## 16. SEO, Content, dan Performance

Storefront utama menggunakan server-rendered HTML. Setiap halaman produk/kategori/vendor/artikel harus dapat dirender lengkap tanpa bergantung pada JavaScript client untuk content utama.

Baseline SEO:

- Unique `<title>` dan meta description.
- Canonical URL.
- OpenGraph metadata.
- Schema.org `Product`, `Offer`, `BreadcrumbList`, `Organization`, dan `Article` sesuai tipe halaman.
- XML sitemap tersegmentasi jika data membesar.
- robots.txt.
- Clean slug dan redirect ketika slug berubah.
- Vendor storefront memiliki canonical dan metadata sendiri.
- Product availability dan price pada structured data mengikuti data server terkini.

Baseline performance:

- Image optimization dan responsive image sizes.
- CDN caching untuk asset/media.
- Brotli/gzip melalui edge/proxy.
- Database index untuk slug, vendor, category, order status, timestamps, dan foreign keys yang sering dicari.
- Redis hanya untuk data yang aman di-cache; PostgreSQL tetap source of truth.

## 17. Deployment pada Satu VPS

Baseline deployment:

```text
Ubuntu 24.04 LTS
+-- Nginx
+-- Fastify application
+-- PostgreSQL
+-- Redis
+-- backup jobs
+-- log rotation
```

Network exposure:

```text
22/tcp   SSH     restricted
80/tcp   HTTP    redirect to HTTPS
443/tcp  HTTPS   public
5432/tcp PostgreSQL private only
6379/tcp Redis      private only
```

Disarankan menggunakan systemd atau Docker Compose. Pilih satu pola deployment dan konsisten; jangan menggabungkan banyak orchestrator pada fase awal.

## 18. Observability dan Operations

Minimum operational visibility:

- Structured application logs dengan request ID.
- Error logging tanpa membocorkan secret atau data payment sensitif.
- Health endpoint internal.
- Uptime monitoring.
- Disk, RAM, CPU, database connection, dan storage monitoring.
- Alert untuk webhook failures, payment mismatch, shipment failure, dan backup failure.
- Daily database backup dan periodic restore test.
- Audit trail untuk tindakan admin/vendor yang material.

## 19. Roadmap Implementasi

### Fase 1 - Commerce Core

- Vendor entity dengan vendor default LOKKA.
- Product, category, variant, media.
- Inventory dan stock reservation.
- Cart.
- Checkout.
- Order dan order item snapshot.
- Customer account.
- Admin dasar.

### Fase 2 - Payment

- DOKU sandbox dan production adapter.
- Payment creation.
- Webhook verification.
- Idempotency.
- Payment status history.
- Cancellation/refund foundation.

### Fase 3 - Shipping

- Biteship destination lookup.
- Rate calculation.
- Shipping choice per fulfillment group.
- Shipment creation.
- AWB/resi dan tracking.
- Webhook shipment event.

### Fase 4 - Customer Experience dan SEO

- Wishlist.
- Review.
- Coupon/promo.
- Email/notification.
- Invoice.
- SEO structured data.
- Content/articles.
- Performance optimization.

### Fase 5 - Multi-Vendor Activation

- Vendor onboarding.
- Vendor login dan role.
- Vendor storefront.
- Vendor catalog/inventory management.
- Vendor-specific order/fulfillment access.
- Marketplace moderation.
- Commission rules.

### Fase 6 - Settlement dan Payout

- Vendor balance ledger.
- Commission calculation.
- Settlement period.
- Refund/return impact terhadap balance.
- Payout integration.
- Reconciliation dan finance reports.

## 20. MVP Acceptance Criteria

MVP dianggap siap ketika:

- Customer dapat menemukan produk melalui kategori/search dan melihat vendor produk.
- Customer dapat menambahkan produk ke cart.
- Cart dapat mengelompokkan item berdasarkan vendor.
- Checkout dapat menghitung shipping per vendor/origin.
- Customer dapat menyelesaikan satu checkout dan melakukan pembayaran melalui DOKU.
- Webhook payment terverifikasi mengubah status order secara idempotent.
- Admin dapat memproses order dan fulfillment.
- Shipment dapat dibuat melalui Biteship dan resi/tracking tersimpan.
- Customer dapat melihat status order dan shipment.
- Stok berkurang dengan rule yang konsisten dan race condition dicegah.
- Halaman product/category/vendor dapat diindeks dengan HTML server-rendered.
- Backup, logging, dan basic security controls aktif di production.

## 21. Keputusan Arsitektur yang Dikunci untuk Baseline

| Keputusan | Baseline |
|---|---|
| Arsitektur aplikasi | Modular monolith |
| Backend | Fastify 5 + TypeScript |
| Database | PostgreSQL |
| Cache/queue | Redis |
| Storefront | Server-rendered HTML, bukan SPA React sebagai default |
| Frontend build | Vite |
| Payment utama | DOKU melalui `PaymentService` abstraction |
| Shipping utama | Biteship melalui `ShippingService` abstraction |
| Multi-vendor | Data model aktif sejak awal; onboarding vendor diaktifkan kemudian |
| Customer vendor choice | Customer dapat melihat, memilih, dan berbelanja berdasarkan vendor |
| Multi-vendor cart | Diizinkan; checkout dipecah ke fulfillment group per vendor/origin |
| Hosting awal | Satu VPS Ubuntu 24.04 LTS |
| Scaling | Extract component ketika beban nyata memerlukan |

## 22. Catatan Implementasi Penting

- Jangan membuat microservice sebelum ada kebutuhan operasional yang jelas.
- Jangan mengikat order logic langsung ke SDK DOKU atau Biteship.
- Jangan menganggap satu order selalu sama dengan satu shipment.
- Jangan menganggap satu cart hanya memiliki satu vendor.
- Jangan menggunakan harga product terkini untuk merekonstruksi transaksi historis.
- Jangan mempercayai payment success dari browser redirect tanpa webhook verification.
- Jangan mengekspos database, Redis, secret, atau private provider key ke internet/browser.
- Jangan memberi vendor akses hanya berdasarkan filter frontend; enforce ownership di backend.

---

**Dokumen ini menjadi baseline teknis LOKKA v1.0.** Perubahan besar pada payment provider, shipping provider, order model, vendor model, atau deployment model sebaiknya dicatat sebagai Architecture Decision Record (ADR) agar evolusi platform tetap terkontrol.
