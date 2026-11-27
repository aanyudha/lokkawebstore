import type { DokuConfig } from './doku-provider.js';

export const dokuNotificationPath = '/payments/doku/notification';

export class PaymentConfigurationError extends Error {}

export function assertLocalPaymentEnvironment(nodeEnv: string) {
  if (nodeEnv === 'production')
    throw new PaymentConfigurationError(
      'PAYMENT_PROVIDER=local is development/test only and cannot run in production.',
    );
}

export function readPaymentMode(source: NodeJS.ProcessEnv, nodeEnv: string) {
  const mode = source.PAYMENT_PROVIDER || 'disabled';
  if (mode !== 'disabled' && mode !== 'local' && mode !== 'doku')
    throw new PaymentConfigurationError(
      'Invalid PAYMENT_PROVIDER. Use disabled, local or doku.',
    );
  if (mode === 'local') assertLocalPaymentEnvironment(nodeEnv);
  return mode;
}

export function paymentReadiness(
  source: NodeJS.ProcessEnv,
  doku: DokuConfig | null,
  local: boolean,
) {
  return {
    provider: local
      ? 'Local development'
      : !doku
        ? 'Disabled'
        : doku.environment === 'sandbox'
          ? 'DOKU Sandbox'
          : 'DOKU Production',
    notificationConfigured: Boolean(source.DOKU_NOTIFICATION_URL?.trim()),
    credentialsConfigured: Boolean(
      source.DOKU_CLIENT_ID?.trim() && source.DOKU_SECRET_KEY?.trim(),
    ),
    ...(local ? { developmentOnly: true } : {}),
  };
}

export type PaymentReadiness = ReturnType<typeof paymentReadiness>;

export function readDokuConfig(source: NodeJS.ProcessEnv): DokuConfig | null {
  const provider = source.PAYMENT_PROVIDER || 'disabled';
  if (provider === 'disabled') return null;
  if (provider !== 'doku')
    throw new PaymentConfigurationError(
      'Invalid PAYMENT_PROVIDER. Use disabled or doku.',
    );
  const environment = source.DOKU_ENV ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production')
    throw new PaymentConfigurationError(
      'Invalid DOKU_ENV. Use sandbox or production.',
    );
  const clientId = source.DOKU_CLIENT_ID?.trim();
  const secretKey = source.DOKU_SECRET_KEY;
  if (!clientId || !/^[A-Za-z0-9_-]{1,128}$/.test(clientId))
    throw new PaymentConfigurationError('Missing or invalid DOKU_CLIENT_ID.');
  if (!secretKey?.trim())
    throw new PaymentConfigurationError('Missing DOKU_SECRET_KEY.');
  let url: URL;
  try {
    url = new URL(source.DOKU_NOTIFICATION_URL ?? '');
    if (
      url.protocol !== 'https:' ||
      url.pathname !== dokuNotificationPath ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
  } catch {
    throw new PaymentConfigurationError(
      `DOKU_NOTIFICATION_URL must be an HTTPS URL at ${dokuNotificationPath} without credentials, query or fragment.`,
    );
  }
  return { environment, clientId, secretKey, notificationUrl: url.href };
}
