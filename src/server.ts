import 'dotenv/config';
import { readEnv } from './config/env.js';
import { buildApp } from './app.js';
try {
  const env = readEnv();
  const app = await buildApp(env);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => {
      process.exit(1);
    }, 10000).unref();
    try {
      await app.close();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(timeout);
    }
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
  try {
    await app.listen({ host: env.host, port: env.port });
  } catch {
    app.log.error('Server failed to listen');
    await shutdown();
    process.exitCode = 1;
  }
} catch {
  process.stderr.write('Startup failed. Check application configuration.\n');
  process.exitCode = 1;
}
