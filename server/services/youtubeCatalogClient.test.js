import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createYouTubeCatalogClient,
  YOUTUBE_API_BASE,
  DEFAULT_SEARCH_MAX_RESULTS,
  MAX_SEARCH_MAX_RESULTS,
  MAX_QUERY_LENGTH,
  MAX_PAGE_TOKEN_LENGTH,
  MAX_VIDEO_IDS,
  MAX_VIDEO_ID_LENGTH,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './youtubeCatalogClient.js';

const MOCK_KEY = 'MOCK_YOUTUBE_KEY_0123456789';
const SEARCH_OPERATION = 'YouTube catalog search';
const DETAILS_OPERATION = 'YouTube video metadata request';

const jsonResponse = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => body,
});

const okBody = { kind: 'youtube#searchListResponse', items: [] };
const detailsBody = { kind: 'youtube#videoListResponse', items: [] };

const createRecordingClient = (overrides = {}) => {
  const calls = [];
  const { fetchImpl: customFetch, ...rest } = overrides;
  const baseFetch = customFetch ?? (async () => jsonResponse(okBody));
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return baseFetch(url, options);
  };
  const client = createYouTubeCatalogClient({
    apiKey: MOCK_KEY,
    fetchImpl,
    timeoutMs: 1000,
    ...rest,
  });
  return { client, calls };
};

const neverFetch = () => {
  throw new Error('network must not be used');
};

const assertSafeError = (error, operation) => {
  assert.ok(error instanceof Error);
  const { message } = error;
  assert.ok(message.includes(operation), `expected ${JSON.stringify(message)} to name ${operation}`);
  assert.equal(message.includes(MOCK_KEY), false);
  assert.equal(message.toLowerCase().includes('key='), false);
  assert.equal(message.includes('googleapis'), false);
  return true;
};

const assertNotConfigured = (error) => {
  assert.ok(error instanceof Error);
  assert.equal(error.message, 'YouTube catalog API is not configured');
  assert.equal(error.message.includes(MOCK_KEY), false);
  assert.equal(error.message.toLowerCase().includes('key='), false);
  assert.equal(error.message.includes('googleapis'), false);
  return true;
};

test('missing API key fails safely without any network call', async () => {
  const original = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    const client = createYouTubeCatalogClient({ fetchImpl: neverFetch });
    await assert.rejects(client.searchMusicVideos({ query: 'test song' }), assertNotConfigured);
    await assert.rejects(client.getVideoDetails(['abcdefghijk']), assertNotConfigured);
  } finally {
    if (original === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = original;
    }
  }
});

test('blank and whitespace API keys fail safely', async () => {
  const original = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    for (const apiKey of ['', '   ', null, undefined, 123]) {
      const client = createYouTubeCatalogClient({ apiKey, fetchImpl: neverFetch });
      await assert.rejects(client.searchMusicVideos({ query: 'test song' }), assertNotConfigured);
      await assert.rejects(client.getVideoDetails(['abcdefghijk']), assertNotConfigured);
    }
  } finally {
    if (original === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = original;
    }
  }
});

test('importing and constructing without a key never throws', () => {
  const original = process.env.YOUTUBE_API_KEY;
  delete process.env.YOUTUBE_API_KEY;
  try {
    const client = createYouTubeCatalogClient({ fetchImpl: neverFetch });
    assert.equal(typeof client.searchMusicVideos, 'function');
    assert.equal(typeof client.getVideoDetails, 'function');
    assert.equal(Object.isFrozen(client), true);
  } finally {
    if (original === undefined) {
      delete process.env.YOUTUBE_API_KEY;
    } else {
      process.env.YOUTUBE_API_KEY = original;
    }
  }
});

