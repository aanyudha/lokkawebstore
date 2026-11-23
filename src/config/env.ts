import { readDokuConfig } from '../modules/payments/config.js';

export function resolveDatabaseUrl(
  appRuntime: 'fastify' | 'docker',
  source: NodeJS.ProcessEnv,
): string {
  const key = appRuntime === 'docker' ? 'DATABASE_URL_DOCKER' : 'DATABASE_URL';
  const value = source[key];
  if (!value) throw new Error(`APP_RUNTIME=${appRuntime} requires ${key}.`);
  try {
    const parsed = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !parsed.hostname
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(`Invalid or missing ${key}`);
  }
}

export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv))
    throw new Error('Invalid NODE_ENV');
  const appRuntimeValue = source.APP_RUNTIME ?? 'fastify';
  if (!['fastify', 'docker'].includes(appRuntimeValue))
    throw new Error(
      `Invalid APP_RUNTIME "${appRuntimeValue}". Supported values: fastify, docker.`,
    );
  const appRuntime = appRuntimeValue as 'fastify' | 'docker';
  const port = Number(source.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid PORT');
  function url(key: string, protocols: string[]) {
    try {
      const value = source[key];
      if (!value) throw new Error();
      const parsed = new URL(value);
      if (!protocols.includes(parsed.protocol) || !parsed.hostname)
        throw new Error();
      return value;
    } catch {
      throw new Error(`Invalid or missing ${key}`);
    }
  }
  const trustProxy = source.TRUST_PROXY ?? 'false';
  if (!['true', 'false'].includes(trustProxy))
    throw new Error('Invalid TRUST_PROXY');
  const logLevel = source.LOG_LEVEL ?? 'info';
  if (
    !['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(
      logLevel,
    )
  )
    throw new Error('Invalid LOG_LEVEL');
  const host = source.HOST ?? '0.0.0.0';
  if (!host.trim()) throw new Error('Invalid HOST');
  const lowStockThreshold = Number(source.LOW_STOCK_THRESHOLD ?? '5');
  if (
    !Number.isInteger(lowStockThreshold) ||
    lowStockThreshold < 0 ||
    lowStockThreshold > 2147483647
  )
    throw new Error('Invalid LOW_STOCK_THRESHOLD');
  // Extra development entry points must be named explicitly. They are never
  // used in production, whose only trusted origin is APP_URL.
  const developmentOrigins =
    nodeEnv === 'production'
      ? []
      : (source.DEV_ALLOWED_ORIGINS ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
  for (const value of developmentOrigins) {
    try {
      const parsed = new URL(value);
      if (
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.origin !== value
      )
        throw new Error();
    } catch {
      throw new Error(
        'Invalid DEV_ALLOWED_ORIGINS: use complete HTTP(S) origins without paths or wildcards.',
      );
    }
  }
  const databaseUrl = resolveDatabaseUrl(appRuntime, source);
  const appUrl = url('APP_URL', ['http:', 'https:']);
  const doku = readDokuConfig(source);
  if (
    doku?.environment === 'production' &&
    new URL(appUrl).protocol !== 'https:'
  )
    throw new Error('DOKU production requires an HTTPS APP_URL');
  return {
    nodeEnv,
    appRuntime,
    port,
    host,
    lowStockThreshold,
    catalogStorageRoot:
      source.CATALOG_STORAGE_ROOT ?? 'storage/uploads/catalog',
    logLevel,
    trustProxy: trustProxy === 'true',
    developmentOrigins,
    databaseUrl,
    appUrl,
    doku,
  };
}
export type AppEnv = ReturnType<typeof readEnv>;
