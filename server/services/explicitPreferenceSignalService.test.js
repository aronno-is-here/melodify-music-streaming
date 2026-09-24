import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import mongoose from 'mongoose';
import {
  createExplicitPreferenceSignalService,
  EXPLICIT_SIGNAL_TYPES,
  MAX_FAVORITES_PER_USER,
  MAX_PLAYLISTS_PER_USER,
  MAX_PLAYLIST_MEMBERSHIPS,
  EXPLICIT_SIGNAL_LOADING_ERROR,
  EXPLICIT_SIGNAL_INVALID_USER_ERROR,
} from './explicitPreferenceSignalService.js';

const id = (n) => n.toString(16).padStart(24, '0');
const USER = id(100000);
const OTHER_USER = id(100001);
const EMAIL = 'owner@example.test';
const OTHER_EMAIL = 'other@example.test';
const EARLY = '2026-01-01T00:00:00.000Z';
const LATE = '2026-02-01T00:00:00.000Z';
const favorite = (song = id(1), source = id(10001), extra = {}) => ({
  _id: source, user: USER, song, createdAt: new Date(EARLY), ...extra,
});
const playlist = (items = [{ songId: id(1), addedAt: new Date(EARLY) }], source = id(20001), extra = {}) => ({
  _id: source, user_email: EMAIL, items, ...extra,
});
const empty = () => ({
  signals: [], counts: { favorites: 0, playlistMemberships: 0, total: 0 },
  truncated: { favorites: false, playlists: false, memberships: false },
});

const fakeId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value === 'string') return value.toLowerCase();
  return value?._id ? fakeId(value._id) : value;
};

function harness(data = {}, behavior = {}) {
  const records = {
    User: [{ _id: USER, email: EMAIL }, { _id: OTHER_USER, email: OTHER_EMAIL }],
    Favorite: [], Playlist: [], Song: [{ _id: id(1) }, { _id: id(2) }, { _id: id(3) }],
    ...data,
  };
  const calls = [];
  const model = (name) => {
    const query = (filter, single) => {
      const call = { name, filter, single };
      calls.push(call);
      if (behavior.throwSync === name) throw new Error('mongodb://secret-marker query collection stack');
      return {
        select(projection) { call.projection = projection; return this; },
        sort(sort) { call.sort = sort; return this; },
        limit(limit) { call.limit = limit; return this; },
        async lean() {
          call.lean = true;
          if (behavior.fail === name) throw new Error('mongodb://secret-marker raw-db-marker query collection stack');
          if (behavior.malformed === name) return {};
          let rows = records[name].filter((row) => {
            if (behavior.unscoped === name) return true;
            return Object.entries(filter).every(([field, value]) => (
              value?.$in ? value.$in.includes(fakeId(row?.[field])) : fakeId(row?.[field]) === fakeId(value)
            ));
          });
          if (call.sort) rows = [...rows].sort((a, b) => String(fakeId(a._id)).localeCompare(String(fakeId(b._id))));
          if (call.limit) rows = rows.slice(0, call.limit);
          if (behavior.reverse) rows = [...rows].reverse();
          rows = rows.map((row) => Object.fromEntries(Object.entries(call.projection).flatMap(([field, spec]) => {
            if (!(field in row)) return [];
            const value = spec?.$slice && Array.isArray(row[field]) ? row[field].slice(0, spec.$slice) : row[field];
            return [[field, value]];
          })));
          return single ? rows[0] ?? null : rows;
        },
      };
    };
    return { find: (filter) => query(filter, false), findOne: (filter) => query(filter, true) };
  };
  const options = {
    FavoriteModel: model('Favorite'), PlaylistModel: model('Playlist'),
    SongModel: model('Song'), UserModel: model('User'),
  };
  const service = createExplicitPreferenceSignalService(options);
  return { records, calls, options, load: service.getUserExplicitPreferenceSignals };
}

const callsFor = (h, name) => h.calls.filter((call) => call.name === name);
const onlySignal = async (data) => {
  const h = harness(data);
  const result = await h.load({ userId: USER });
  assert.equal(result.signals.length, 1);
  return result.signals[0];
};

