import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readEnv } from '../../config/env.js';
import { createDatabase } from '../../db/client.js';
import { adminUsers } from '../../db/schema/index.js';
import { hashPassword, normalizeEmail } from './service.js';
function secret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error('Use an interactive terminal.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('data', onData);
      process.stdout.write('\n');
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\u0003') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ' && value.length < 129) value += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}
try {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  const email = normalizeEmail(values.email ?? '');
  const name = values.name?.trim();
  if (!name || name.length > 150)
    throw new Error('Provide --name (1–150 characters).');
  const password = await secret('Password (12–128 characters): ');
  if (password !== (await secret('Confirm password: ')))
    throw new Error('Passwords do not match.');
  const passwordHash = await hashPassword(password);
  const database = createDatabase(readEnv().databaseUrl);
  try {
    await database.db.insert(adminUsers).values({ email, name, passwordHash });
    process.stdout.write('Admin created.\n');
  } catch {
    throw new Error(
      'Could not create admin. Check database availability and unique email.',
    );
  } finally {
    await database.close();
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'Admin creation failed.'}\n`,
  );
  process.exitCode = 1;
}
