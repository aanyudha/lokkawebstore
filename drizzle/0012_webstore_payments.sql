ALTER TYPE web_order_status ADD VALUE 'PAID';
--> statement-breakpoint
ALTER TYPE finance_category ADD VALUE 'WEBSTORE_ORDER';
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN order_id uuid UNIQUE REFERENCES orders(id);
--> statement-breakpoint
ALTER TABLE sales ADD COLUMN shipping_amount bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TYPE web_payment_status AS ENUM ('CREATED', 'PENDING', 'PAID', 'FAILED', 'EXPIRED', 'CANCELLED', 'REVIEW');
--> statement-breakpoint
CREATE TABLE payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL,
  merchant_invoice_number text NOT NULL,
  sequence integer NOT NULL,
  request_id text NOT NULL,
  provider_reference text,
  amount bigint NOT NULL,
  currency text NOT NULL,
  status web_payment_status NOT NULL DEFAULT 'CREATED',
  checkout_url text,
  expires_at timestamptz,
  paid_at timestamptz,
  failed_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_attempt_money_valid CHECK (amount > 0 AND currency = 'IDR')
);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_provider_invoice_uidx ON payment_attempts(provider, merchant_invoice_number);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_provider_request_uidx ON payment_attempts(provider, request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_order_sequence_uidx ON payment_attempts(order_id, sequence);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_order_active_uidx ON payment_attempts(order_id) WHERE status IN ('CREATED', 'PENDING');
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_order_paid_uidx ON payment_attempts(order_id) WHERE status = 'PAID';
--> statement-breakpoint
CREATE TABLE payment_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  attempt_id uuid REFERENCES payment_attempts(id),
  merchant_invoice_number text NOT NULL,
  original_request_id text NOT NULL,
  request_timestamp timestamptz NOT NULL,
  occurred_at timestamptz NOT NULL,
  amount bigint NOT NULL,
  currency text,
  outcome text NOT NULL,
  provider_status text NOT NULL,
  result text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_notifications_event_uidx ON payment_notifications(provider, event_id);
--> statement-breakpoint
CREATE INDEX payment_notifications_attempt_idx ON payment_notifications(attempt_id);