test('valid trusted user loads both factual signal types', async () => {
  const h = harness({ Favorite: [favorite()], Playlist: [playlist()] });
  const result = await h.load({ userId: USER });
  assert.deepEqual(result.signals, [
    { type: 'favorite', song_id: id(1), source_id: id(10001), occurred_at: EARLY },
    { type: 'playlist-membership', song_id: id(1), source_id: id(20001), occurred_at: EARLY },
  ]);
  assert.deepEqual(result.counts, { favorites: 1, playlistMemberships: 1, total: 2 });
});

for (const userId of [undefined, null, '', 'invalid', 'a'.repeat(23), 'z'.repeat(24), 123, [], {}, { _id: USER }]) {
  test(`malformed trusted user ID rejected before reads: ${JSON.stringify(userId)}`, async () => {
    const h = harness();
    await assert.rejects(h.load({ userId }), { message: EXPLICIT_SIGNAL_INVALID_USER_ERROR });
    assert.deepEqual(h.calls, []);
  });
}

test('missing/null arguments reject safely before reads', async () => {
  const h = harness();
  await assert.rejects(h.load(), { message: EXPLICIT_SIGNAL_INVALID_USER_ERROR });
  await assert.rejects(h.load(null), { message: EXPLICIT_SIGNAL_INVALID_USER_ERROR });
  assert.deepEqual(h.calls, []);
});

test('ObjectId trusted user is canonicalized and scopes Favorite read', async () => {
  const h = harness({ Favorite: [favorite()] });
  await h.load({ userId: new mongoose.Types.ObjectId(USER) });
  assert.deepEqual(callsFor(h, 'Favorite')[0].filter, { user: USER });
  assert.deepEqual(callsFor(h, 'User')[0].filter, { _id: USER });
  assert.deepEqual(callsFor(h, 'User')[0].projection, { _id: 1, email: 1 });
});

test('Playlist scope uses persisted email, never alternate direct or nested input', async () => {
  const h = harness({
    Favorite: [favorite(), favorite(id(2), id(10002), { user: OTHER_USER })],
    Playlist: [playlist(), playlist([{ songId: id(2) }], id(20002), { user_email: OTHER_EMAIL })],
  });
  const result = await h.load({ userId: USER, email: OTHER_EMAIL, user_email: OTHER_EMAIL, options: { userId: OTHER_USER } });
  assert.deepEqual(callsFor(h, 'Playlist')[0].filter, { user_email: EMAIL });
  assert.equal(result.signals.length, 2);
  assert.ok(result.signals.every((signal) => signal.song_id === id(1)));
});

test('nested user input cannot authorize any reads', async () => {
  const h = harness();
  await assert.rejects(h.load({ user: { _id: USER }, options: { userId: USER } }), { message: EXPLICIT_SIGNAL_INVALID_USER_ERROR });
  assert.deepEqual(h.calls, []);
});

test('missing persisted user returns empty without reading evidence models', async () => {
  const h = harness({ User: [] });
  assert.deepEqual(await h.load({ userId: USER }), empty());
  assert.deepEqual(h.calls.map((call) => call.name), ['User']);
});

for (const user of [{ _id: USER }, { _id: USER, email: '' }, { _id: USER, email: {} }, { _id: OTHER_USER, email: OTHER_EMAIL }]) {
  test(`invalid persisted identity fails closed: ${JSON.stringify(user)}`, async () => {
    const h = harness({ User: [user] }, { unscoped: 'User' });
    await assert.rejects(h.load({ userId: USER }), { message: EXPLICIT_SIGNAL_LOADING_ERROR });
    assert.deepEqual(h.calls.map((call) => call.name), ['User']);
  });
}

test('defensive Favorite ownership check rejects unrelated returned rows', async () => {
  const h = harness({ Favorite: [favorite(id(1), id(10001), { user: OTHER_USER })] }, { unscoped: 'Favorite' });
  assert.deepEqual(await h.load({ userId: USER }), empty());
  assert.equal(callsFor(h, 'Song').length, 0);
});

test('defensive Playlist ownership check rejects unrelated returned rows', async () => {
  const h = harness({ Playlist: [playlist(undefined, undefined, { user_email: OTHER_EMAIL })] }, { unscoped: 'Playlist' });
  assert.deepEqual(await h.load({ userId: USER }), empty());
});

