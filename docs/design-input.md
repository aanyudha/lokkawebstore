# Owner concept review

Reviewed docs/basic_concept recursively: English and Indonesian architecture specifications in Markdown and corresponding Word editions. The source files remain unchanged and excluded from automatic formatting.

These are architecture/product specifications, not a detailed visual style guide. They require SSR, mobile performance, optimized imagery, indexable product/category content, clear vendor ownership, safe administration and modular integration boundaries. They specify no typeface, exact spacing, palette, logo dimensions or detailed homepage composition. The Indonesian edition informs /kategori and /produk route language.

The UI retains the original warm ivory/sand/batik tokens, Georgia editorial headings and system sans-serif text. A restrained header uses the owner's logo at its intrinsic 2:1 ratio (4000 × 2000 source pixels), rendered at 120–180 pixels wide according to context. Category navigation exposes only actual active root categories plus Koleksi, wraps on small screens and requires no menu JavaScript. No nonfunctional account/cart/search controls appear.

Collections use 2/3/4-column responsive grids, 4:5 image areas, product names, exact IDR prices and supported featured labels. Product descriptions, variant tables and availability remain usable without JavaScript. Small radio-button enhancement updates the displayed variant. Admin is simpler, with explicit labels, error summaries and responsive forms. The homepage is a short brand introduction directing visitors to the catalog, without invented campaigns or copied photography.

Broader concept features—marketplace/vendor pages, Redis, S3 deployment, cart, checkout, payments, shipments, customers, orders, reservations, reviews, coupons and editorial publishing—are explicitly deferred by the Milestone 2 scope. LOKKA ownership is displayed on product pages; vendor-storefront links are deferred because no such route exists yet.

The untouched official PNG is 32,053,161 bytes (about 30.6 MiB). Browser checks confirm correct aspect ratio and small rendered size, but its first-load transfer remains expensive. A future owner-approved optimized brand export would improve performance; this milestone does not alter or duplicate the supplied logo.
