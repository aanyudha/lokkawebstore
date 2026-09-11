# Fulfillment readiness

`service.ts` owns provider-independent LOKKA origins and resolves product/variant/quantity into actual price (decimal string), unit grams, available stock and default origin. No address is seeded and no stock is reserved. The admin settings route uses existing DB sessions and CSRF protection.

Future Checkout → ShippingService → BiteshipProvider or RajaOngkirProvider. No adapter, quote, booking or AWB is implemented. See [commercial ADR](../../../docs/decisions/003-commercial-pricing-overhead.md).