test('one Favorite preserves canonical song, source ID and factual createdAt', async () => {
  const song = 'ABCDEFABCDEFABCDEFABCDEF';
  const signal = await onlySignal({ Favorite: [favorite(song)], Song: [{ _id: song.toLowerCase() }] });
  assert.deepEqual(signal, { type: 'favorite', song_id: song.toLowerCase(), source_id: id(10001), occurred_at: EARLY });
});

test('ObjectId instances and populated song/user references are supported', async () => {
  const signal = await onlySignal({ Favorite: [favorite(
    { _id: new mongoose.Types.ObjectId(id(1)), title: 'ignored' },
    new mongoose.Types.ObjectId(id(10001)),
    { user: { _id: new mongoose.Types.ObjectId(USER) } },
  )] });
  assert.equal(signal.song_id, id(1));
  assert.equal(signal.source_id, id(10001));
});

test('absent or invalid Favorite timestamps are null, never current time', async () => {
  for (const createdAt of [undefined, null, '', 'invalid', new Date(NaN), {}, 0]) {
    const signal = await onlySignal({ Favorite: [favorite(id(1), id(10001), { createdAt })] });
    assert.equal(signal.occurred_at, null);
  }
});

test('factual timestamp strings normalize to ISO', async () => {
  const signal = await onlySignal({ Favorite: [favorite(id(1), id(10001), { createdAt: '2026-01-01T06:00:00+06:00' })] });
  assert.equal(signal.occurred_at, EARLY);
});

test('duplicate Favorites retain earliest known factual timestamp then lowest source ID', async () => {
  const h = harness({ Favorite: [
    favorite(id(1), id(10001), { createdAt: undefined }),
    favorite(id(1), id(10002), { createdAt: LATE }),
    favorite(id(1), id(10004), { createdAt: EARLY }),
    favorite(id(1), id(10003), { createdAt: EARLY }),
  ] }, { reverse: true });
  assert.deepEqual((await h.load({ userId: USER })).signals, [
    { type: 'favorite', song_id: id(1), source_id: id(10003), occurred_at: EARLY },
  ]);
});

test('duplicate Favorites with no factual time retain lowest source ID', async () => {
  const signal = await onlySignal({ Favorite: [
    favorite(id(1), id(10002), { createdAt: null }), favorite(id(1), id(10001), { createdAt: null }),
  ] });
  assert.equal(signal.source_id, id(10001));
  assert.equal(signal.occurred_at, null);
});

test('malformed Favorite references and source IDs are ignored without arbitrary coercion', async () => {
  const noCoercion = { toString() { throw new Error('must not stringify'); } };
  const invalid = [null, undefined, 'bad', 1, [], {}, noCoercion, { _id: { _id: id(1) } }];
  const h = harness({ Favorite: [
    ...invalid.map((song, i) => favorite(id(1), id(10001 + i), { song })),
    favorite(id(1), 'invalid-source'),
  ] });
  assert.deepEqual(await h.load({ userId: USER }), empty());
  assert.equal(callsFor(h, 'Song').length, 0);
});

test('deleted Song favorite is excluded and counts reflect survivors', async () => {
  const h = harness({ Favorite: [favorite(id(99))] });
  assert.deepEqual(await h.load({ userId: USER }), empty());
  assert.equal(callsFor(h, 'Song').length, 1);
});

test('one playlist item preserves playlist source and exact addedAt', async () => {
  const signal = await onlySignal({ Playlist: [playlist()] });
  assert.deepEqual(signal, { type: 'playlist-membership', song_id: id(1), source_id: id(20001), occurred_at: EARLY });
});

test('playlist duplicates within one list keep one membership with earliest known addedAt', async () => {
  const signal = await onlySignal({ Playlist: [playlist([
    { songId: id(1), addedAt: LATE }, { songId: id(1) },
    { songId: { _id: new mongoose.Types.ObjectId(id(1)) }, addedAt: EARLY },
  ])] });
  assert.equal(signal.occurred_at, EARLY);
});

