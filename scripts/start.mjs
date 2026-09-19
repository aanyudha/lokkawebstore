import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';
import { planStart } from './runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function main() {
  let plan;
  try {
    plan = planStart();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  if (plan.kind === 'docker') {
    console.info(
      '[lokka] APP_RUNTIME=docker. Ensuring the LOKKA application container is running.',
    );
    const result = spawnSync(plan.command, plan.args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    if (result.error) {
      process.stderr.write(
        `[lokka] Docker is unavailable (${result.error.message}). Start the Docker engine, then run npm start again.\n`,
      );
      process.exitCode = 1;
      return;
    }
    process.exitCode = result.status ?? 1;
    return;
  }

  console.info(
    '[lokka] APP_RUNTIME=fastify. Starting the compiled LOKKA application.',
  );
  const child = spawnSync(plan.command, plan.args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (child.error) {
    process.stderr.write(
      `[lokka] Could not start LOKKA (${child.error.message}).\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.exitCode = child.status ?? 1;
}

main();