test('API key is attached only to the outbound request and never to errors', async () => {
  const failures = [
    { fetchImpl: async () => jsonResponse({ error: 'quota' }, { ok: false, status: 403 }), operation: SEARCH_OPERATION },
    { fetchImpl: async () => { throw new TypeError(`fetch failed for https://www.googleapis.com/youtube/v3/search?key=${MOCK_KEY}`); }, operation: SEARCH_OPERATION },
    { fetchImpl: async () => jsonResponse('<html>error</html>', { ok: false, status: 500 }), operation: DETAILS_OPERATION },
  ];
  for (const [index, { fetchImpl, operation }] of failures.entries()) {
    const client = createYouTubeCatalogClient({ apiKey: MOCK_KEY, fetchImpl, timeoutMs: 1000 });
    const invocation = index === 2 ? client.getVideoDetails(['abcdefghijk']) : client.searchMusicVideos({ query: 'test' });
    await assert.rejects(invocation, (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.includes(MOCK_KEY), false);
      assert.equal(error.message.includes('key='), false);
      assert.ok(error.message.includes(operation));
      return true;
    });
  }
});

test('search builds the fixed YouTube search endpoint with internal key', async () => {
  const { client, calls } = createRecordingClient();
  await client.searchMusicVideos({ query: 'test song' });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, `${YOUTUBE_API_BASE}/search`);
  assert.equal(url.origin, 'https://www.googleapis.com');
  assert.equal(url.searchParams.get('key'), MOCK_KEY);
  assert.equal(calls[0].options.method, 'GET');
  assert.ok(calls[0].options.signal);
});

test('search requests type=video', async () => {
  const { client, calls } = createRecordingClient();
  await client.searchMusicVideos({ query: 'test song' });
  assert.equal(new URL(calls[0].url).searchParams.get('type'), 'video');
});

test('search requests part=snippet', async () => {
  const { client, calls } = createRecordingClient();
  await client.searchMusicVideos({ query: 'test song' });
  assert.equal(new URL(calls[0].url).searchParams.get('part'), 'snippet');
});

test('search trims the query', async () => {
  const { client, calls } = createRecordingClient();
  await client.searchMusicVideos({ query: '  a di chokher jole  ' });
  assert.equal(new URL(calls[0].url).searchParams.get('q'), 'a di chokher jole');
});

test('search rejects empty and whitespace-only queries', async () => {
  const { client, calls } = createRecordingClient();
  for (const query of ['', '   ', '\t\n']) {
    await assert.rejects(
      client.searchMusicVideos({ query }),
      (error) => assertSafeError(error, SEARCH_OPERATION),
    );
  }
  assert.equal(calls.length, 0);
});

test('search rejects non-string queries', async () => {
  const { client, calls } = createRecordingClient();
  for (const query of [42, null, undefined, {}, ['query'], true, 1n]) {
    await assert.rejects(
      client.searchMusicVideos({ query }),
      (error) => assertSafeError(error, SEARCH_OPERATION),
    );
  }
  await assert.rejects(
    client.searchMusicVideos(),
    (error) => assertSafeError(error, SEARCH_OPERATION),
  );
  await assert.rejects(
    client.searchMusicVideos(null),
    (error) => assertSafeError(error, SEARCH_OPERATION),
  );
  assert.equal(calls.length, 0);
});

test('search rejects overlong queries', async () => {
  const { client, calls } = createRecordingClient();
  await assert.rejects(
    client.searchMusicVideos({ query: 'a'.repeat(MAX_QUERY_LENGTH + 1) }),
    (error) => assertSafeError(error, SEARCH_OPERATION),
  );
  assert.equal(calls.length, 0);
});

test('search uses a bounded default maxResults', async () => {
  const { client, calls } = createRecordingClient();
  await client.searchMusicVideos({ query: 'test' });
  const parsed = Number(new URL(calls[0].url).searchParams.get('maxResults'));
  assert.equal(parsed, DEFAULT_SEARCH_MAX_RESULTS);
  assert.ok(Number.isInteger(parsed));
  assert.ok(parsed >= 1 && parsed <= MAX_SEARCH_MAX_RESULTS);
});

test('search rejects out-of-range or non-integer maxResults', async () => {
  const { client, calls } = createRecordingClient();
  for (const maxResults of [0, -1, MAX_SEARCH_MAX_RESULTS + 1, 1.5, '10', NaN, Infinity, -Infinity, {}, []]) {
    await assert.rejects(
      client.searchMusicVideos({ query: 'test', maxResults }),
      (error) => assertSafeError(error, SEARCH_OPERATION),
    );
  }
  assert.equal(calls.length, 0);
});

