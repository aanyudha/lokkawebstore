/** Trusted public origins only. Request Host/Referer/forwarding headers never
 * create an allowance. Missing Origin retains the existing CSRF-protected
 * non-browser request policy; a present malformed Origin is rejected. */
export function createOriginValidator(config: {
  appUrl: string;
  nodeEnv: string;
  developmentOrigins?: readonly string[];
}) {
  const canonical = new URL(config.appUrl).origin;
  const allowed = new Set([canonical]);
  if (config.nodeEnv !== 'production') {
    for (const origin of config.developmentOrigins ?? []) allowed.add(origin);
    // The two intentional local development names share only their configured
    // protocol and port. No other loopback address or port is inferred.
    for (const origin of [...allowed]) {
      const alias = new URL(origin);
      if (alias.hostname === 'localhost') alias.hostname = '127.0.0.1';
      else if (alias.hostname === '127.0.0.1') alias.hostname = 'localhost';
      else continue;
      allowed.add(alias.origin);
    }
  }
  return (origin: unknown): boolean => {
    if (origin === undefined) return true;
    if (typeof origin !== 'string') return false;
    try {
      const parsed = new URL(origin);
      return (
        ['http:', 'https:'].includes(parsed.protocol) &&
        origin === parsed.origin &&
        allowed.has(parsed.origin)
      );
    } catch {
      return false;
    }
  };
}
