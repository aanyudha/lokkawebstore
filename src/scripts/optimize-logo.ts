import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

async function main() {
  const inputPath = resolve('public/images/lokka_logo.png');
  const outputDir = resolve('public/images/brand');
  const outputPath = resolve(outputDir, 'lokka-logo.webp');

  mkdirSync(outputDir, { recursive: true });

  const inputStat = statSync(inputPath);
  console.log(`Original: ${inputPath}`);
  console.log(
    `Original size: ${inputStat.size} bytes (${(inputStat.size / 1024 / 1024).toFixed(1)} MB)`,
  );

  const input = readFileSync(inputPath);
  const meta = await sharp(input).metadata();
  console.log(`Original dimensions: ${meta.width} x ${meta.height}`);
  console.log(`Aspect ratio: ${(meta.width! / meta.height!).toFixed(2)}`);

  const output = await sharp(input)
    .resize({ width: 800, withoutEnlargement: true })
    .webp({ quality: 90 })
    .toBuffer();

  const outMeta = await sharp(output).metadata();
  console.log(`Optimized dimensions: ${outMeta.width} x ${outMeta.height}`);
  console.log(
    `Optimized size: ${output.length} bytes (${(output.length / 1024).toFixed(1)} KB)`,
  );
  console.log(
    `Size reduction: ${((1 - output.length / inputStat.size) * 100).toFixed(1)}%`,
  );

  writeFileSync(outputPath, output);
  console.log(`Written to: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
