#!/usr/bin/env node

'use strict';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

function hasVersion(result, version) {
  return result.status === 200
    && typeof result.body === 'object'
    && result.body !== null
    && typeof result.body.versions === 'object'
    && result.body.versions !== null
    && Object.prototype.hasOwnProperty.call(result.body.versions, version);
}

function assertExpectedStatus(result, label) {
  if (result.status !== 200 && result.status !== 404) {
    const detail = typeof result.body === 'string'
      ? result.body
      : JSON.stringify(result.body);
    throw new Error(`${label} registry lookup returned HTTP ${result.status}: ${detail.slice(0, 500)}`);
  }
}

function classifyRegistryState(publicResult, writeResult, version) {
  assertExpectedStatus(publicResult, 'Public');
  if (hasVersion(publicResult, version)) return 'public';

  assertExpectedStatus(writeResult, 'Write-side');
  if (hasVersion(writeResult, version)) return 'accepted_pending';
  return 'missing';
}

function packagePath(packageName) {
  return encodeURIComponent(packageName).replace(/^%40/, '@');
}

async function fetchRegistryDocument(url, label) {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'cache-control': 'no-cache',
      },
    });
  } catch (error) {
    throw new Error(`${label} registry lookup failed: ${error.message}`, { cause: error });
  }

  const text = await response.text();
  let body = text;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Keep the response text for actionable unexpected-status errors.
    }
  }
  return { status: response.status, body };
}

async function getRegistryState(packageName, version, registry = DEFAULT_REGISTRY) {
  const base = registry.endsWith('/') ? registry : `${registry}/`;
  const packageUrl = new URL(packagePath(packageName), base);
  const publicResult = await fetchRegistryDocument(packageUrl, 'Public');
  if (hasVersion(publicResult, version)) return 'public';
  assertExpectedStatus(publicResult, 'Public');

  packageUrl.searchParams.set('write', 'true');
  const writeResult = await fetchRegistryDocument(packageUrl, 'Write-side');
  return classifyRegistryState(publicResult, writeResult, version);
}

async function main() {
  const [packageName, version, registry = DEFAULT_REGISTRY] = process.argv.slice(2);
  if (!packageName || !version) {
    throw new Error('Usage: node scripts/npm-release-state.js <package> <version> [registry]');
  }
  process.stdout.write(`${await getRegistryState(packageName, version, registry)}\n`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 2;
  });
}

module.exports = {
  classifyRegistryState,
  getRegistryState,
  hasVersion,
  packagePath,
};
