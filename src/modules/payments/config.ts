import type { DokuConfig } from './doku-provider.js';

export const dokuNotificationPath = '/payments/doku/notification';

export function readDokuConfig(source: NodeJS.ProcessEnv): DokuConfig | null {
  const provider = source.PAYMENT_PROVIDER || 'disabled';
  if (provider === 'disabled') return null;
  if (provider !== 'doku') throw new Error('Invalid PAYMENT_PROVIDER');
  const environment = source.DOKU_ENV ?? 'sandbox';
  if (environment !== 'sandbox' && environment !== 'production')
    throw new Error('Invalid DOKU_ENV');
  const clientId = source.DOKU_CLIENT_ID?.trim();
  const secretKey = source.DOKU_SECRET_KEY;
  if (!clientId || !/^[\x21-\x7e]+$/.test(clientId) || !secretKey?.trim())
    throw new Error('Missing or invalid DOKU credentials');
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
    throw new Error(
      'DOKU_NOTIFICATION_URL must be HTTPS with the configured notification path',
    );
  }
  return { environment, clientId, secretKey, notificationUrl: url.href };
}
