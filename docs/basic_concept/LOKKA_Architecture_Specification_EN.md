# LOKKA Marketplace Platform
## Technical Architecture and Implementation Specification

**Version:** 1.0  
**Date:** September 7, 2026  
**Status:** Approved architecture baseline  
**Initial target:** Single-vendor LOKKA with multi-vendor foundations from day one

---

## 1. Executive Summary

LOKKA will be rebuilt as a modern commerce platform based on **Fastify 5 + TypeScript + PostgreSQL** using a **modular monolith** architecture. The public storefront, admin panel, REST API, authentication, commerce engine, payment integration, and shipping integration will live in one modular application, one repository, and one primary deployment during the initial phase.

The platform is designed so LOKKA can start as the primary seller and later evolve into a marketplace that accepts external vendors without replacing the core architecture. Every product always has a `vendor_id`. Customers can see the vendor identity, open a vendor storefront, filter products by vendor, and choose products from the vendor they prefer.

A cart may contain products from multiple vendors. During checkout, the system groups items by vendor/origin, calculates shipping per group, and creates separate fulfillment groups while still providing a unified checkout experience to the customer.

The initial payment provider is **DOKU** behind a `PaymentService` abstraction. The initial shipping provider is **Biteship** behind a `ShippingService` abstraction. A provider-agnostic integration design allows LOKKA to add or replace providers later without rewriting core order logic.

## 2. Product and Architecture Goals

Primary platform goals:

- Sell LOKKA products directly with integrated purchase, payment, and shipping flows.
- Provide a fast, SEO-friendly, mobile-friendly storefront.
- Provide an admin panel aligned with LOKKA operations.
- Establish multi-vendor foundations without taking on full marketplace complexity in phase one.
- Allow external vendors to join later with their own catalog, stock, orders, fulfillment, and reporting.
- Keep payment and shipping isolated from domain logic through abstraction layers.
- Start efficiently on a single VPS and scale progressively.

### Architecture principles

1. **Modular monolith first.** One application, with domains separated into modules.
2. **Server-rendered storefront first.** Complete HTML is delivered from the server for SEO, performance, and simplicity.
3. **API-first boundaries.** Important business operations keep clear service/API boundaries.
4. **Provider-agnostic integrations.** DOKU and Biteship are adapters, not the center of business logic.
5. **Multi-vendor ready from day one.** Product, cart grouping, fulfillment, and the data model carry a vendor dimension from the beginning.
6. **Security by default.** Secrets stay server-side, webhooks are verified, and databases are not exposed publicly.
7. **Scale by extraction, not rewrite.** Components move to separate services or servers only when real load requires it.

## 3. Technology Stack

| Layer | Initial Choice | Role |
|---|---|---|
| Operating System | Ubuntu Server 24.04 LTS | Production host |
| Reverse Proxy | Nginx | TLS termination, proxying, static delivery |
| Runtime | Node.js 24 LTS | Application runtime |
| Backend Framework | Fastify 5 | HTTP server, routing, plugins, hooks |
| Language | TypeScript | Type safety and maintainability |
| Database | PostgreSQL | Transactional source of truth |
| Cache / Queue | Redis | Cache, rate-limit state, locks, lightweight jobs |
| Frontend Build | Vite | CSS/TypeScript bundling and asset pipeline |
| Storefront UI | Server-rendered HTML + CSS + lightweight TypeScript | SEO and performance |
| Optional Interactivity | HTMX or Alpine.js when needed | Interaction without a large SPA |
| Payment | DOKU | Primary payment gateway |
| Shipping | Biteship | Rates, shipment creation, tracking |
| Object Storage | S3-compatible storage | Product images and media |
| CDN / Edge | Cloudflare | DNS, caching, WAF, edge protection |

## 4. High-Level Architecture

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

During the initial phase, the main components can run on a single VPS, excluding external services such as DOKU, Biteship, Cloudflare, and object storage. PostgreSQL and Redis must only be reachable through private/internal interfaces.

## 5. Multi-Vendor Model and Customer Vendor Choice

