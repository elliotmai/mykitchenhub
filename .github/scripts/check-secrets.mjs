#!/usr/bin/env node
/*
 * CI guard: fail the build if a credential is committed.
 *
 * This is a targeted scan for high-signal patterns (private keys, provider API
 * keys), not a general entropy scanner — the goal is zero false positives so
 * the check stays trustworthy and nobody learns to ignore it.
 *
 * KNOWN_EXPOSED lists files that already contain live credentials and are being
 * rotated out of band. They are skipped so this check reports *new* leaks
 * rather than re-reporting a known one on every run. Remove entries from that
 * list once the files are gone.
 */
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const KNOWN_EXPOSED = new Set([
  'functions/service-account.json',
  'functions/legacy-firebase-service-account.json',
]);

const SKIP_DIRS = /(^|\/)(node_modules|build|coverage|\.git|playwright-report|test-results)\//;
const SKIP_FILES = /(package-lock\.json|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.ico|\.woff2?|\.map)$/i;

// Each pattern needs to be specific enough that a test fixture or a comment
// won't trip it.
const PATTERNS = [
  { name: 'PEM private key', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'GCP service account private key', re: /"private_key"\s*:\s*"-----BEGIN/ },
  { name: 'Anthropic API key', re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: 'OpenAI API key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Firebase CI token', re: /\b1\/\/[A-Za-z0-9_-]{50,}\b/ },
];

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => !SKIP_DIRS.test(f) && !SKIP_FILES.test(f));

const findings = [];
const skipped = [];

for (const file of trackedFiles) {
  if (KNOWN_EXPOSED.has(file)) {
    skipped.push(file);
    continue;
  }

  let contents;
  try {
    // Skip anything large enough to be a binary or a vendored bundle.
    if (statSync(file).size > 2_000_000) continue;
    contents = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const { name, re } of PATTERNS) {
    const match = contents.match(re);
    if (!match) continue;

    const line = contents.slice(0, match.index).split('\n').length;
    findings.push({ file, line, name });
  }
}

if (skipped.length > 0) {
  console.log('⚠ Skipped files with known-exposed credentials pending rotation:');
  skipped.forEach((f) => console.log(`    - ${f}`));
  console.log('');
}

if (findings.length > 0) {
  console.error('✗ Credentials found in tracked files:\n');
  findings.forEach(({ file, line, name }) => console.error(`    ${file}:${line} — ${name}`));
  console.error('');
  console.error('  Remove the credential, rotate it, and load it from an environment');
  console.error('  variable or GitHub secret instead.');
  process.exit(1);
}

console.log(`✓ No new credentials found across ${trackedFiles.length} tracked files.`);
