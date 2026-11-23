# cart

Login-required customer carts, with one durable cart per customer. Items reference
canonical variants and hold quantity only; prices always come from the catalog.
There is no guest cart or merge. Guests may browse and are sent to customer login
when adding an item; they add the item after signing in.

All mutations serialize on the cart row, rotate its revision, and explicitly
update timestamps. Add merges quantities for the same variant; update replaces
quantity; remove is ownership scoped. Quantity is a positive PostgreSQL integer.
Product and variant status and available stock are revalidated on add/update.
Unavailable existing items remain visible and removable. Cart totals use bigint
and cannot authorize a purchase; only the order service creates snapshots.

EN routes: `/cart`, `/cart/items`, `/cart/items/:id/update`,
`/cart/items/:id/remove`, `/cart/review`, `/cart/orders`.
ID equivalents use `/id/keranjang`. The review page links the cart to delivery
selection and order review. See the [checkout contract](../checkout/README.md).
GETs render pages. Mutations use POST.
Customer DB sessions, session-bound CSRF and the global origin policy protect
mutations. Admin/POS cookies do not provide customer identity.

Neither carts nor pending orders reserve stock. No inventory movement, stock
deduction, payment or finance write occurs here.