Multi-vendor support is not an add-on. The data model must treat every product as belonging to a vendor from the beginning.

### 5.1 Storefront behavior

Customers can:

- See the vendor name and identity on each product page.
- Open a vendor storefront such as `/vendor/batik-sekar-solo`.
- Filter search/category results by vendor.
- Compare similar products from different vendors.
- Add products from one or multiple vendors to the cart.
- See subtotals and shipping grouped by vendor during checkout.

If the same or a similar product is available from several vendors, the customer chooses the specific listing/vendor to purchase from. LOKKA does not automatically switch the customer to another vendor.

### 5.2 Minimum vendor data

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

During phase one, only the internal vendor exists:

```text
id: 1
slug: lokka
name: LOKKA
status: active
```

All LOKKA products have `vendor_id = 1`.

### 5.3 Future vendor onboarding

When marketplace onboarding is activated, each vendor may have:

- Vendor account and roles.
- Store/vendor profile.
- Shipping origin address.
- Product catalog and variants.
- Independent inventory.
- Vendor-specific order items and fulfillment.
- Vendor-specific sales reporting.
- Balance, commission, settlement, and payout in later phases.

## 6. Multi-Vendor Cart, Checkout, Order, and Fulfillment

### 6.1 Cart

One cart may contain multiple vendors.

```text
Cart
+-- Vendor: LOKKA
|   +-- Batik Shirt A x1
|   +-- Scarf B x2
|
+-- Vendor: Batik Sekar Solo
    +-- Handwritten Batik Fabric C x1
```

### 6.2 Checkout grouping

Before payment, the checkout engine creates a `fulfillment_group` for each vendor and shipping origin.

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

Shipping is calculated per fulfillment group. The customer total is:

```text
grand_total = item_subtotal
            - discount_total
            + shipping_total
            + tax_total_if_applicable
```

### 6.3 Order model

A customer checkout creates one parent order for the customer experience, while items and fulfillment remain separated per vendor.

```text
orders
  +-- order_items
  |     +-- vendor_id
  |
  +-- fulfillment_groups
        +-- vendor_id
        +-- shipment_id
```

This provides one customer-facing checkout/order number while ensuring each vendor only sees and fulfills the portion they own.

### 6.4 Order statuses

Recommended customer-level statuses:

- `PENDING_PAYMENT`
- `PAID`
- `PROCESSING`
- `PARTIALLY_SHIPPED`
- `SHIPPED`
- `COMPLETED`
- `CANCELLED`
- `REFUNDED`

Per-vendor fulfillment statuses:

- `PENDING`
- `ACCEPTED`
- `PACKING`
- `READY_TO_SHIP`
- `SHIPPED`
- `DELIVERED`
- `CANCELLED`
- `RETURNED`

## 7. Core Domain Modules

Recommended modular structure:

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

Each module should ideally own its routes/controllers, services/use cases, repositories/data access, validation schemas, and tests.

## 8. Core Database

Recommended minimum tables:

| Domain | Main Tables |
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

### Important database rules

- Money is stored as integers in the agreed smallest unit, never floating point.
- `order_items` store snapshots of product name, SKU, price, vendor, and selected attributes at purchase time.
- Historical order prices are never recalculated from current product tables.
- Stock reservations are created while checkout/payment is in progress and have an expiration.
- Webhook processing is idempotent so duplicate callbacks do not process an order twice.
- Soft delete is only used where necessary; historical transactions must not disappear.

## 9. Payment Architecture - DOKU

The core application does not call DOKU directly from order domain logic. Use an interface:

```text
PaymentService
+-- DokuPaymentProvider
+-- FutureMidtransProvider
+-- FutureXenditProvider
```

Example capabilities:

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

Payment status must not be trusted solely from a browser redirect. A verified server-to-server webhook is the primary source of payment confirmation.

### Payment tables

`payments` should at minimum store:

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

Use an abstraction:

```text
ShippingService
+-- BiteshipShippingProvider
+-- FutureRajaOngkirProvider
```

Minimum capabilities:

