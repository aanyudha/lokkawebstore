MASTER REQUIREMENT — LOKKA ADMIN, BACK OFFICE, POS & UMK BUSINESS TOOLS

Consolidated: 20 September 2026

Dokumen ini adalah requirement arsitektur jangka panjang LOKKA. Requirement UMK Academy 2026 diperlakukan sebagai use-case/evidence target atas business tools LOKKA, bukan sebagai alasan membuat aplikasi challenge terpisah.

UMK Academy challenges TIDAK otomatis menjadi modul LOKKA. Keputusan apakah sebuah UMK requirement menjadi fitur LOKKA harus melewati decision rule di Section 9.

CURRENT IMPLEMENTATION CHECKPOINT (informational, bukan pengganti Git history):

- Phase 0 Audit: complete.
- Phase A Admin Foundation: implemented.
- Phase B1 Product Media/Showcase: implemented as internal/admin workflow, termasuk source metadata/retention untuk upload baru, readiness, dan storefront isolation.
- Phase B2 Product Story: next planned module.
- Modul lain tetap mengikuti dependency/phase gates di dokumen ini.

Gunakan source code LOKKA yang sekarang sebagai dasar.

Jangan membuat aplikasi terpisah/repository baru hanya untuk Admin atau POS. Public Webstore, Admin Back Office, dan POS adalah tiga application surfaces berbeda dalam satu sistem/codebase, menggunakan authentication, domain/service layer, database, product, inventory, order, transaction, media, dan business logic yang sama jika memang domain-nya sama.

Sebelum coding, audit source existing terlebih dahulu. Jangan menebak nama file, table, route, middleware, ORM model, service, template, atau component.

Tujuan utama perubahan ini adalah:

LOKKA
│
├── PUBLIC WEBSTORE
│   └── Customer-facing ecommerce
│
├── ADMIN AUTH
│   └── Professional office-style authentication
│
├── ADMIN BACK OFFICE
│   └── Business management / ERP-style workspace
│
└── POS
    └── Protected cashier operational workspace

Public Webstore tidak boleh berubah menjadi ERP/dashboard bisnis.

1. APPLICATION SURFACE ARCHITECTURE

Gunakan pemisahan konseptual berikut.

