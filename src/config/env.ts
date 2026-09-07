export function readEnv(source: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = source.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv))
    throw new Error('Invalid NODE_ENV');
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
  const host = source.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('Invalid HOST');
  return {
    nodeEnv,
    port,
    host,
    logLevel,
    trustProxy: trustProxy === 'true',
    databaseUrl: url('DATABASE_URL', ['postgres:', 'postgresql:']),
    appUrl: url('APP_URL', ['http:', 'https:']),
  };
}
export type AppEnv = ReturnType<typeof readEnv>;