test('same song in separate playlists remains two independent memberships', async () => {
  const h = harness({ Playlist: [playlist(undefined, id(20002)), playlist()] });
  const result = await h.load({ userId: USER });
  assert.equal(result.signals.length, 2);
  assert.deepEqual(result.signals.map((signal) => signal.source_id), [id(20001), id(20002)]);
  assert.deepEqual(result.counts, { favorites: 0, playlistMemberships: 2, total: 2 });
});

test('null, malformed, unsupported and nested playlist items are safely ignored', async () => {
  const noCoercion = { toString() { throw new Error('must not stringify'); } };
  const h = harness({ Playlist: [playlist([
    null, undefined, id(1), new mongoose.Types.ObjectId(id(1)), [], {},
    { songId: null }, { songId: 'invalid' }, { songId: noCoercion },
    { songId: { _id: { _id: id(1) } } }, { song: id(1) },
  ])] });
  assert.deepEqual(await h.load({ userId: USER }), empty());
});

test('empty, missing, malformed items and invalid playlist source IDs are safe', async () => {
  const h = harness({ Playlist: [
    playlist([], id(20001)), playlist(null, id(20002)), playlist('invalid', id(20003)),
    playlist([], id(20004), { items: undefined }), playlist(undefined, 'bad-source'),
  ] });
  assert.deepEqual(await h.load({ userId: USER }), empty());
});

test('deleted Song playlist membership is filtered', async () => {
  const h = harness({ Playlist: [playlist([{ songId: id(99) }])] });
  assert.deepEqual(await h.load({ userId: USER }), empty());
});

test('missing/invalid addedAt is null, never playlist createdAt or updatedAt', async () => {
  const h = harness({ Playlist: [playlist([
    { songId: id(1) }, { songId: id(2), addedAt: 'invalid' }, { songId: id(3), addedAt: null },
  ], id(20001), { createdAt: EARLY, updatedAt: LATE })] });
  const result = await h.load({ userId: USER });
  assert.ok(result.signals.every((signal) => signal.occurred_at === null));
  assert.equal('updatedAt' in callsFor(h, 'Playlist')[0].projection, false);
});

test('at most one Song read contains sorted unique IDs across all evidence', async () => {
  const h = harness({ Favorite: [favorite(id(2))], Playlist: [playlist([
    { songId: id(3) }, { songId: id(2) }, { songId: id(2) }, { songId: id(1) },
  ])] });
  await h.load({ userId: USER });
  assert.equal(callsFor(h, 'Song').length, 1);
  assert.deepEqual(callsFor(h, 'Song')[0].filter, { _id: { $in: [id(1), id(2), id(3)] } });
  assert.deepEqual(callsFor(h, 'Song')[0].projection, { _id: 1 });
  assert.equal(callsFor(h, 'Song')[0].limit, 3);
  assert.equal(callsFor(h, 'Song')[0].lean, true);
});

test('no referenced songs means zero Song queries', async () => {
  const h = harness();
  assert.deepEqual(await h.load({ userId: USER }), empty());
  assert.equal(callsFor(h, 'Song').length, 0);
});

test('unrelated returned Song IDs cannot create signals', async () => {
  const h = harness({ Favorite: [favorite(id(99))] }, { unscoped: 'Song' });
  assert.deepEqual(await h.load({ userId: USER }), empty());
});

test('all source reads are lean, projected, sorted and explicitly bounded', async () => {
  const h = harness({ Favorite: [favorite()], Playlist: [playlist()] });
  await h.load({ userId: USER });
  const f = callsFor(h, 'Favorite')[0];
  const p = callsFor(h, 'Playlist')[0];
  assert.deepEqual(f.projection, { _id: 1, user: 1, song: 1, createdAt: 1 });
  assert.deepEqual(p.projection, { _id: 1, user_email: 1, items: { $slice: MAX_PLAYLIST_MEMBERSHIPS + 1 } });
  assert.deepEqual(f.sort, { _id: 1 });
  assert.deepEqual(p.sort, { _id: 1 });
  assert.equal(f.limit, MAX_FAVORITES_PER_USER + 1);
  assert.equal(p.limit, MAX_PLAYLISTS_PER_USER + 1);
  assert.ok(h.calls.every((call) => call.lean));
  assert.deepEqual(h.calls.map((call) => call.name), ['User', 'Favorite', 'Playlist', 'Song']);
});

