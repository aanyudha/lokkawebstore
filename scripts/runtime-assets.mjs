import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function copyTranslations(source, destination, supportedLocales) {
  const files = (await readdir(source)).filter((name) =>
    name.endsWith('.json'),
  );
  for (const locale of supportedLocales) {
    if (!files.includes(`${locale}.json`)) {
      throw new Error(`Missing required translation resource: ${locale}.json`);
    }
  }
  // Validate every JSON resource before copying any, including future locales.
  for (const file of files) {
    const resource = JSON.parse(await readFile(join(source, file), 'utf8'));
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      throw new Error(`Translation resource must be an object: ${file}`);
    }
  }
  await mkdir(destination, { recursive: true });
  for (const file of files) {
    await copyFile(join(source, file), join(destination, file));
    const copied = await readFile(join(destination, file));
    if (!copied.equals(await readFile(join(source, file)))) {
      throw new Error(`Runtime translation copy differs: ${file}`);
    }
    JSON.parse(copied.toString('utf8'));
  }
}
