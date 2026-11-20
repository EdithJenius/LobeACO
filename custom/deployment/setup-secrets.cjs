const fs = require('node:fs');
const crypto = require('node:crypto');
if (fs.existsSync('.env')) throw new Error('.env already exists; refusing to replace secrets');
const secret = () => crypto.randomBytes(32).toString('hex');
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const meta = { alg: 'RS256', kid: crypto.randomBytes(8).toString('hex'), use: 'sig' };
const env = {
  APP_URL: 'http://localhost:3210',
  AUTH_SECRET: secret(), KEY_VAULTS_SECRET: crypto.randomBytes(32).toString('base64'),
  POSTGRES_PASSWORD: secret(), GATEWAY_SERVICE_TOKEN: secret(),
  JWKS_KEY: JSON.stringify({ keys: [{ ...privateKey.export({ format: 'jwk' }), ...meta }] }),
  JWKS_PUBLIC_KEY: JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), ...meta }] }),
  RUSTFS_ACCESS_KEY: 'lobeadmin', RUSTFS_SECRET_KEY: secret(),
  S3_ENDPOINT: 'http://localhost:9000',
  AGENT_GATEWAY_URL: 'http://localhost:8787', DEVICE_GATEWAY_URL: 'http://gateway:8788',
  AUTH_EMAIL_VERIFICATION: '0',
};
fs.writeFileSync('.env', Object.entries(env).map(([k,v]) => `${k}='${v}'`).join('\n') + '\n');
fs.writeFileSync('searxng-settings.yml', `use_default_settings: true\nserver:\n  secret_key: ${secret()}\n  limiter: false\nsearch:\n  formats: [html, json]\n`);
console.log('Created local deployment secrets (values not printed).');
