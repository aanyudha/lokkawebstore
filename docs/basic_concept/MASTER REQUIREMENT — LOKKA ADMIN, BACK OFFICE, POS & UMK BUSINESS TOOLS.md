MASTER REQUIREMENT — LOKKA ADMIN, BACK OFFICE, POS & UMK BUSINESS TOOLS

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

Target grouping:

Dashboard

Commerce
  Orders
  Customers

Products
  Products
  Categories
  Product Story
  Product Showcase
  Lookbook

Sales
  POS
  Transactions

Finance
  Overview
  Cash Flow
  Income & Expense
  Accounting Lite

Business Readiness
  Overview
  Legalitas
  Tax Readiness
  Marketplace / SMEXPO

Reports

Settings

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

8. PRODUCT STORY MODULE

Implementasikan sebagai business feature reusable, bukan “form tugas UMK Academy”.

UMK Academy membutuhkan informasi Product Story berupa product, foto produk, nama produk, target pasar, positioning, status penggunaan cerita produk, status ciri khas produk, unique value, dan product story. Requirement tersebut memang berasal dari challenge yang sudah dirumuskan sebelumnya.

Model konseptual harus mereferensikan Product existing.

Jangan menduplikasi data yang sudah authoritative.

Contoh:

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

Nama produk dan product photo sebaiknya diambil dari Product/Media existing kecuali ada kebutuhan snapshot historis yang jelas.

Status dapat berupa konsep:

draft
active
archived

tetapi ikuti enum convention existing.

9. LEGALITAS / BUSINESS LEGAL READINESS

Buat legal readiness sebagai reusable checklist.

Parameter UMK Academy:

Business name
Main product/service
NIB status
NIB number
KBLI
NIB/KBLI suitability status
Additional licenses owned
Required licenses not yet owned
Follow-up / action plan
Notes

Jangan hard-code sebagai:

UMKAcademyChallengeLegalitas

Gunakan domain generik seperti:

BusinessLegalReadiness
LegalDocument
LegalRequirement
LegalChecklist

setelah menyesuaikan schema existing.

Status reusable:

not_started
in_progress
complete
not_applicable

atau existing convention equivalent.

10. PRODUCT SHOWCASE

Ini merupakan salah satu prioritas implementasi awal karena terkait challenge UMK Academy yang waktunya paling dekat.

Kebutuhan challenge:

5 product photos
JPG / PNG
High resolution
Product shown clearly

Requirement awal memang menetapkan upload lima foto produk dengan validasi tipe file dan menggunakan media system yang sudah ada.

Admin Product Showcase harus dapat:

Select Product
Select/upload media
Preview
Reorder images
Set cover/primary image
Remove image
Readiness status

Reuse media/storage architecture existing.

Jangan membuat folder/storage/upload service baru jika Media service sudah tersedia.

Server harus memvalidasi file sebenarnya.

Jangan hanya mempercayai:

extension
browser-provided MIME
client-side validation

Mode readiness UMK Academy dapat memeriksa:

>= 5 valid images
JPG/PNG
image readable
minimum acceptable resolution jika rule memang ditetapkan

Jangan menentukan minimum pixel resolution secara arbitrer jika UMK Academy tidak memberikan angka resmi.

11. FASHION LOOKBOOK

Data yang diperlukan UMK Academy mencakup:

Product name
Price
Size / variant
Product photo
Catalog/lookbook/content URL
Sales channel URL
Photo consistency notes

Sebagian besar data harus berasal dari Product, Variant, Pricing, Media, dan Sales Channel existing.

Admin capabilities:

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

12. SALES DOMAIN — SINGLE SOURCE OF TRUTH

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

13. POS — PROTECTED OPERATIONAL WORKSPACE

Ini menggantikan requirement lama “POS hanya backend/admin”.

POS adalah operational frontend/workspace khusus kasir.

Route:

/pos

POS tidak muncul di navigation public.

POS bukan storefront.

POS bukan halaman CRUD admin biasa.

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

14. POS & INVENTORY

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

15. POS & FINANCE

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

16. CASH FLOW

Parameter UMK Academy yang harus dapat direpresentasikan:

Product/service
Sales unit
Main costs
Selling price
Total income
Total expense
Ending cash balance
Improvement plan

Cash Flow module harus reusable dan tidak bergantung pada challenge. Parameter itu berasal dari challenge Cash Flow yang sudah dicatat sebelumnya.

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

17. ACCOUNTING LITE

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

Requirement awal juga menekankan agar Accounting Lite mengambil source-of-truth transaksi/order dan tidak melakukan input ulang.

18. TAX READINESS

Tax Readiness bukan official tax engine.

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

Requirement awal juga secara eksplisit menetapkan bahwa Tax Readiness bukan tax filing engine dan tarif tidak boleh di-hard-code ke core logic.

19. MARKETPLACE / SMEXPO READINESS

Jangan membuat module yang hanya dapat digunakan oleh Pertamina SMEXPO.

Gunakan konsep generic:

SalesChannel
SalesChannelReadiness

Parameter challenge dapat direpresentasikan sebagai:

Business
Main product
Channel
Account/store status
Business profile readiness
Catalog/product readiness
Store URL
Notes
Follow-up plan