```text
searchDestination(query)
getRates(origin, destination, items)
createShipment(fulfillment)
getTracking(shipment)
cancelShipment(shipment)
handleWebhook(payload, headers)
```

### Fulfillment principle

A shipment should normally be created after an order is paid and the goods are ready to process, not automatically at the exact moment payment succeeds.

Flow:

```text
PAID
  -> PROCESSING
  -> PACKING
  -> READY_TO_SHIP
  -> createShipment()
  -> SHIPPED
  -> DELIVERED
```

For multi-vendor orders, each fulfillment group has its own origin and shipment.

## 11. Storefront and Routing

Recommended public routes:

```text
/
/batik
/men
/women
/accessories
/category/:slug
/search
/product/:slug
/vendor/:vendorSlug
/vendor/:vendorSlug/products
/cart
/checkout
/order/:orderNumber
/account
/account/orders
/account/orders/:orderNumber
/account/addresses
/wishlist
/about
/articles
/articles/:slug
```

Product pages must clearly display vendor identity and link to the vendor storefront.

## 12. Admin and Vendor Panel

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

LOKKA admin can see the complete marketplace.

### 12.2 Future vendor panel

Vendors can only access their own resources:

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

Authorization must always be enforced on the server using `vendor_id` and role checks, not merely by hiding frontend menus.

## 13. API Baseline

Example internal/public endpoints:

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

Admin/vendor APIs are separated through authorization and can receive their own namespace if needed.

## 14. Authentication and Authorization

Initial roles:

- `customer`
- `admin`
- `staff`
- `vendor_owner`
- `vendor_staff`

Recommendations:

- Use secure, HTTP-only cookies for web sessions.
- Hash passwords using a modern algorithm supported by a production-grade library.
- Apply CSRF protection to cookie-based state-changing operations.
- Rate-limit login, OTP, password reset, and sensitive endpoints.
- Add MFA for admin and vendor accounts when operationally appropriate.
- Support session revocation and device/session visibility for privileged accounts.

## 15. Security Baseline

Production baseline:

- Only ports 22, 80, and 443 are exposed as needed.
- PostgreSQL 5432 is not exposed to the internet.
- Redis 6379 is not exposed to the internet.
- SSH uses key authentication; password login is disabled where possible.
- UFW and Fail2ban are enabled.
- TLS/HTTPS is mandatory.
- Secrets are stored in environment variables or a secret manager, never committed to the repository.
- Provider API keys are never sent to browsers unless the provider explicitly defines them as public/client keys.
- DOKU/Biteship webhooks are verified and processed idempotently.
- All input is validated with JSON Schema or a type-safe schema system.
- Database queries use parameterization or a safe ORM/query builder.
- Media uploads are validated for size, MIME type, and extension, and are never executed from the upload directory.
- Audit logs cover price, stock, order, refund, settlement, and role changes.
- Database backups are encrypted and include an off-site copy.

## 16. SEO, Content, and Performance

The main storefront uses server-rendered HTML. Product, category, vendor, and article pages must render their primary content completely without depending on client-side JavaScript.

SEO baseline:

- Unique `<title>` and meta description.
- Canonical URL.
- OpenGraph metadata.
- Schema.org `Product`, `Offer`, `BreadcrumbList`, `Organization`, and `Article` where applicable.
- Segmented XML sitemaps as the dataset grows.
- robots.txt.
- Clean slugs and redirects when slugs change.
- Vendor storefronts have their own canonical metadata.
- Product availability and price in structured data reflect current server data.

Performance baseline:

- Image optimization and responsive image sizes.
- CDN caching for assets/media.
- Brotli/gzip at the edge/proxy.
- Database indexes for slugs, vendor, category, order status, timestamps, and frequently queried foreign keys.
- Redis is used only for cacheable/ephemeral data; PostgreSQL remains the source of truth.

## 17. Single-VPS Deployment

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

Use either systemd or Docker Compose. Choose one deployment pattern and stay consistent; do not introduce multiple orchestrators during the initial phase.

## 18. Observability and Operations

