#!/usr/bin/env node
// Creates any missing .env files from their .env.example templates and gives
// apps/api/.env a real ENCRYPTION_KEY. Existing .env files are never overwritten.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dirs = ['.', 'apps/api', 'apps/dashboard', 'apps/admin'];

for (const dir of dirs) {
  const example = path.join(root, dir, '.env.example');
  const target = path.join(root, dir, '.env');
  if (!fs.existsSync(example) || fs.existsSync(target)) continue;
  fs.copyFileSync(example, target);
  console.log(`created ${path.relative(root, target)}`);
}

const apiEnv = path.join(root, 'apps/api/.env');
if (fs.existsSync(apiEnv)) {
  const text = fs.readFileSync(apiEnv, 'utf8');
  const placeholder = /^ENCRYPTION_KEY=0{64}\s*$/m;
  if (placeholder.test(text)) {
    const key = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(apiEnv, text.replace(placeholder, `ENCRYPTION_KEY=${key}`));
    console.log('generated ENCRYPTION_KEY in apps/api/.env');
  }
}