for (const excess of [0, 1]) {
  test(`Favorite cap and exact truncation flag at cap + ${excess}`, async () => {
    const favorites = Array.from({ length: MAX_FAVORITES_PER_USER + excess }, (_, i) => favorite(id(i + 1), id(10001 + i)));
    const h = harness({ Favorite: favorites.reverse(), Song: favorites.map((f) => ({ _id: f.song })) });
    const result = await h.load({ userId: USER });
    assert.equal(result.counts.favorites, MAX_FAVORITES_PER_USER);
    assert.equal(result.truncated.favorites, excess > 0);
    assert.equal(result.signals.at(-1).source_id, id(10000 + MAX_FAVORITES_PER_USER));
    assert.equal(callsFor(h, 'Favorite').length, 1);
  });

  test(`Playlist cap and exact truncation flag at cap + ${excess}`, async () => {
    const playlists = Array.from({ length: MAX_PLAYLISTS_PER_USER + excess }, (_, i) => playlist(undefined, id(20001 + i)));
    const h = harness({ Playlist: playlists.reverse() });
    const result = await h.load({ userId: USER });
    assert.equal(result.counts.playlistMemberships, MAX_PLAYLISTS_PER_USER);
    assert.equal(result.truncated.playlists, excess > 0);
    assert.equal(result.truncated.memberships, false);
    assert.equal(result.signals.at(-1).source_id, id(20000 + MAX_PLAYLISTS_PER_USER));
    assert.equal(callsFor(h, 'Playlist').length, 1);
  });

  test(`membership scan/output cap and exact truncation flag at cap + ${excess}`, async () => {
    const items = Array.from({ length: MAX_PLAYLIST_MEMBERSHIPS + excess }, (_, i) => ({ songId: id(i + 1) }));
    const h = harness({ Playlist: [playlist(items)], Song: items.map((item) => ({ _id: item.songId })) });
    const result = await h.load({ userId: USER });
    assert.equal(result.counts.playlistMemberships, MAX_PLAYLIST_MEMBERSHIPS);
    assert.equal(result.truncated.memberships, excess > 0);
    assert.equal(result.truncated.playlists, false);
    assert.equal(callsFor(h, 'Song')[0].filter._id.$in.length, MAX_PLAYLIST_MEMBERSHIPS);
    assert.equal(result.signals.at(-1).song_id, id(MAX_PLAYLIST_MEMBERSHIPS));
  });
}

test('membership budget is shared across playlists in source-ID then persisted item order', async () => {
  const firstItems = Array.from({ length: MAX_PLAYLIST_MEMBERSHIPS - 1 }, () => ({ songId: id(1) }));
  const h = harness({ Playlist: [
    playlist([{ songId: id(3) }, { songId: id(2) }], id(20002)), playlist(firstItems),
  ] });
  const result = await h.load({ userId: USER });
  assert.equal(result.truncated.memberships, true);
  assert.deepEqual(result.signals.map((signal) => signal.song_id), [id(1), id(3)]);
});

test('invalid/duplicate items consume scan budget and report incomplete membership scan', async () => {
  const h = harness({ Playlist: [playlist([
    ...Array.from({ length: MAX_PLAYLIST_MEMBERSHIPS }, () => null), { songId: id(1) },
  ])] });
  const result = await h.load({ userId: USER });
  assert.deepEqual(result.signals, []);
  assert.equal(result.truncated.memberships, true);
  assert.equal(callsFor(h, 'Song').length, 0);
});

test('membership projection uses one lookahead slot even for huge arrays', async () => {
  const items = Array.from({ length: MAX_PLAYLIST_MEMBERSHIPS + 100 }, () => ({ songId: id(1) }));
  const h = harness({ Playlist: [playlist(items)] });
  const result = await h.load({ userId: USER });
  assert.equal(result.counts.playlistMemberships, 1);
  assert.equal(result.truncated.memberships, true);
  assert.equal(callsFor(h, 'Playlist')[0].projection.items.$slice, MAX_PLAYLIST_MEMBERSHIPS + 1);
});

