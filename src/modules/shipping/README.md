# Fulfillment readiness

`service.ts` owns provider-independent LOKKA origins and resolves product/variant/quantity into actual price (decimal string), unit grams, available stock and default origin. No address is seeded and no stock is reserved. The admin settings route uses existing DB sessions and CSRF protection.

E2 checkout uses flat rates from `methods.ts`, managed in **Settings →
Fulfillment**. Checkout requires an active default LOKKA origin and an active
method. Staff can edit delivery details or deactivate the method. Orders
retain the selected method details, shipment weight and rate at placement.
See the [checkout contract](../checkout/README.md).