/
├── Public Webstore
│
├── /admin/login
│   └── AdminAuthLayout
│
├── /admin/*
│   └── AdminBackOfficeLayout
│
└── /pos/*
    └── PosLayout

Gunakan route canonical existing jika repository ternyata sudah mempunyai convention yang berbeda dan lebih tepat. Jangan mengubah URL existing secara agresif tanpa alasan.

Public Webstore

Public Webstore tetap customer-facing.

Area ini mencakup fungsi seperti homepage, katalog, product detail, pencarian, cart, checkout, customer order/account jika sudah tersedia, public content, dan public lookbook apabila sengaja dipublish dari Admin.

Jangan tampilkan menu internal berikut di navigation/frontend customer:

Cash Flow
Accounting
Tax
Legalitas
Business Readiness
Internal Product Story Management
Product Showcase Management
SMEXPO Readiness
Internal Reports
Administrative Settings

POS juga jangan ditambahkan sebagai shortcut di public header.

Tidak perlu menu POS di sebelah SIGN IN.

POS diakses menggunakan URL terpisah oleh pengguna internal yang memang mengetahui dan berhak menggunakan route tersebut.

2. AUTHENTICATION VS AUTHORIZATION

Jangan menyamakan:

Authenticated = boleh semuanya

Pisahkan authentication dengan authorization.

Konsep permission target kurang lebih:

admin.backoffice.access

products.read
products.manage

orders.read
orders.manage

pos.access
pos.transaction.create
pos.transaction.view

finance.read
finance.write

accounting.read

legal.read
legal.manage

tax.read
tax.manage

readiness.read
readiness.manage

reports.read

settings.manage
users.manage

Nama permission final harus mengikuti convention project setelah audit.

Jika sistem sekarang hanya mempunyai role sederhana, audit dahulu bagaimana migration ke permission yang lebih granular bisa dilakukan tanpa merusak compatibility.

Contoh role konseptual:

Super Admin
Admin
Finance
Cashier / POS Operator
Content / Product Manager

Cashier yang hanya mempunyai pos.access tidak otomatis boleh membuka Tax, Accounting, Legalitas, Settings, atau seluruh /admin.

Semua authorization wajib dilakukan server-side/API-side.

Menyembunyikan menu bukan mekanisme keamanan.

3. ADMIN LOGIN — OFFICE AUTH THEME

Buat /admin/login menggunakan theme/layout authentication khusus.

Jangan menggunakan storefront header, product navigation, ecommerce footer, product carousel, category banner, atau komponen customer-facing.

Arah visual mengikuti screenshot login corporate yang sudah diberikan sebagai reference only, bukan untuk dikloning.

Target UX:

┌────────────────────────────────────────────────────────────┐
│                                                            │
│     LOKKA BRAND PANEL       │      SIGN IN                 │
│                             │                              │
│     visual / tagline        │      Email / Username        │
│     subtle business image   │      Password                │
│                             │      Remember me             │
│                             │      Forgot password         │
│                             │                              │
│                             │      [ SIGN IN ]             │
│                             │                              │
└────────────────────────────────────────────────────────────┘

Gunakan:

AdminAuthLayout

atau naming convention yang sesuai project.

Visual language:

Corporate
Office SaaS
Professional
Premium tetapi sederhana
Clean
Light neutral background
White workspace
Dark navy/charcoal typography
LOKKA brand accent
Soft border
Soft shadow
Controlled border radius
Good whitespace
Desktop-first
Responsive

Left visual area jangan bergantung pada foto tertentu.

Buat reusable branded component sehingga aset visual bisa diganti kemudian tanpa mengubah struktur login.

Authentication form minimal mempunyai email/username, password, show/hide password, validation state, loading state, error state yang jelas, remember-me bila backend mendukung, dan forgot-password hanya bila flow memang sudah tersedia.

Jangan membuat fake forgot-password link.

4. POS LOGIN BEHAVIOR

POS menggunakan protected URL:

/pos

atau canonical route sejenis setelah audit.

Jika user membuka /pos tetapi belum authenticated:

/pos
  ↓
authentication
  ↓
successful login
  ↓
/pos

Boleh menggunakan admin/internal auth screen yang sama jika authentication domain memang sama.

Contoh:

/admin/login?returnTo=/pos

tetapi implementasi return URL wajib aman dan tidak menyebabkan open redirect.

Jika user sudah authenticated tetapi tidak mempunyai permission POS:

403 Forbidden / Access Denied

Jangan redirect diam-diam ke public homepage sehingga alasan kegagalan akses menjadi tidak jelas.

5. ADMIN DASHBOARD — OFFICE BACK OFFICE

Setelah login back-office, arahkan ke:

/admin

atau canonical admin dashboard existing.

Admin harus memiliki office/business management visual language seperti screenshot dashboard yang telah diberikan.

Layout utama:

┌───────────────┬────────────────────────────────────────────┐
│               │ TOP BAR                                    │
│   SIDEBAR     ├────────────────────────────────────────────│
│               │ Breadcrumb / Page title                    │
│ Dashboard     │                                            │
│ Commerce      │                                            │
│ Products      │              WORKSPACE                     │
│ Sales         │                                            │
│ Finance       │                                            │
│ Readiness     │                                            │
│ Reports       │                                            │
│ Settings      │                                            │
│               │                                            │
└───────────────┴────────────────────────────────────────────┘

Desktop:

Fixed/collapsible sidebar kiri
Topbar
Breadcrumb
Page title
User menu kanan atas
Search bila relevan
Notification bila real feature tersedia
Wide workspace

Tablet/mobile:

Sidebar → collapsible drawer
Content tetap usable

Dashboard jangan terlihat seperti landing page ecommerce.

Target visual feel:

ERP
Accounting SaaS
Payment Back Office
Business Management
Modern Office Workspace

6. SIDEBAR INFORMATION ARCHITECTURE

Target grouping jangka panjang:

Dashboard

Commerce
  Orders
  Customers

Products
  Products
  Categories
  Inventory
  Media

Sales
  POS                → shortcut internal ke /pos, bukan implementasi POS kedua
  Transactions

Finance
  Overview
  Global Overhead    → pertahankan jika existing
  Cash Flow
  Income & Expense
  Accounting Lite

Business Readiness
  Overview
  Legal & Compliance
  Tax Readiness
  Sales Channels / SMEXPO

Reports

Settings
  Fulfillment        → pertahankan jika existing
  Users & Permissions (hanya setelah authorization module benar-benar tersedia)

Aturan penting: target grouping di atas BUKAN perintah untuk menampilkan semua menu sekarang. Sidebar production hanya boleh menampilkan module/route yang benar-benar tersedia dan usable. Jangan membuat placeholder/fake page hanya agar struktur menu terlihat lengkap.

Menu existing jangan dihapus sembarangan.

Audit dahulu menu saat ini lalu reorganize secara backward-safe.

Menu POS di dalam Admin boleh tersedia sebagai shortcut ke:

/pos

Tetapi jangan membuat implementasi POS kedua di dalam admin.

Jika modul belum tersedia, jangan mengisi production UI dengan halaman fake atau dummy.

Gunakan feature flag, permission, disabled state yang tepat, atau jangan tampilkan sampai module memang siap, mengikuti architecture existing.

7. ADMIN DESIGN SYSTEM

Buat reusable component system agar semua halaman admin terlihat sebagai satu produk.

Component architecture minimal harus mencakup konsep:

AdminShell
Sidebar
SidebarSection
SidebarItem
Topbar
Breadcrumb
PageHeader

KpiCard
ContentCard

DataTable
FilterBar
SearchField
Pagination

TextInput
Textarea
Select
Checkbox
DateInput
MoneyInput

StatusBadge
Alert
Modal / Dialog
ConfirmationDialog

EmptyState
LoadingState
Skeleton
ErrorState

Gunakan stack/component/style system existing jika memang sudah memadai.

Jangan langsung memasukkan AdminLTE, CoreUI, template Bootstrap dashboard besar, atau library admin lain hanya karena tampilannya mirip.

Yang dibutuhkan adalah arsitektur dan visual language office, bukan ketergantungan pada template tertentu.

8. UMK ACADEMY DECISION RULE

UMK Academy challenges adalah evidence/use-case, bukan arsitektur inti LOKKA. Setiap UMK requirement harus melewati decision rule berikut:

UMK requirement
  → identify required evidence
  → reuse existing LOKKA business capability where possible
  → if capability is missing, ask whether it remains useful to LOKKA after UMK Academy
  → if YES, build a reusable business capability
  → if NO, handle the UMK challenge manually outside the application

LOKKA TIDAK boleh menjadi clone UMK Academy.

Prinsip:

- Business tools dibuat sebagai fitur LOKKA reusable.
- Jangan membuat satu halaman bernama "UMK Academy Challenge Submission" sebagai source utama data.
- Challenge UMK Academy menjadi validation/use-case dari business data LOKKA, bukan arsitektur inti aplikasi.

Contoh penerapan:

LOKKA Product
      ↓
Product Media Management
      ↓
UMK requirement dapat dipenuhi via manual owner submission

LOKKA Finance
      ↓
Cash Flow
      ↓
UMK requirement dapat dipenuhi

LOKKA Business Legal Readiness
      ↓
NIB / KBLI status
      ↓
UMK requirement dapat dipenuhi

9. PRODUCT MEDIA MANAGEMENT

Product Media Management adalah durable LOKKA business capability. Product Showcase challenge dari UMK Academy HANYA membutuhkan owner untuk secara manual mengirimkan foto produk yang sesuai ke UMK Academy.

Oleh karena itu, Product Showcase TIDAK otomatis menjadi modul LOKKA permanen. Yang permanen adalah kemampuan mengelola media produk.

Capability durable:

- JPEG/PNG upload dengan validasi tipe file
- Validated source/original retention
- Source MIME/format metadata
- Width/height metadata
- File size metadata
- Secure private original storage
- Optimized WebP storefront derivatives
- Primary image selection
- Image order untuk storefront
- Preview
- Deletion safety

Server harus memvalidasi file sebenarnya.

Jangan hanya mempercayai:

extension
browser-provided MIME
client-side validation

Persist true source metadata: format, MIME, width, height, bytes, private storage key.

Historical image yang hanya mempunyai WebP derivative tidak boleh diklaim mempunyai JPG/PNG original.

High-resolution suitability tetap REVIEW REQUIRED/manual review sampai ada threshold resmi. Width/height aktual boleh ditampilkan tanpa membuat threshold arbitrer.

Jika module Product Showcase internal/admin dibutuhkan sebagai evidence preparation layer, itu boleh ada sebagai optional layer di atas Product Media Management, bukan sebagai module mandiri yang mengubah storefront behavior.

Showcase cover TIDAK BOLEH mengubah storefront/public primary image. Showcase ordering TIDAK BOLEH mengubah product_images ordering di storefront.

Upload baru harus menyimpan validated original/source privately bila source JPEG/PNG, sambil tetap membuat WebP derivatives untuk public storefront.

Saat selected photos = 0, source format/source metadata harus N/A atau NOT EVALUATED, bukan PASS.

Readiness minimal membedakan NOT_READY, REVIEW_REQUIRED, READY sesuai rule deterministic.

Optional submission helper (boleh ditambahkan setelah core stabil):

- Admin-authenticated download retained original per image.
- Export selected originals sebagai paket/ZIP untuk mempermudah upload manual ke UMK Academy.
- Export helper bukan source-of-truth dan tidak membuka original file ke public URL.

10. PRODUCT BRAND & STORY

Product Story harus merupakan product capability, bukan top-level module mandiri.

Target placement:

Products
  → Edit Product
  → Brand & Story

Fields:

- target market
- positioning
- product-story usage status (uses_product_story)
- distinctive characteristic status (has_distinctive_characteristic)
- unique value
- product story

Reuse existing:

- product name
- product media
- product identity lainnya

Jangan menduplikasi data yang sudah authoritative.

Model konseptual (disesuaikan setelah audit schema):

ProductStory
────────────────────
id
product_id FK
target_market
positioning
uses_product_story
has_distinctive_characteristic
unique_value
story
status
created_at
updated_at

Status dapat berupa konsep:

draft
active
archived

tetapi ikuti enum convention existing.

HARDENING PRODUCT STORY:

- Editor Product Story adalah internal/admin.
- Product Story tidak otomatis mengubah PDP, SEO, JSON-LD, product description, atau public content.
- Jika di masa depan sebagian story dipublish ke customer-facing content, gunakan explicit publish/projection step yang terpisah.
- Readiness untuk challenge harus berasal dari kelengkapan field nyata: product photo, product name, target market, positioning, usage/story status, distinctive-characteristic status, unique value, dan story.
- Jangan membuat persentase readiness random. Gunakan PASS/MISSING/REVIEW atau rule deterministic yang dapat dijelaskan.

Tidak ada automatic customer-facing publication.

11. LEGAL & COMPLIANCE

Legal & Compliance adalah durable LOKKA business capability.

Target: Business Readiness → Legal & Compliance

Buat legal readiness sebagai reusable checklist berorientasi pada Business/Vendor existing, bukan Product dan bukan satu row challenge.

Minimum capabilities:

- Business identity diambil dari Vendor/business profile existing.
- NIB (Nomor Induk Berusaha) status.
- NIB number/reference.
- Satu atau more KBLI code + description/reference.
- NIB/KBLI suitability assessment.
- Additional licenses/documents owned.
- Required/missing licenses.
- Follow-up/action plan.
- Notes.
- Evidence/document upload per checklist item bila relevan.

Recommended generic entities setelah audit schema:

BusinessLegalReadiness
LegalRequirement
LegalChecklistItem
LegalDocument

LegalDocument minimum metadata:

id
vendor_id / business_id FK
legal_requirement_id nullable
document_type
document_number/reference nullable
issuer nullable
issued_at nullable
expires_at nullable
status
storage_key private
original_filename display-only
mime_type
size_bytes
checksum if architecture supports it
uploaded_by
notes nullable
created_at
updated_at

Status reusable:

not_started
in_progress
complete
not_applicable

atau existing convention equivalent.

Legal document status bukan official government verification kecuali ada integration/source resmi. Gunakan wording seperti self-declared, recorded, reviewed, missing, expired, atau needs_review sesuai rule final.

HARDENING LEGALITAS — DOCUMENT EVIDENCE:

Document storage rules:

- PRIVATE, tidak berada di public static/media directory.
- Download hanya melalui authenticated + authorized route.
- Validate magic bytes, file size, extension/MIME, and decode image if image.
- PDF/JPEG/PNG dapat didukung jika memang dibutuhkan business document workflow.
- Random storage key; user filename tidak menjadi filesystem authority.
- No path traversal.
- No direct filesystem path in HTML/API.
- Replace/version/delete semantics harus jelas dan audit-sensitive.

Legal Checklist UX:

Admin Legalitas harus terasa seperti operational checklist, bukan satu textarea besar.

Contoh:

Legal Readiness — LOKKA

[✓] Business identity recorded
[✓] NIB recorded
[!] KBLI suitability        NEEDS REVIEW
[✓] Supporting NIB file     [View] [Replace]
[ ] Additional license      MISSING / NOT APPLICABLE
[ ] Follow-up action        REQUIRED

Setiap checklist item minimal mempunyai label, status, notes, optional due/follow-up, optional evidence attachment, last updated, dan actor bila audit metadata tersedia.

Jangan menyimpulkan legal compliance resmi hanya dari checklist internal.

12. FASHION LOOKBOOK

Fashion Lookbook adalah CONDITIONAL modul, bukan mandatory.

LOKKA TIDAK harus membuat Lookbook module hanya karena UMK Academy meminta catalog/lookbook link. Reuse dulu:

- Products
- Variants
- Pricing
- Media
- Public product URL
- Sales Channel information

Sebagian besar data UMK Academy harus berasal dari Product, Variant, Pricing, Media, dan Sales Channel existing.

Dedicated Lookbook menjadi modul LOKKA NYATA HANYA jika ada ongoing business need seperti:

- seasonal collection
- wholesale catalog
- buyer presentation
- press/editorial lookbook
- campaign collection

Jika diimplementasikan, admin capabilities:

Create lookbook
Title
Description if useful
Select products
Reorder products
Select cover
Draft
Publish
Unpublish
Public URL if supported

Untuk customer-facing lookbook:

Admin creates
      ↓
Admin publishes
      ↓
Public lookbook URL

Public lookbook hanya muncul jika memang dipublish.

Jangan expose draft.

Lookbook mempunyai explicit publication lifecycle: draft → published → unpublished/archived. Public route hanya membaca published projection. Draft/internal notes tidak boleh bocor.

HARDENING LOOKBOOK — UMK ACADEMY EVIDENCE:

Challenge meminta: product name, price, size/variant, product photo, catalog/lookbook/content URL, sales channel URL, dan photo consistency notes.

Mapping:

- Product name → Product existing.
- Price → Variant/Pricing existing.
- Size/variant → Variant existing.
- Product photo → Product Media / optionally Showcase-selected media.
- Catalog/lookbook/content URL → published Lookbook URL atau public product/content URL yang sengaja dipublish.
- Sales channel URL → SalesChannel/Store URL, bukan internal admin URL.
- Photo consistency notes → Lookbook/editorial metadata internal.

Publication harus explicit. Tidak ada automatic publication dari internal data ke customer frontend.

13. SALES DOMAIN — SINGLE SOURCE OF TRUTH

Hindari arsitektur seperti:

WebstoreOrder table
POSOrder table
AdminOrder table

yang mempunyai business logic dan financial semantics berbeda tanpa kebutuhan nyata.

Target konseptual:

                  ┌── Webstore Checkout
                  │
Sales Domain <────┼── POS
                  │
                  └── Admin operation

Kemudian:

Sales / Orders
      ↓
Inventory movement
      ↓
Financial transaction
      ↓
Cash Flow
      ↓
Accounting Lite
      ↓
Tax Readiness

Actual schema harus mengikuti architecture repository existing.

Jangan memaksakan nama model sebelum audit.

DUA SALES SOURCES — INVARIANT

Dua sumber penjualan utama LOKKA:

WEBSTORE
- pembelian oleh customers melalui public storefront
- customer-facing ecommerce transactions

POS
- penjualan internal LOKKA melalui protected POS workspace
- internal cashier / sales transactions

Keduanya harus pada akhirnya konvergen ke transaction dan finance foundation yang sama dan memberikan data ke:

- payments
- inventory movements
- Cash Flow
- Accounting Lite
- Tax Readiness

14. POS — PROTECTED OPERATIONAL WORKSPACE

POS adalah protected internal cashier / sales workspace — operational application surface dalam codebase LOKKA yang menggunakan URL dan layout tersendiri. POS tidak ditampilkan dalam navigation public dan bukan customer-facing feature. POS menggunakan authentication/authorization internal LOKKA serta shared product, sales, inventory, payment, dan finance domain. Admin Back Office dapat menyediakan shortcut internal menuju POS, tetapi tidak boleh mempunyai implementasi POS kedua.

POS bukan customer storefront.

POS bukan generic admin CRUD.

POS bukan sistem finance terpisah.

POS menggunakan layout sendiri:

PosLayout

Target UI:

┌────────────────────────────────────────────────────────────┐
│ LOKKA POS        Product Search          Cashier / Session │
├────────────────────────────────────┬───────────────────────┤
│                                    │ CURRENT SALE          │
│ Search                             │                       │
│ Categories                         │ Item A          x2     │
│                                    │ Item B          x1     │
│ Product grid/list                  │                       │
│                                    │ Subtotal              │
│ [Product] [Product] [Product]      │ Discount              │
│ [Product] [Product] [Product]      │ Total                 │
│                                    │                       │
│                                    │ [ PAYMENT ]           │
└────────────────────────────────────┴───────────────────────┘

Initial POS capabilities:

Product search
SKU search if existing
Barcode support if data/infrastructure existing
Category/filter
Product selection
Variant selection
Quantity
Cart
Remove item
Subtotal
Discount if pricing architecture supports it
Total
Payment method
Complete transaction
Receipt/reference
Print-friendly receipt
Start new transaction

POS UX harus mengutamakan:

Speed
Few clicks
Large usable controls
Keyboard support where useful
Tablet usability
Clear payment flow

Jangan menggunakan CRUD form admin untuk transaksi kasir.

POS HARDENING — KEEP AS SEPARATE SURFACE:

POS dependencies sebelum production use:

- authoritative sellable Product/Variant/Pricing
- inventory movement model (bukan absolute stock edit saja)
- normalized Sale/Order transaction semantics
- atomic stock update / oversell protection
- finance posting/idempotency
- cashier permission
- receipt/reference
- void/refund policy before those actions are exposed
- audit trail consideration for void/refund/manual discount

Admin boleh mempunyai shortcut ke /pos setelah POS benar-benar tersedia dan permission-aware. Public header tetap tidak mempunyai POS shortcut.

15. POS & INVENTORY

Jika inventory sudah ada:

POS completed sale
        ↓
Sales service
        ↓
Inventory service
        ↓
Stock movement

Jangan:

POS controller
UPDATE product SET stock = stock - ...

secara langsung jika domain/service layer sudah tersedia.

Stock mutation harus atomic/transaction-safe sejauh architecture memungkinkan.

Audit race condition dan overselling.

Jika inventory belum tersedia, jangan pura-pura membuat integration.

Dokumentasikan gap lalu desain migration/domain terlebih dahulu.

16. POS & FINANCE

POS tidak mempunyai ledger sendiri.

Target:

Webstore Order ───────────┐
                          │
POS Sale ─────────────────┼──> Normalized Sales / Finance Flow
                          │
Manual Finance Entry ─────┘
                                   ↓
                               Cash Flow
                                   ↓
                           Accounting Lite
                                   ↓
                            Tax Readiness

Gunakan idempotency/source reference bila dibutuhkan agar satu sale tidak dicatat dua kali ke finance.

17. CASH FLOW

Cash Flow adalah genuine long-term LOKKA capability. Jangan duplicate financial data dalam UMK-specific form.

Target architecture:

Webstore Sales ──────┐
POS Sales ───────────┼── Financial Transactions
Manual Income ───────┤
Manual Expenses ─────┘
                           ↓
                        Finance
                           ↓
             ┌─────────────┼─────────────┐
             ↓             ↓             ↓
         Cash Flow   Accounting Lite  Tax Readiness

Cash Flow concepts:

- opening balance
- income
- expenses
- ending balance
- period
- source/category
- notes

Konsep data minimal:

Financial Transaction
Date
Direction: income / expense
Category
Amount
Source
Reference
Payment method if relevant
Notes

Source dapat mencakup:

webstore
pos
manual
adjustment

sesuai domain final.

Cash Flow overview:

Opening Balance
Income
Expense
Ending Balance
Transactions

Perhitungan harus deterministik dan testable.

Opening balance + income - expense = ending balance harus deterministic untuk periode yang sama. Definisikan timezone/periode secara eksplisit. Manual adjustments wajib mempunyai source/reference dan authorization.

HARDENING CASH FLOW — UMK ACADEMY EVIDENCE VIEW:

Challenge meminta: product/service, sales unit, main costs, selling price, total income, total expense, ending cash balance, dan improvement plan.

Jangan membuat duplicate challenge ledger. Buat period-based evidence/readiness view yang mengambil data dari Product/Pricing + normalized Financial Transaction dan hanya menyimpan narrative fields seperti improvement plan bila memang tidak berasal dari transaksi.

18. ACCOUNTING LITE

Jangan membangun Accurate/Jurnal replacement pada fase pertama.

Accounting Lite memanfaatkan data transaksi yang sudah ada.

Output awal:

Revenue
HPP / COGS if available
Gross Profit
Operating Expenses
Simple Operating/Net Result
Cash Balance
Receivable if architecture supports it
Payable if architecture supports it

Data financial tidak boleh diketik ulang jika sudah berasal dari Order/POS/Finance Transaction.

Accounting adalah derived representation atas source transaction.

HARDENING ACCOUNTING LITE:

- Initial Accounting Lite bukan full ERP accounting package dan bukan double-entry general ledger kecuali requirement berikutnya secara eksplisit meminta itu.
- Tetapkan basis/reporting semantics dengan jelas (misalnya cash-oriented operational summary pada fase awal).
- Revenue, COGS/HPP, operating expenses, gross profit, operating result, dan cash balance harus derived dari normalized source transaction/category mapping.
- Jika suatu nilai belum dapat dihitung karena source data belum tersedia, tampilkan unavailable/needs setup; jangan meminta user mengetik ulang angka yang seharusnya derived.
- Manual journal/adjustment jika nanti ditambahkan harus protected, attributable, auditable, dan tidak mengubah source sale secara diam-diam.

19. TAX READINESS

Tax Readiness adalah READINESS / SIMULATION.

Tax Readiness BUKAN official tax engine.

Jangan membangun:

Tax Filing
Tax Submission
Official Government Reporting

pada fase ini.

Parameter UMK Academy:

Business name
Main product/service
Tax administration status
Turnover/revenue for selected period
Tax calculation simulation
Follow-up plan

Tambahan internal bila dibutuhkan:

NPWP status
Tax identifier/reference
Reporting readiness
Period
Notes

Omzet harus dapat dihitung dari source financial/order berdasarkan periode.

Tax calculation simulation harus dipisahkan dari authoritative bookkeeping.

Jangan hard-code tarif pajak sebagai assumption permanen.

Jika suatu hari calculation engine diperlukan:

TaxRule
effective_from
effective_until
taxpayer_type
rule/version
rate/config

harus versioned/configurable.

HARDENING WAJIB PAJAK READINESS — UMK ACADEMY EVIDENCE:

- Business name/main product berasal dari Vendor/Product source-of-truth.
- Turnover harus dihitung dari finance/sales source untuk period yang dipilih.
- Jika user memasukkan manual turnover override, provenance harus jelas dan tidak boleh silently mengganti authoritative transaction-derived value.
- Simulation harus diberi label SIMULATION / NON-FILING dan menyimpan rule/version/effective date jika calculation rules digunakan.
- Tidak boleh memberikan status seolah-olah LOKKA telah melaporkan pajak ke pemerintah tanpa integration resmi.
- Jangan label simulation sebagai official tax result.

20. SALES CHANNELS / SMEXPO

SMEXPO harus dimodelkan sebagai satu Sales Channel, bukan sebagai hard-coded UMK challenge module.

Gunakan domain generik:

Sales Channels
atau
Sales Channel Readiness

Possible channels:

- LOKKA Webstore
- SMEXPO
- future marketplaces
- future social-commerce channels

Parameter readiness:

- account/store status
- profile readiness
- product/catalog readiness
- store URL
- notes
- follow-up action

Channel awal dapat mencakup:

SMEXPO
LOKKA Website

dan dapat diperluas kemudian.

HARDENING SMEXPO READINESS — UMK ACADEMY EVIDENCE:

- State contoh: not_started, account_created, profile_incomplete, catalog_incomplete, ready, active, needs_follow_up. Enum final mengikuti project convention.
- Store URL hanya ditampilkan sebagai public/external URL yang memang dimiliki. Jangan menyimpan admin credential/token di readiness notes.
- API integration dengan SMEXPO tidak diperlukan untuk memenuhi readiness unless separately requested.

21. BUSINESS READINESS ENGINE

Business Readiness harus menjadi aggregation layer atas data nyata.

Target kategori:

Product Media Management
Product Brand & Story
Legal & Compliance
Finance
Tax
Sales Channels

Jangan membuat:

Legalitas = 75%

dengan angka random.

Setiap score/progress harus mempunyai rule yang dapat dijelaskan.

Contoh konseptual:

Legal Readiness
──────────────────────
NIB                  25
KBLI match           25
Required docs        25
Follow-up recorded   25
──────────────────────
Total               100

Itu hanya contoh mekanisme, bukan rule final.

Rule final harus berdasarkan checklist yang benar-benar ditentukan product/business requirement.

Rules harus:

centralized
deterministic
testable
versionable if necessary

READINESS SEMANTICS:

Gunakan semantic state yang dapat dijelaskan, bukan vanity score.

Preferred general states:

- NOT_STARTED
- IN_PROGRESS
- NOT_READY
- REVIEW_REQUIRED
- READY / COMPLETE
- NOT_APPLICABLE where valid

Jika percentage ditampilkan, setiap numerator/denominator/rule harus dapat ditelusuri dan deterministic. Manual review item harus tidak otomatis dianggap PASS.

22. ADMIN DASHBOARD HOME

Dashboard /admin harus mengambil real data.

Contoh informasi:

Sales / Revenue
Orders
Customers
Products
Cash summary
Recent orders
Recent transactions
Readiness status
Pending tasks
Quick actions

Jangan membuat sample charts pada production.

Jika belum ada data:

Empty state

lebih baik daripada fake data.

Charts hanya dipakai jika datanya berguna dan tersedia.

23. DATA OWNERSHIP

Tetapkan source-of-truth dengan jelas.

Contoh prinsip:

Product
→ Product table/domain

Product image
→ Media relation

Price
→ Product/Variant pricing

Order
→ Order domain

POS sale
→ Sales domain

Cash transaction
→ Finance transaction

Readiness
→ readiness rules + source entity

Product Story
→ product marketing metadata

Jangan menyalin nilai Product ke lima tabel berbeda hanya supaya form challenge mudah dibuat.

Jika perlu snapshot karena kebutuhan historical/audit, dokumentasikan alasannya.

24. DATABASE & MIGRATION

Sebelum menambahkan tabel:

Audit Product
Audit Variant
Audit Order
Audit OrderItem
Audit User
Audit Roles/Permissions
Audit Media
Audit Settings
Audit existing transaction/finance schema
Audit inventory schema

Reuse existing entity jika semantically benar.

Migration harus:

Backward-safe
Idempotent according to migration framework
Use proper FK
Use indexes where needed
Preserve existing production data
Avoid destructive rename/drop without migration strategy

Jangan membuat table baru hanya karena nama existing berbeda.

Audit meaning-nya dahulu.

25. SECURITY

Minimal security requirements:

Server-side authentication
Server-side authorization
Secure session/cookie settings
CSRF protection according to architecture
Input validation
Output escaping
Upload validation
File size limits
Image verification
Permission checks
No sensitive internal fields in public API
No finance data in storefront API
No tax/legal data exposure
No IDOR
No open redirects

Admin API dan POS API tetap protected walaupun UI link tidak tersedia.

26. PRIVATE FILE STORAGE — SHARED SECURITY CAPABILITY

LOKKA membutuhkan private file capability yang dapat dipakai oleh retained media source dan LegalDocument tanpa mencampur file publik. Reuse storage primitives jika semantically cocok, tetapi pertahankan namespace/policy jelas.

Required controls:

- random/unpredictable storage key
- no user-controlled filesystem path
- magic-byte/type validation
- size limits
- checksum optional but recommended for documents
- authenticated/authorized download
- Content-Disposition safe filename
- no direct public static serving
- access logging for sensitive legal downloads if audit architecture available
- cleanup on failed persistence
- retention/delete/version policy documented

Supporting legal/compliance documents MUST be private. They must never be exposed through unrestricted public static URLs. Authenticated/authorized access only.

27. DATA CLASSIFICATION & PUBLICATION BOUNDARY

PUBLIC BY DESIGN:

- published product/catalog content
- published lookbook
- public product price/variant/media yang memang digunakan storefront

INTERNAL BUSINESS DATA:

- Product Media readiness/status/notes
- Product Story drafts/internal readiness
- Legal checklist
- Legal documents
- Finance/Cash Flow/Accounting Lite
- Tax Readiness
- SMEXPO/Sales Channel readiness notes
- internal reports

PRIVATE FILES:

- retained JPG/PNG source originals
- legal supporting documents
- sensitive exports

Private/internal data tidak boleh menjadi public hanya karena route tidak ditampilkan di menu. Authorization tetap server-side.

28. ROUTING BOUNDARY

Target konseptual:

Public
────────────────────────
/
products/*
cart/*
checkout/*
account/*

Internal Auth
────────────────────────
/admin/login
/admin/logout
internal auth callbacks

Admin
────────────────────────
/admin/*
/api/admin/*  if architecture uses it

POS
────────────────────────
/pos/*
/api/pos/*    if architecture uses it

Ini bukan perintah membuat API prefix baru jika application existing tidak bekerja seperti itu.

Gunakan hanya sebagai boundary concept.

29. REUSABLE DOMAIN/SERVICE LAYER

UI surfaces berbeda tidak boleh menduplikasi business rules.

Contoh:

Storefront Checkout
        │
        │
POS ────┼──> Order/Sales Service
        │         │
Admin ──┘         ├── Inventory
                  ├── Pricing
                  ├── Payment
                  └── Finance

Jangan membuat:

PosProductService
AdminProductService
StorefrontProductService

yang masing-masing mengimplementasikan rules produk sendiri jika tidak ada alasan domain.

Surface-specific controller/view boleh berbeda.

Domain logic tetap shared.

30. ERROR, EMPTY & LOADING STATES

Semua surface baru wajib memiliki proper state.

Contoh:

Loading
Empty
Validation error
Permission denied
Not found
Server failure
Connection/payment failure where applicable
Successful submission

Jangan hanya membuat happy path.

31. AUDIT LOG CONSIDERATION

Untuk operation sensitif seperti:

Finance manual adjustments
Tax readiness update
Legal document status update
POS void/refund
Settings change
Role/permission change

audit apakah existing application sudah mempunyai audit log.

Jika ada, reuse.

Jika belum, dokumentasikan sebagai architectural requirement dan tentukan apakah perlu diimplementasikan sekarang atau fase berikutnya.

Jangan diam-diam membuat audit system setengah jadi di satu module saja.

32. POS PAYMENT SCOPE

Pada initial POS jangan menambahkan payment gateway baru hanya untuk menyelesaikan POS.

Payment method bisa mulai dari method yang memang supported.

Contoh konseptual:

Cash
Bank Transfer
Existing supported digital payment
Other configured method

Payment integration baru harus menjadi requirement terpisah setelah audit infrastructure.

33. REPORTS

Reports harus derived dari source data.

Contoh masa depan:

Sales by period
Sales by product
POS vs webstore
Income/expense
Cash flow
Product performance
Readiness status

Pada fase awal jangan membuat semua report sekaligus.

Pastikan domain foundation benar dahulu.

34. ACCEPTANCE GATE PER MODULE

Setiap module baru sebelum dianggap complete wajib mempunyai:

- schema/migration backward-safe bila perlu
- authorization server-side
- CSRF/origin protection untuk mutation sesuai architecture
- validation
- empty/error states
- responsive admin UI
- deterministic domain tests
- regression tests terhadap public/customer surface
- production build/test
- Fastify QA
- Docker current-working-tree QA bila module menyentuh DB/runtime/storage
- git diff --check
- no secret committed
- no fake production data
- owner review sebelum commit/push

35. DO-NOT-DRIFT RULES

Jangan salah arah ke pola berikut:

- Satu table/form baru per challenge tanpa domain reuse.
- Product Media yang mengubah storefront primary/order secara diam-diam.
- Legalitas hanya berupa notes tanpa checklist/document evidence.
- Legal document berada di public media folder.
- Lookbook draft dapat dibuka publik.
- Cash Flow dibuat sebagai angka summary manual tanpa transaction source.
- Accounting Lite menjadi duplicate manual bookkeeping.
- Tax Readiness dianggap tax filing engine.
- SMEXPO dibuat sebagai architecture hard-coded yang tidak dapat mendukung channel lain.
- POS dimasukkan ke public storefront atau dibuat sebagai admin CRUD.
- Finance/tax/legal data muncul di public API/HTML/JSON-LD.
- Fake readiness percentage atau fake dashboard graph.
- Menu untuk module yang belum usable ditampilkan sebagai production feature.
- Product Showcase yang mengubah storefront primary/order secara diam-diam.
- Lookbook draft dapat dibuka publik.

36. UMK ACADEMY 2026 — CHALLENGE EVIDENCE MAPPING

UMK Academy challenge tidak menjadi nama domain utama. Berikut mapping bukti challenge ke LOKKA business tools.

1) Product Showcase
Evidence: minimum 5 JPG/PNG high-resolution product photos; product clear/clean/attractive.
LOKKA module: Product Media Management + optional Showcase evidence preparation layer.
Surface: Admin only.
Public impact: none.
Submission form: manual upload ke UMK Academy; LOKKA dapat menyediakan export/download helper.

2) Fashion Lookbook Challenge
Evidence: product name, price, size/variant, product photo, catalog/lookbook/content URL, sales channel URL, photo consistency notes.
LOKKA module: Lookbook (CONDITIONAL) + Product + Variant + Pricing + Media + SalesChannel.
Surface: Admin editor + explicit published public lookbook URL.
Public impact: hanya published lookbook jika diimplementasikan.

3) Legalitas Check Challenge
Evidence: business name, main product/service, NIB/KBLI suitability status, additional legality owned/not-owned, follow-up plan.
LOKKA module: Business Legal Readiness + Legal Checklist + Legal Documents.
Surface: Admin only.
Public impact: none unless separate business disclosure requirement exists.

4) SMEXPO Readiness Challenge
Evidence: business name, main product, SMEXPO account/store status, business profile readiness, product/catalog readiness, store URL or follow-up plan.
LOKKA module: generic SalesChannelReadiness with channel=SMEXPO.
Surface: Admin only.
Public impact: none, except external store URL as an ordinary outbound link when intentionally used.

5) Cash Flow Challenge
Evidence: product/service, sales unit, main costs, selling price, total income, total expense, ending cash balance, improvement plan.
LOKKA module: Finance Transaction + Cash Flow period view + Product/Pricing context.
Surface: Admin only.
Public impact: none.

6) Wajib Pajak Readiness
Evidence: business name, main product/service, tax administration status, turnover/income for selected period, simple tax simulation, follow-up plan.
LOKKA module: Tax Readiness derived from Business + Finance + versioned simulation rule.
Surface: Admin only.
Public impact: none.

7) Product Story Challenge
Evidence: product photo, product name, target market, positioning, product-story usage status, distinctive-characteristic status, unique value, product story.
LOKKA module: ProductStory integrated into Product editing (Brand & Story).
Surface: Admin editor. Optional future public projection only by explicit publish action.
Public impact in initial phase: none.

37. CHALLENGE EVIDENCE VIEW / EXPORT PRINCIPLE

Untuk setiap challenge, LOKKA boleh menyediakan Evidence Summary / Readiness View agar owner mudah menyalin atau mengunggah bukti ke UMK Academy. Namun Evidence View bukan source-of-truth baru.

Pattern:

Business data/domain
      ↓
Readiness/evidence projection
      ↓
Owner review
      ↓
Manual submission ke UMK Academy

Jangan membuat automation submission atau scraping/integration ke UMK Academy tanpa requirement/API resmi.

38. ADMIN TARGET INFORMATION ARCHITECTURE

Dokumentasikan LONG-TERM target architecture sidebar:

Dashboard

Commerce
├── Orders
└── Customers

Products
├── Products
├── Categories
├── Inventory
└── Media

Sales
├── POS
└── Transactions

Finance
├── Overview
├── Global Overhead
├── Cash Flow
├── Income & Expense
└── Accounting Lite

Business Readiness
├── Overview
├── Legal & Compliance
├── Tax Readiness
└── Sales Channels

Reports

Settings
├── Fulfillment
└── Users & Permissions

IMPORTANT: A sidebar item MUST NOT appear until its actual feature exists. Jangan membuat permanent UMK Challenge menus. Brand & Story diintegrasikan ke dalam product editing, bukan sidebar terpisah.

39. IMPLEMENTATION PHASES — CORRECTED

Kerjakan incremental.

PHASE 0 — AUDIT
Existing routes
Auth
Roles/permissions
Admin UI
Public UI
Models/schema
Media
Products
Orders
Inventory
Finance
Deployment/runtime
Tests

        ↓

PHASE A — ADMIN FOUNDATION (COMPLETE)
AdminAuthLayout
Office login page
AdminBackOfficeLayout
Sidebar
Topbar
Breadcrumb
Dashboard shell
Preserve existing admin features

        ↓

PHASE B1 — PRODUCT MEDIA HARDENING
Secure original JPEG/PNG retention
Source metadata
Upload validation
Optimized storefront derivatives
Media-management improvements

Product Showcase adalah evidence preparation layer, bukan mandatory independent application.

        ↓

PHASE B2 — PRODUCT BRAND & STORY
Integrated dengan Product administration

        ↓

PHASE B3 — LEGAL & COMPLIANCE
Including private supporting documents

        ↓

PHASE C — BUSINESS READINESS
Business Readiness foundation
Sales Channel readiness

Fashion Lookbook tetap CONDITIONAL berdasarkan real ongoing LOKKA business requirement.

        ↓

PHASE D — FINANCE FOUNDATION
Normalized financial transaction model
Cash Flow
Income & Expense
Accounting Lite

        ↓

PHASE E — POS
PosLayout
POS sales workflow
Inventory integration
Finance integration
Receipt
Permissions

        ↓

PHASE F — TAX & CHANNEL READINESS
Tax Readiness
Sales Channel / SMEXPO expansion

        ↓

PHASE G — HARDENING
Reports
Permissions review
Audit log where needed
Security
Performance
Regression hardening

Dibanding requirement lama, POS dipisahkan menjadi fase sendiri setelah sales/finance foundation cukup jelas. Struktur ini lebih aman karena POS menyentuh product, inventory, sales, payment, dan finance sekaligus.

40. NEXT IMPLEMENTATION ORDER FROM CURRENT CHECKPOINT

Setelah Product Media/Showcase owner-approved/committed:

1. Phase B2 — Product Story (integrated into Product editing)
2. Phase B3 — Legal Readiness + document checklist/private evidence upload
3. Phase C — Business Readiness foundation + Sales Channel readiness
4. Phase D — normalized Finance → Cash Flow → Income/Expense → Accounting Lite
5. Phase E — POS operational surface
6. Phase F — Tax Readiness + Sales Channel / SMEXPO expansion
7. Phase G — Reports, permission review, audit logging, security/performance/regression hardening

Challenge deadline/order dapat memengaruhi prioritas delivery, tetapi dependency integrity tidak boleh dikorbankan. Jika deadline meminta evidence sebelum module penuh selesai, gunakan evidence projection/manual owner submission dari data authoritative yang sudah ada; jangan membuat duplicate shortcut schema yang menjadi technical debt permanen.

41. PRIORITY UMK ACADEMY

Business tools dibuat sebagai fitur LOKKA reusable.

Jangan membuat satu halaman bernama:

UMK Academy Challenge Submission

sebagai source utama data.

Sebaliknya:

LOKKA Product
      ↓
Product Media Management
      ↓
UMK requirement dapat dipenuhi
LOKKA Finance
      ↓
Cash Flow
      ↓
UMK requirement dapat dipenuhi
LOKKA Business Legal Readiness
      ↓
NIB / KBLI status
      ↓
UMK requirement dapat dipenuhi

Jadi challenge UMK Academy menjadi validation/use-case dari business data LOKKA, bukan arsitektur inti aplikasi.

42. VISUAL REFERENCE

Gunakan dua screenshot yang sudah diberikan sebagai direction.

Login reference

Ambil konsep:

Split screen
Premium corporate
Clean authentication panel
Strong whitespace
Minimal distraction

Jangan clone:

Payoneer logo
Payoneer illustrations
Payoneer assets
Exact colors
Exact typography
Exact copy
Pixel-perfect layout

Dashboard reference

Ambil konsep:

Left office sidebar
Topbar
Dense but clean information layout
KPI cards
Tables
Charts when useful
Professional management workspace

Jangan clone branding atau visual assets dari Nebula.Pay/reference lain.

Identitas akhir harus tetap LOKKA.

43. BEFORE CODING — REQUIRED AUDIT RESPONSE

Sebelum melakukan perubahan source, berikan laporan audit terlebih dahulu dengan format berikut:

1. Existing architecture
2. Existing public routes
3. Existing admin routes
4. Existing POS-related code, if any
5. Existing authentication flow
6. Existing authorization / roles / permissions
7. Existing admin layout/template/components
8. Existing Product schema/domain
9. Existing Variant schema/domain
10. Existing Media/storage architecture
11. Existing Order/OrderItem schema/domain
12. Existing Inventory implementation
13. Existing payment implementation
14. Existing finance/accounting-related implementation
15. Existing Settings/business profile data
16. Existing public navigation
17. Existing tests
18. Files likely to be changed
19. Migrations actually required
20. Regression risks
21. Security risks
22. Recommended implementation plan

Untuk setiap proposed new entity/module, jelaskan:

Why existing entity cannot be reused
Relationship to existing tables
Source of truth
Migration impact
Public exposure risk
Permission requirement

44. IMPLEMENTATION RULE

Setelah audit:

Audit
↓
Plan
↓
Implement Phase A
↓
Test
↓
Lint
↓
Typecheck
↓
Build
↓
Regression verification

Jangan langsung mengerjakan seluruh Phase A–G sekaligus.

Setelah Phase A stabil baru lanjut ke phase berikutnya.

Gunakan test suite project existing.

Jika command project berbeda, baca package.json, workspace configuration, documentation, CI config, dan scripts existing terlebih dahulu.

45. NO-REGRESSION PRINCIPLE

Existing public store dan business functionality yang sudah bekerja harus tetap bekerja.

Jangan mengorbankan existing behavior hanya demi redesign.

Perubahan Admin UI harus sebisa mungkin memisahkan:

Presentation refactor

dari:

Domain behavior modification

Jika perubahan domain memang diperlukan, dokumentasikan alasan serta migration/risk-nya.

46. FINAL ARCHITECTURE TARGET

Target akhir yang harus dijaga:

                         LOKKA
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         ▼                 ▼                 ▼
 PUBLIC WEBSTORE     ADMIN BACK OFFICE      POS
 Customer UX         Office / ERP UX      Cashier UX
         │                 │                 │
         └────────────┬────┴───────┬─────────┘
                      │            │
                      ▼            ▼
                 Shared Domain / Services
                      │
          ┌───────────┼───────────────┐
          ▼           ▼               ▼
       Product      Sales          Customer
          │           │
          ▼           ▼
        Media      Inventory
                      │
                      ▼
                    Finance
                      │
              ┌───────┼────────┐
              ▼       ▼        ▼
          Cash Flow Accounting Tax Readiness
                      │
                      ▼
              Business Readiness

Prinsip final:

Different UI
Shared business logic
Shared source of truth
Explicit permissions
No data duplication without reason
No fake business data
No public exposure of internal data
Incremental implementation
Backward-safe migration
