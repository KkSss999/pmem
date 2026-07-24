'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const {
  classifyRegistryState,
  hasVersion,
  packagePath,
} = require('./npm-release-state');

const documentWith = (...versions) => ({
  status: 200,
  body: { versions: Object.fromEntries(versions.map(version => [version, { version }])) },
});
const notFound = { status: 404, body: { error: 'Not found' } };

describe('npm release registry state', () => {
  it('reports public only when the exact version is on the public read side', () => {
    assert.equal(
      classifyRegistryState(documentWith('1.2.0'), notFound, '1.2.0'),
      'public',
    );
  });

  it('reports accepted_pending when publish reached the write side but public reads still return 404', () => {
    assert.equal(
      classifyRegistryState(notFound, documentWith('1.2.0'), '1.2.0'),
      'accepted_pending',
    );
  });

  it('reports accepted_pending when the public replica has only an older version', () => {
    assert.equal(
      classifyRegistryState(documentWith('1.1.0'), documentWith('1.1.0', '1.2.0'), '1.2.0'),
      'accepted_pending',
    );
  });

  it('reports missing only when the exact version is absent from both views', () => {
    assert.equal(
      classifyRegistryState(documentWith('1.1.0'), documentWith('1.1.0'), '1.2.0'),
      'missing',
    );
    assert.equal(classifyRegistryState(notFound, notFound, '1.2.0'), 'missing');
  });

  it('fails closed on unexpected registry responses', () => {
    assert.throws(
      () => classifyRegistryState({ status: 503, body: 'unavailable' }, notFound, '1.2.0'),
      /Public registry lookup returned HTTP 503/,
    );
    assert.throws(
      () => classifyRegistryState(notFound, { status: 401, body: 'unauthorized' }, '1.2.0'),
      /Write-side registry lookup returned HTTP 401/,
    );
  });

  it('handles exact versions and scoped package registry paths', () => {
    assert.equal(hasVersion(documentWith('1.2.0'), '1.2.0'), true);
    assert.equal(hasVersion(documentWith('1.2.0-beta.1'), '1.2.0'), false);
    assert.equal(packagePath('@scope/package'), '@scope%2Fpackage');
  });
});