Channel awal dapat mencakup:

SMEXPO
LOKKA Website

dan dapat diperluas kemudian.

Requirement awal memang meminta model ini dibuat generic dan tidak hard-coded hanya untuk SMEXPO.

20. BUSINESS READINESS ENGINE

Business Readiness harus menjadi aggregation layer atas data nyata.

Target kategori:

Product
Product Story
Product Showcase
Lookbook
Legalitas
Finance
Tax
Marketplace

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

Requirement awal juga menyatakan readiness percentage tidak boleh hard-coded dan harus berasal dari rules yang jelas.

21. ADMIN DASHBOARD HOME

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

Requirement awal juga menetapkan dashboard harus menggunakan data nyata dan tidak menampilkan fake graph/sample production data.

22. DATA OWNERSHIP

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

Lookbook
→ selection/presentation layer

Product Story
→ product marketing metadata

Jangan menyalin nilai Product ke lima tabel berbeda hanya supaya form challenge mudah dibuat.

Jika perlu snapshot karena kebutuhan historical/audit, dokumentasikan alasannya.

23. DATABASE & MIGRATION

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

24. SECURITY

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

Security requirement ini konsisten dengan requirement awal yang mewajibkan admin route, role checks, upload validation, serta tidak mengekspos data finance/tax/legalitas ke public API.

25. ROUTING BOUNDARY

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

26. REUSABLE DOMAIN/SERVICE LAYER

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

27. ERROR, EMPTY & LOADING STATES

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

28. AUDIT LOG CONSIDERATION

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

29. POS PAYMENT SCOPE

Pada initial POS jangan menambahkan payment gateway baru hanya untuk menyelesaikan POS.

Payment method bisa mulai dari method yang memang supported.

Contoh konseptual:

Cash
Bank Transfer
Existing supported digital payment
Other configured method

Payment integration baru harus menjadi requirement terpisah setelah audit infrastructure.

30. REPORTS

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

31. IMPLEMENTATION PHASES — REFACTORED

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

PHASE A — ADMIN FOUNDATION
AdminAuthLayout
Office login page
AdminBackOfficeLayout
Sidebar
Topbar
Breadcrumb
Dashboard shell
Preserve existing admin features

        ↓

PHASE B — UMK PRODUCT READINESS
Product Showcase
Product Story
Legalitas

        ↓

PHASE C — CATALOG / READINESS
Lookbook
Business Readiness aggregation

        ↓

PHASE D — FINANCE FOUNDATION
Normalized financial transaction model
Cash Flow
Income/Expense
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
Sales Channel / SMEXPO Readiness

        ↓

PHASE G — HARDENING
Reports
Permissions review
Audit log where needed
Performance
Responsive QA
Security QA
Regression testing

Dibanding requirement lama, saya sengaja memisahkan POS menjadi fase sendiri setelah sales/finance foundation cukup jelas. Pada dokumen sebelumnya POS berada bersama Tax/Marketplace di Phase E; struktur baru ini lebih aman karena POS menyentuh product, inventory, sales, payment, dan finance sekaligus. Requirement lama memang mengatur implementasi incremental dan audit sebelum coding.

32. PRIORITY UMK ACADEMY

Business tools dibuat sebagai fitur LOKKA reusable.

Jangan membuat satu halaman bernama:

UMK Academy Challenge Submission

sebagai source utama data.

Sebaliknya:

LOKKA Product
      ↓
Product Showcase
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

33. VISUAL REFERENCE

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

Requirement original juga secara eksplisit meminta screenshot tersebut hanya sebagai visual direction dan melarang cloning logo/aset/desain pihak lain.

34. BEFORE CODING — REQUIRED AUDIT RESPONSE

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
35. IMPLEMENTATION RULE

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

Jangan langsung mengerjakan seluruh Phase A–F sekaligus.

Setelah Phase A stabil baru lanjut ke phase berikutnya.

Gunakan test suite project existing.

Jika command project berbeda, baca package.json, workspace configuration, documentation, CI config, dan scripts existing terlebih dahulu.

36. NO-REGRESSION PRINCIPLE

Existing public store dan business functionality yang sudah bekerja harus tetap bekerja.

Jangan mengorbankan existing behavior hanya demi redesign.

Perubahan Admin UI harus sebisa mungkin memisahkan:

Presentation refactor

dari:

Domain behavior modification

Jika perubahan domain memang diperlukan, dokumentasikan alasan serta migration/risk-nya.

37. FINAL ARCHITECTURE TARGET

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
Satu koreksi penting terhadap prompt lama

Bagian lama:

Semua fitur internal berikut hanya boleh tersedia setelah login melalui area /admin: POS ...

dan:

POS hanya backend/admin.

HARUS DIANGGAP SUDAH TIDAK BERLAKU.

Ganti definisinya dengan:

POS adalah protected operational application surface dalam codebase LOKKA yang menggunakan URL dan layout tersendiri. POS tidak ditampilkan dalam navigation public dan bukan customer-facing feature. POS menggunakan authentication/authorization internal LOKKA serta shared product, sales, inventory, payment, dan finance domain. Admin Back Office dapat menyediakan shortcut internal menuju POS, tetapi tidak boleh mempunyai implementasi POS kedua.