test('exact scan cap followed by empty playlists is complete', async () => {
  const h = harness({ Playlist: [
    playlist(Array.from({ length: MAX_PLAYLIST_MEMBERSHIPS }, () => ({ songId: id(1) }))),
    playlist([], id(20002)),
  ] });
  assert.equal((await h.load({ userId: USER })).truncated.memberships, false);
});

test('source truncation survives deduplication and stale filtering', async () => {
  const h = harness({ Favorite: Array.from({ length: MAX_FAVORITES_PER_USER + 1 }, (_, i) => favorite(id(99), id(10001 + i))) });
  const result = await h.load({ userId: USER });
  assert.equal(result.counts.total, 0);
  assert.equal(result.truncated.favorites, true);
});

test('Song lookup is bounded by the combined Favorite and membership caps', async () => {
  const favorites = Array.from({ length: MAX_FAVORITES_PER_USER }, (_, i) => favorite(id(i + 1), id(10001 + i)));
  const items = Array.from({ length: MAX_PLAYLIST_MEMBERSHIPS }, (_, i) => ({ songId: id(MAX_FAVORITES_PER_USER + i + 1) }));
  const h = harness({ Favorite: favorites, Playlist: [playlist(items)], Song: [] });
  await h.load({ userId: USER });
  assert.equal(callsFor(h, 'Song').length, 1);
  assert.equal(callsFor(h, 'Song')[0].limit, MAX_FAVORITES_PER_USER + MAX_PLAYLIST_MEMBERSHIPS);
});

test('counts are final surviving evidence counts, not raw source totals', async () => {
  const h = harness({
    Favorite: [favorite(id(1)), favorite(id(1), id(10002)), favorite(id(99), id(10003))],
    Playlist: [playlist([{ songId: id(1) }, { songId: id(1) }, { songId: id(99) }]), playlist(undefined, id(20002))],
  });
  assert.deepEqual((await h.load({ userId: USER })).counts, { favorites: 1, playlistMemberships: 2, total: 3 });
});

test('final order is type, song ID, then source ID regardless of query return order', async () => {
  const data = {
    Favorite: [favorite(id(2)), favorite(id(1), id(10002))],
    Playlist: [playlist([{ songId: id(2) }, { songId: id(1) }], id(20002)), playlist()],
  };
  const h = harness(data, { reverse: true });
  const result = await h.load({ userId: USER });
  assert.deepEqual(result.signals.map((signal) => [signal.type, signal.song_id, signal.source_id]), [
    ['favorite', id(1), id(10002)], ['favorite', id(2), id(10001)],
    ['playlist-membership', id(1), id(20001)], ['playlist-membership', id(1), id(20002)],
    ['playlist-membership', id(2), id(20002)],
  ]);
  assert.deepEqual(result, await harness(data).load({ userId: USER }));
  assert.deepEqual(result, await h.load({ userId: USER }));
});

test('signal vocabulary and hard caps are fixed exported values', () => {
  assert.deepEqual(EXPLICIT_SIGNAL_TYPES, ['favorite', 'playlist-membership']);
  assert.ok(Object.isFrozen(EXPLICIT_SIGNAL_TYPES));
  assert.equal(MAX_FAVORITES_PER_USER, 1000);
  assert.equal(MAX_PLAYLISTS_PER_USER, 250);
  assert.equal(MAX_PLAYLIST_MEMBERSHIPS, 5000);
});

