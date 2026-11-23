# Webstore payment

`PaymentService` initiates DOKU Checkout from the existing E2 order detail.
Only the owning customer can initiate payment for a pending WEBSTORE order
with saved delivery facts. The amount is the stored whole-rupiah grand total.
DokuProvider maps requests and responses and authenticates notifications.
Payment-method selection takes place on the hosted DOKU page.

## Configuration

Set `PAYMENT_PROVIDER=doku`, `DOKU_ENV=sandbox`, `DOKU_CLIENT_ID`,
`DOKU_SECRET_KEY` and `DOKU_NOTIFICATION_URL` in the runtime environment.
Payments default to disabled and only the explicit `DOKU_ENV=production`
selects the production API. Production requires an HTTPS `APP_URL`.
Localized return URLs are built from `APP_URL` and the saved order number.
Keep credentials in private runtime configuration. The Docker runtime overlay
passes the same variables to the application container.

Set a public HTTPS URL ending in `/payments/doku/notification` and configure
that URL for the applicable DOKU dashboard channels. DOKU must be able to reach
the URL externally. Confirm that sandbox channels support the Checkout payload,
and keep abandoned-cart recovery disabled to allow a fresh attempt after expiry.

## Payment attempts and receipts

- `0012_webstore_payments.sql` created payment attempts, notification receipts,
  and the order-linked sale fields. Its existing history and E2 migration
  `0013` are preserved. Additive migration `0014` binds new attempts to the
  configured provider environment and merchant. Existing unbound attempts
  require reconciliation with their original account.
- An order lock serializes initiation. The service records the attempt before
  sending the request. It uses a UUID request ID and an alphanumeric invoice
  derived from the canonical WEB order number and attempt sequence. A pending
  link is reused and an expired session gets a new invoice. A timeout or
  ambiguous provider response preserves the original attempt for reconciliation.
- `POST /payments/doku/notification` checks Client-Id and a constant-time HMAC
  comparison over the signed headers, URL path and SHA-256 digest of the raw
  body. The original request ID, invoice, provider account, amount, and currency
  when supplied must match. The event ID protects delayed and manual retries.
  Signed Checkout method declines are recorded and leave the session payable
  until provider expiry. Browser returns display stored status.
- Recognized success posts the WEBSTORE sale, its historical item costs, one
  `WEBSTORE_ORDER` Cash Flow receipt and inventory movements in one transaction.
  Accounting Lite shows merchandise and charged shipping separately. Unknown
  item cost remains unavailable. An additional success for an older attempt
  enters reconciliation without additional posting.
- If stock is unavailable at confirmation, the signed receipt is recorded for
  review, further initiation is held, and the endpoint returns HTTP 503. Restore
  valid stock and resend the original notification to complete posting. For
  HTTP 401, check merchant credentials and the configured URL path. For HTTP
  404 or 409, compare the invoice, original request ID and amount in DOKU
  notification history with the stored attempt.

Integration tests use disposable PostgreSQL and mock the provider transport.
The browser test exercises E2 checkout through DOKU redirect and a signed
notification. For sandbox acceptance, use the DOKU simulator and a public HTTPS
notification endpoint before enabling a live merchant.

- [DOKU Checkout backend integration](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration)
- [DOKU notification verification](https://developers.doku.com/get-started-with-doku-api/notification/best-practice)
- [DOKU retry behavior](https://developers.doku.com/get-started-with-doku-api/notification/retry-notification)
- [DOKU sandbox simulator](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification)
