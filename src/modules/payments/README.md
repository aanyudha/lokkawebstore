# Webstore payments

PaymentService stores an attempt before making a provider request. DokuProvider
translates that request to Checkout, signs the exact JSON bytes, and verifies
notifications before parsing them. The service reads the amount from the
locked order and requires the checkout caller to validate eligibility using the
order's saved shipping facts.

This checkout has E1 cart and order creation. Customer payment initiation
requires the E2 address and shipping snapshots and has no public storefront
entry point here. The existing order detail and localized payment return routes
display the state of recorded attempts. The return routes read server state and
ignore query parameters claiming payment success.

## Configuration

Payments are disabled by default. After the checkout prerequisite is available,
set `PAYMENT_PROVIDER=doku`, `DOKU_ENV=sandbox`, `DOKU_CLIENT_ID`,
`DOKU_SECRET_KEY`, and `DOKU_NOTIFICATION_URL`. The notification URL must use
public HTTPS and end in `/payments/doku/notification`. Configure the same URL in
DOKU's dashboard for the enabled channels. Only an explicit
`DOKU_ENV=production` selects the production API. Configure `APP_URL` with the
storefront origin for the localized customer return page. Keep Checkout's
abandoned-cart recovery disabled in the DOKU dashboard when allowing a new
attempt after expiry.

## Notifications, idempotency, and accounting

- DOKU posts to `POST /payments/doku/notification` without a customer session.
  Verification covers the Client-Id, Request-Id, UTC Request-Timestamp, route
  path and SHA-256 digest of the raw body. DOKU supports delayed and manual
  retries. Durable event identity guards replays without a short freshness
  window. The invoice, original DOKU request ID and whole-rupiah amount must
  match the recorded attempt and order. Currency is checked when present.
- Each session uses a UUID request ID and an alphanumeric invoice derived
  deterministically from the order number and attempt sequence. Retries while
  the session is active reuse its URL. A confirmed expiry permits a new invoice
  and preserves the previous attempt. A timeout or ambiguous provider response
  keeps the original attempt open for reconciliation.
- DOKU Checkout may send `FAILED` while the hosted page still supports another
  method. The receipt is recorded and the session remains available until the
  returned checkout expiry. Payment recognition requires a verified success.
- A verified success posts the completed WEBSTORE sale, historical item costs,
  inventory movements and one Cash Flow entry in the same transaction. The
  `WEBSTORE_ORDER` entry carries the full receipt. The linked sale retains
  merchandise subtotal, discount and shipping charged, and Accounting Lite
  reports the shipping component separately. A null cost snapshot retains
  unavailable COGS. An additional success on an older attempt records a
  reconciliation exception.
- If inventory is unavailable at confirmation, the signed receipt and payment
  review state are preserved. The webhook responds with HTTP 503 so the provider
  can retry. Restoring valid stock and resending the notification allows the
  original transaction to complete. Inspect provider invoice, request and
  notification IDs when diagnosing HTTP 404 or 409 responses.

## Local verification

Run the provider and payment integration tests on disposable PostgreSQL. The
Playwright payment-return test uses a mocked DOKU network boundary and seeded
order totals. For owner sandbox acceptance, use the DOKU simulator and a public
HTTPS callback route. Configure channel-specific settings using a sandbox
merchant account and confirm receipt in the DOKU notification history.

- [Checkout backend integration](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration)
- [DOKU notification guidance](https://developers.doku.com/get-started-with-doku-api/notification/best-practice)
- [Notification retries](https://developers.doku.com/get-started-with-doku-api/notification/retry-notification)
- [DOKU simulator](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification)
