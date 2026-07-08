import assert from 'node:assert/strict';
import { test } from 'node:test';
import { urlToAssetKey } from '../src/api/embeddedStatic.js';

const BASE = '/trapline';

test('maps UI urls to embedded asset keys', () => {
  assert.equal(urlToAssetKey('/trapline/', BASE), 'web/index.html');
  assert.equal(urlToAssetKey('/trapline', BASE), 'web/index.html');
  assert.equal(urlToAssetKey('/trapline/assets/index-BuLL.js', BASE), 'web/assets/index-BuLL.js');
  assert.equal(urlToAssetKey('/trapline/assets/index.css?v=2', BASE), 'web/assets/index.css');
});

test('urls outside the base path are rejected', () => {
  assert.equal(urlToAssetKey('/other/thing', BASE), null);
  assert.equal(urlToAssetKey('/traplinefake/x.js', BASE), null);
});

test('path traversal cannot escape the web root', () => {
  assert.equal(urlToAssetKey('/trapline/../secrets', BASE), null);
  assert.equal(urlToAssetKey('/trapline/%2e%2e/%2e%2e/etc/passwd', BASE), null);
  assert.equal(urlToAssetKey('/trapline/a/../../x', BASE), null);
  // normalizing inside the root is fine
  assert.equal(urlToAssetKey('/trapline/a/../index.html', BASE), 'web/index.html');
});

test('bad percent-encoding is rejected, not thrown', () => {
  assert.equal(urlToAssetKey('/trapline/%zz', BASE), null);
});