test('search accepts bounded maxResults values including the YouTube maximum', async () => {
  const { client, calls } = createRecordingClient();
  await client.searchMusicVideos({ query: 'test', maxResults: 1 });
  await client.searchMusicVideos({ query: 'test', maxResults: MAX_SEARCH_MAX_RESULTS });
  assert.equal(new URL(calls[0].url).searchParams.get('maxResults'), '1');
  assert.equal(new URL(calls[1].url).searchParams.get('maxResults'), String(MAX_SEARCH_MAX_RESULTS));
});

test('search handles pageToken safely', async () => {
  const { client, calls } = createRecordingClient();
  await client.searchMusicVideos({ query: 'test', pageToken: '  CAUQAA  ' });
  assert.equal(new URL(calls[0].url).searchParams.get('pageToken'), 'CAUQAA');

  await client.searchMusicVideos({ query: 'test' });
  assert.equal(new URL(calls[1].url).searchParams.has('pageToken'), false);

  await client.searchMusicVideos({ query: 'test', pageToken: undefined });
  await client.searchMusicVideos({ query: 'test', pageToken: null });
  assert.equal(new URL(calls[2].url).searchParams.has('pageToken'), false);
  assert.equal(new URL(calls[3].url).searchParams.has('pageToken'), false);

  for (const pageToken of ['', '   ', 42, {}, ['t'], true, 'x'.repeat(MAX_PAGE_TOKEN_LENGTH + 1)]) {
    await assert.rejects(
      client.searchMusicVideos({ query: 'test', pageToken }),
      (error) => assertSafeError(error, SEARCH_OPERATION),
    );
  }
  assert.equal(calls.length, 4);
});

test('callers cannot supply an arbitrary URL, host, or extra API fields', async () => {
  const { client, calls } = createRecordingClient({
    baseUrl: 'https://evil.example/youtube',
    host: 'evil.example',
    apiHost: 'https://evil.example',
  });
  await client.searchMusicVideos({
    query: 'test',
    url: 'https://evil.example/search',
    baseUrl: 'https://evil.example',
    host: 'evil.example',
    key: 'planted-key',
    part: 'id',
    type: 'playlist',
    maxResultsOverridden: 9999,
    fields: 'items(id)',
  });
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, `${YOUTUBE_API_BASE}/search`);
  assert.equal(url.searchParams.get('key'), MOCK_KEY);
  assert.equal(url.searchParams.get('part'), 'snippet');
  assert.equal(url.searchParams.get('type'), 'video');
  assert.equal(url.searchParams.get('q'), 'test');
  assert.equal(url.searchParams.has('fields'), false);
  assert.equal(calls[0].url.includes('evil.example'), false);
});

test('video ID batches are trimmed', async () => {
  const { client, calls } = createRecordingClient();
  await client.getVideoDetails(['  vidOne  ', '\tvidTwo\n']);
  assert.equal(new URL(calls[0].url).searchParams.get('id'), 'vidOne,vidTwo');
});

test('video ID batches remove duplicates', async () => {
  const { client, calls } = createRecordingClient();
  await client.getVideoDetails(['vidOne', 'vidOne', ' vidOne ', 'vidTwo']);
  assert.equal(new URL(calls[0].url).searchParams.get('id'), 'vidOne,vidTwo');
});

test('video ID batches remove empty and whitespace IDs', async () => {
  const { client, calls } = createRecordingClient();
  await client.getVideoDetails(['', '   ', 'vidOne', '\t', 'vidTwo']);
  assert.equal(new URL(calls[0].url).searchParams.get('id'), 'vidOne,vidTwo');
});