Minimum operational visibility:

- Structured application logs with request IDs.
- Error logging without leaking secrets or sensitive payment data.
- Internal health endpoint.
- Uptime monitoring.
- Disk, RAM, CPU, database connection, and storage monitoring.
- Alerts for webhook failures, payment mismatches, shipment failures, and backup failures.
- Daily database backups and periodic restore tests.
- Audit trails for material admin/vendor actions.

## 19. Implementation Roadmap

### Phase 1 - Commerce Core

- Vendor entity with LOKKA as the default vendor.
- Product, category, variant, and media.
- Inventory and stock reservation.
- Cart.
- Checkout.
- Order and order-item snapshots.
- Customer account.
- Basic admin.

### Phase 2 - Payment

- DOKU sandbox and production adapter.
- Payment creation.
- Webhook verification.
- Idempotency.
- Payment status history.
- Cancellation/refund foundation.

### Phase 3 - Shipping

- Biteship destination lookup.
- Rate calculation.
- Shipping choice per fulfillment group.
- Shipment creation.
- AWB/tracking number and tracking.
- Shipment event webhooks.

### Phase 4 - Customer Experience and SEO

- Wishlist.
- Reviews.
- Coupons/promotions.
- Email/notifications.
- Invoice.
- SEO structured data.
- Content/articles.
- Performance optimization.

### Phase 5 - Multi-Vendor Activation

- Vendor onboarding.
- Vendor login and roles.
- Vendor storefront.
- Vendor catalog/inventory management.
- Vendor-specific order/fulfillment access.
- Marketplace moderation.
- Commission rules.

### Phase 6 - Settlement and Payout

- Vendor balance ledger.
- Commission calculation.
- Settlement periods.
- Refund/return impact on vendor balance.
- Payout integration.
- Reconciliation and finance reports.

## 20. MVP Acceptance Criteria

The MVP is ready when:

- Customers can discover products through category/search and see the product vendor.
- Customers can add products to cart.
- The cart can group items by vendor.
- Checkout can calculate shipping per vendor/origin.
- Customers can complete one checkout and pay through DOKU.
- A verified payment webhook changes order state idempotently.
- Admin can process orders and fulfillment.
- Shipments can be created through Biteship and tracking data is stored.
- Customers can see order and shipment status.
- Stock is reduced using consistent rules and race conditions are prevented.
- Product/category/vendor pages are indexable through server-rendered HTML.
- Backups, logging, and baseline security controls are active in production.

## 21. Locked Baseline Architecture Decisions

| Decision | Baseline |
|---|---|
| Application architecture | Modular monolith |
| Backend | Fastify 5 + TypeScript |
| Database | PostgreSQL |
| Cache/queue | Redis |
| Storefront | Server-rendered HTML; React SPA is not the default |
| Frontend build | Vite |
| Primary payment | DOKU through `PaymentService` abstraction |
| Primary shipping | Biteship through `ShippingService` abstraction |
| Multi-vendor | Data model enabled from day one; vendor onboarding activated later |
| Customer vendor choice | Customers can see, choose, and shop by vendor |
| Multi-vendor cart | Allowed; checkout is split into fulfillment groups per vendor/origin |
| Initial hosting | One Ubuntu 24.04 LTS VPS |
| Scaling | Extract components only when real load requires it |

## 22. Important Implementation Notes

- Do not create microservices before there is a clear operational need.
- Do not bind order logic directly to the DOKU or Biteship SDK.
- Do not assume one order always equals one shipment.
- Do not assume one cart contains only one vendor.
- Do not use current product prices to reconstruct historical transactions.
- Do not trust browser payment-success redirects without webhook verification.
- Do not expose databases, Redis, secrets, or private provider keys to the internet/browser.
- Do not protect vendor access only with frontend filters; enforce ownership in the backend.

---

**This document is the LOKKA v1.0 technical baseline.** Major changes to the payment provider, shipping provider, order model, vendor model, or deployment model should be recorded as Architecture Decision Records (ADRs) so platform evolution remains controlled.