test('output whitelist excludes weights, scores, identity, tokens and wholesale source records', async () => {
  const extras = { email: EMAIL, token: 'secret-marker', jwt: 'secret-marker', weight: 5, preference_score: 5, recommendation_score: 5, title: 'private' };
  const h = harness({ Favorite: [favorite(id(1), id(10001), extras)], Playlist: [playlist(undefined, undefined, extras)] });
  const result = await h.load({ userId: USER });
  for (const signal of result.signals) {
    assert.deepEqual(Object.keys(signal).sort(), ['occurred_at', 'song_id', 'source_id', 'type']);
  }
  assert.equal(JSON.stringify(result).includes(EMAIL), false);
  assert.equal(JSON.stringify(result).includes('secret-marker'), false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('removed Favorite naturally disappears on next read without negative evidence', async () => {
  const h = harness({ Favorite: [favorite()], Playlist: [playlist()] });
  assert.equal((await h.load({ userId: USER })).counts.favorites, 1);
  h.records.Favorite = [];
  const result = await h.load({ userId: USER });
  assert.equal(result.counts.favorites, 0);
  assert.deepEqual(result.signals.map((signal) => signal.type), ['playlist-membership']);
});

test('removed membership or playlist naturally disappears without dislike', async () => {
  const h = harness({ Playlist: [playlist()] });
  assert.equal((await h.load({ userId: USER })).counts.playlistMemberships, 1);
  h.records.Playlist = [playlist([])];
  assert.deepEqual(await h.load({ userId: USER }), empty());
  h.records.Playlist = [];
  assert.deepEqual(await h.load({ userId: USER }), empty());
});

for (const name of ['User', 'Favorite', 'Playlist', 'Song']) {
  test(`${name} query failure is sanitized without original details or retries`, async () => {
    const h = harness({ Favorite: [favorite()] }, { fail: name });
    await assert.rejects(h.load({ userId: USER }), (error) => {
      assert.equal(error.message, EXPLICIT_SIGNAL_LOADING_ERROR);
      assert.equal(error.cause, undefined);
      assert.deepEqual(Object.keys(error), []);
      for (const marker of ['raw-db-marker', 'secret-marker', 'mongodb://', 'collection']) {
        assert.equal(String(error.stack).includes(marker), false);
      }
      return true;
    });
    assert.equal(callsFor(h, name).length, 1);
  });
}

test('synchronous query failures are sanitized as well', async () => {
  const h = harness({}, { throwSync: 'Favorite' });
  await assert.rejects(h.load({ userId: USER }), { message: EXPLICIT_SIGNAL_LOADING_ERROR });
  assert.equal(callsFor(h, 'Favorite').length, 1);
});

for (const name of ['Favorite', 'Playlist', 'Song']) {
  test(`malformed ${name} query result fails sanitized instead of claiming completeness`, async () => {
    const h = harness({ Favorite: [favorite()] }, { malformed: name });
    await assert.rejects(h.load({ userId: USER }), { message: EXPLICIT_SIGNAL_LOADING_ERROR });
  });
}

test('Favorite, Playlist, Song and User fixtures, input and factory options remain immutable', async () => {
  const freeze = (value) => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  };
  const data = freeze({ Favorite: [favorite()], Playlist: [playlist()], Song: [{ _id: id(1), title: 'untouched' }] });
  const before = JSON.stringify(data);
  const h = harness(data);
  freeze(h.records);
  freeze(h.options);
  const input = freeze({ userId: USER, ignored: { email: OTHER_EMAIL } });
  const inputBefore = JSON.stringify(input);
  const modelRefs = { ...h.options };
  await h.load(input);
  assert.equal(JSON.stringify(data), before);
  assert.equal(JSON.stringify(input), inputBefore);
  assert.deepEqual(h.options, modelRefs);
});

test('static: only existing Favorite, Playlist, Song and User models are imported', () => {
  const src = readFileSync(new URL('./explicitPreferenceSignalService.js', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/from '\.\.\/models\/([^']+)'/g)].map((match) => match[1]).sort();
  assert.deepEqual(imports, ['Favorite.js', 'Playlist.js', 'Song.js', 'User.js']);
  assert.doesNotMatch(src, /\b(ListeningEvent|PlayHistory|Post|Like)\b/);
  assert.doesNotMatch(src, /preference_score|recommendation_score|interaction_weight|affinity/);
});

test('static: no clock fallback, randomness, persistence writes, population or query loops', () => {
  const src = readFileSync(new URL('./explicitPreferenceSignalService.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Date\.now|new Date\(\)|Math\.random|\.populate\(|\.aggregate\(/);
  assert.doesNotMatch(src, /\.(connect|create|save|updateOne|insertMany|deleteOne|skip)\(/);
  assert.doesNotMatch(src, /setInterval|setTimeout|\bwhile\s*\(|\.then\(/);
  assert.equal((src.match(/FavoriteModel\.find\(/g) || []).length, 1);
  assert.equal((src.match(/PlaylistModel\.find\(/g) || []).length, 1);
  assert.equal((src.match(/SongModel\.find\(/g) || []).length, 1);
});