test('invalid video ID collections are rejected', async () => {
  const { client, calls } = createRecordingClient();
  for (const input of [null, undefined, 'vidOne', 42, {}, true, new Set(['vidOne'])]) {
    await assert.rejects(
      client.getVideoDetails(input),
      (error) => assertSafeError(error, DETAILS_OPERATION),
    );
  }
  for (const input of [[42], [null], [{}], [['vidOne']], [true], [1n]]) {
    await assert.rejects(
      client.getVideoDetails(input),
      (error) => assertSafeError(error, DETAILS_OPERATION),
    );
  }
  await assert.rejects(
    client.getVideoDetails(['x'.repeat(MAX_VIDEO_ID_LENGTH + 1)]),
    (error) => assertSafeError(error, DETAILS_OPERATION),
  );
  await assert.rejects(
    client.getVideoDetails([]),
    (error) => assertSafeError(error, DETAILS_OPERATION) && error.message.includes('empty'),
  );
  await assert.rejects(
    client.getVideoDetails(['', '  ']),
    (error) => assertSafeError(error, DETAILS_OPERATION) && error.message.includes('empty'),
  );
  assert.equal(calls.length, 0);
});

test('excessive video ID batches are rejected and the exact maximum is accepted', async () => {
  const { client, calls } = createRecordingClient();
  const oversized = Array.from({ length: MAX_VIDEO_IDS + 1 }, (_, index) => `vid${index}`);
  await assert.rejects(
    client.getVideoDetails(oversized),
    (error) => assertSafeError(error, DETAILS_OPERATION) && error.message.includes('maximum'),
  );
  const exact = Array.from({ length: MAX_VIDEO_IDS }, (_, index) => `vid${index}`);
  await client.getVideoDetails(exact);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get('id').split(',').length, MAX_VIDEO_IDS);
});

test('video details use the fixed endpoint with snippet, contentDetails, and status parts', async () => {
  const { client, calls } = createRecordingClient();
  await client.getVideoDetails(['vidOne', 'vidTwo']);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(`${url.origin}${url.pathname}`, `${YOUTUBE_API_BASE}/videos`);
  assert.equal(url.searchParams.get('part'), 'snippet,contentDetails,status');
  assert.equal(url.searchParams.get('id'), 'vidOne,vidTwo');
  assert.equal(url.searchParams.get('key'), MOCK_KEY);
  assert.equal(calls[0].options.method, 'GET');
});

test('non-2xx responses produce sanitized errors without the upstream body', async () => {
  const upstreamBody = { error: { message: `Access blocked, key=${MOCK_KEY}, quota exceeded` } };
  const { client } = createRecordingClient({
    fetchImpl: async () => jsonResponse(upstreamBody, { ok: false, status: 403 }),
  });
  await assert.rejects(
    client.searchMusicVideos({ query: 'test' }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `${SEARCH_OPERATION} failed (HTTP 403)`);
      assert.equal(error.message.includes(MOCK_KEY), false);
      assert.equal(error.message.includes('quota'), false);
      assert.equal(error.message.includes('Access blocked'), false);
      return true;
    },
  );
  await assert.rejects(
    client.getVideoDetails(['vidOne']),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `${DETAILS_OPERATION} failed (HTTP 403)`);
      assert.equal(error.message.includes(MOCK_KEY), false);
      return true;
    },
  );
});

test('network failures are sanitized and never leak the keyed URL', async () => {
  const { client } = createRecordingClient({
    fetchImpl: async () => {
      throw new TypeError(`fetch failed: https://www.googleapis.com/youtube/v3/search?q=x&key=${MOCK_KEY}`);
    },
  });
  await assert.rejects(
    client.searchMusicVideos({ query: 'x' }),
    (error) => {
      assert.equal(error.message, `${SEARCH_OPERATION} failed`);
      assert.equal(error.message.includes(MOCK_KEY), false);
      assert.equal(error.message.includes('key='), false);
      return true;
    },
  );
});

test('timeout produces a sanitized timeout error without surviving timers', async () => {
  const { client } = createRecordingClient({
    timeoutMs: 10,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => {
      const abortError = () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      };
      if (signal.aborted) {
        abortError();
        return;
      }
      signal.addEventListener('abort', abortError, { once: true });
    }),
  });
  const startedAt = Date.now();
  await assert.rejects(
    client.searchMusicVideos({ query: 'slow song' }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, `${SEARCH_OPERATION} timed out`);
      assert.equal(error.message.includes(MOCK_KEY), false);
      return true;
    },
  );
  assert.ok(Date.now() - startedAt < 5000);
  await assert.rejects(
    client.getVideoDetails(['vidOne']),
    (error) => {
      assert.equal(error.message, `${DETAILS_OPERATION} timed out`);
      assert.equal(error.message.includes(MOCK_KEY), false);
      return true;
    },
  );
});

