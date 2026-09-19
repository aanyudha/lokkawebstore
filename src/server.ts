import 'dotenv/config';
import { readEnv } from './config/env.js';
import { buildApp } from './app.js';
import { runtimeIdentity } from './config/identity.js';
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
      app.log.info(
        'LOKKA shutdown complete; HTTP listener and database closed',
      );
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
    const identity = runtimeIdentity(env.nodeEnv, env.appRuntime);
    app.log.info(
      {
        ...identity,
        pid: process.pid,
        host: env.host,
        port: env.port,
        publicUrl: env.appUrl,
      },
      `LOKKA Webstore | Runtime: ${identity.runtime} | Environment: ${identity.environment} | Bind: ${env.host}:${env.port} | Public URL: ${env.appUrl} | Version: ${identity.version} | Commit: ${identity.commit ?? 'unavailable'}${identity.dirty ? ' (dirty)' : ''} | PID: ${process.pid} | Port: ${env.port}`,
    );
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? error.code : undefined;
    const message =
      code === 'EADDRINUSE'
        ? `LOKKA could not start. Port ${env.port} is already in use (EADDRINUSE). Another LOKKA/Node server may still be running. Stop the existing process or configure another port.`
        : 'LOKKA could not start. Server failed to listen.';
    process.stderr.write(`${message}\n`);
    if (env.nodeEnv === 'development' && error instanceof Error) {
      app.log.error(
        { code, detail: error.message, stack: error.stack },
        message,
      );
    }
    await shutdown();
    process.exitCode = 1;
  }
} catch {
  process.stderr.write('Startup failed. Check application configuration.\n');
  process.exitCode = 1;
}