test('malformed JSON and non-object bodies produce sanitized errors', async () => {
  const brokenJson = createRecordingClient({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(`Unexpected token <, key=${MOCK_KEY}`); } }),
  });
  await assert.rejects(
    brokenJson.client.searchMusicVideos({ query: 'test' }),
    (error) => {
      assert.equal(error.message, `${SEARCH_OPERATION} returned a malformed response`);
      assert.equal(error.message.includes(MOCK_KEY), false);
      return true;
    },
  );

  for (const body of [['not', 'an', 'object'], 'raw string', 42, null, true]) {
    const { client } = createRecordingClient({ fetchImpl: async () => jsonResponse(body) });
    await assert.rejects(
      client.getVideoDetails(['vidOne']),
      (error) => {
        assert.equal(error.message, `${DETAILS_OPERATION} returned a malformed response`);
        assert.equal(error.message.includes(MOCK_KEY), false);
        return true;
      },
    );
  }
});

test('one invocation performs exactly one upstream call with no hidden pagination or retry', async () => {
  const search = createRecordingClient();
  await search.client.searchMusicVideos({ query: 'test', pageToken: 'NEXT', maxResults: MAX_SEARCH_MAX_RESULTS });
  await search.client.searchMusicVideos({ query: 'test' });
  assert.equal(search.calls.length, 2);

  const details = createRecordingClient();
  await details.client.getVideoDetails(Array.from({ length: MAX_VIDEO_IDS }, (_, index) => `vid${index}`));
  assert.equal(details.calls.length, 1);

  const failing = createRecordingClient({
    fetchImpl: async () => jsonResponse({ error: 'boom' }, { ok: false, status: 500 }),
  });
  await assert.rejects(failing.client.searchMusicVideos({ query: 'test' }));
  assert.equal(failing.calls.length, 1);
});

test('a failing fetch is not retried across repeated operation attempts', async () => {
  let attempts = 0;
  const { client, calls } = createRecordingClient({
    fetchImpl: async () => {
      attempts += 1;
      throw new TypeError('socket hang up');
    },
  });
  await assert.rejects(client.searchMusicVideos({ query: 'one' }));
  assert.equal(attempts, 1);
  await assert.rejects(client.searchMusicVideos({ query: 'two' }));
  assert.equal(attempts, 2);
  assert.equal(calls.length, 2);
});

test('default timeout is finite and conservative', () => {
  assert.ok(Number.isFinite(DEFAULT_REQUEST_TIMEOUT_MS));
  assert.ok(DEFAULT_REQUEST_TIMEOUT_MS >= 8000 && DEFAULT_REQUEST_TIMEOUT_MS <= 10000);
  const { client } = createRecordingClient({ timeoutMs: 0 });
  assert.equal(typeof client.searchMusicVideos, 'function');
  const invalidTimeouts = createRecordingClient({ timeoutMs: -5 });
  assert.equal(typeof invalidTimeouts.client.getVideoDetails, 'function');
});

test('no validation or failure error message ever contains the API key', async () => {
  const messages = [];
  const { client } = createRecordingClient({ fetchImpl: async () => jsonResponse({ error: `leak key=${MOCK_KEY}` }, { ok: false, status: 502 }) });
  const invocations = [
    client.searchMusicVideos({ query: '' }),
    client.searchMusicVideos({ query: 42 }),
    client.searchMusicVideos({ query: 'ok', maxResults: 999 }),
    client.searchMusicVideos({ query: 'ok', pageToken: 42 }),
    client.searchMusicVideos(null),
    client.getVideoDetails(null),
    client.getVideoDetails([]),
    client.getVideoDetails([42]),
    client.getVideoDetails(['vidOne']),
  ];
  for (const invocation of invocations) {
    await assert.rejects(invocation, (error) => {
      messages.push(error.message);
      assert.equal(error.message.includes(MOCK_KEY), false);
      assert.equal(error.message.includes('key='), false);
      return true;
    });
  }
  assert.ok(messages.length >= 9);
});
