import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import userRouter, { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES, detectAvatarMime } from './userRoutes.js';
import User from '../models/User.js';

function createRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

function getAvatarStack() {
  const layer = userRouter.stack.find((entry) => entry.route && entry.route.path === '/me/avatar' && entry.route.methods.put);
  assert.ok(layer, 'PUT /me/avatar route must exist');
  return layer.route.stack;
}

const getHandler = () => {
  const stack = getAvatarStack();
  return stack[stack.length - 1].handle;
};

const getUploadWrapper = () => getAvatarStack()[1].handle;

function withMockedUser(fn) {
  const original = User.findByIdAndUpdate;
  const calls = [];
  User.findByIdAndUpdate = (id, update, options) => {
    calls.push({ id, update, options });
    return {
      select: async () => ({
        _id: id,
        name: 'Test User',
        email: 'test@example.com',
        avatar: update.avatar,
        bio: '',
        libraryVisibility: 'private',
      }),
    };
  };
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      User.findByIdAndUpdate = original;
    })
    .then((result) => ({ result, calls }));
}

function runHandler(reqOverrides = {}) {
  const handler = getHandler();
  const res = createRes();
  const req = { user: { _id: 'u1' }, ...reqOverrides };
  return handler(req, res).then(() => res);
}

function jpegBuffer() {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg-body-for-tests')]);
}

function pngBuffer() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('png-body-for-tests'),
  ]);
}

function webpBuffer() {
  return Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBP'),
    Buffer.from('webp-body'),
  ]);
}

function runUpload({ payload, declaredType, filename = 'avatar.jpg' }) {
  const boundary = '----MelodifyAvatarTestBoundary9182';
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="${filename}"\r\nContent-Type: ${declaredType}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(head), Buffer.from(payload), Buffer.from(tail)]);
  const req = Readable.from([body]);
  req.headers = {
    'content-type': `multipart/form-data; boundary=${boundary}`,
    'content-length': String(body.length),
  };
  const res = createRes();

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = () => {
      if (!settled) {
        settled = true;
        resolve(res);
      }
    };
    const originalJson = res.json.bind(res);
    res.json = (payloadBody) => {
      originalJson(payloadBody);
      settle();
      return res;
    };

    getUploadWrapper()(req, res, () => {
      req.user = { _id: 'u1' };
      getHandler()(req, res).then(settle).catch(reject);
    });
  });
}

test('avatar endpoint accepts a valid JPEG and stores a data URL on the user', async () => {
  const { result, calls } = await withMockedUser(() => runHandler({
    file: { mimetype: 'image/jpeg', buffer: jpegBuffer() },
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.success, true);
  assert.ok(result.body.user.avatar.startsWith('data:image/jpeg;base64,'));
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0].update), ['avatar']);
  assert.deepEqual(calls[0].options, { new: true, runValidators: true });
});

test('avatar endpoint accepts valid PNG and WebP images', async () => {
  const png = await withMockedUser(() => runHandler({
    file: { mimetype: 'image/png', buffer: pngBuffer() },
  }));
  assert.ok(png.result.body.user.avatar.startsWith('data:image/png;base64,'));

  const webp = await withMockedUser(() => runHandler({
    file: { mimetype: 'image/webp', buffer: webpBuffer() },
  }));
  assert.ok(webp.result.body.user.avatar.startsWith('data:image/webp;base64,'));
});

test('avatar endpoint rejects a missing file with a fixed message', async () => {
  const res = await runHandler({});
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, 'Avatar must be a JPEG, PNG, or WebP image.');
});

test('avatar endpoint rejects content that fails image signature checks', async () => {
  const res = await runHandler({
    file: { mimetype: 'image/jpeg', buffer: Buffer.from('this-is-not-a-real-jpeg-image') },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Avatar must be a JPEG, PNG, or WebP image.');
});

test('avatar endpoint rejects disallowed mimetypes before touching the database', async () => {
  const { calls } = await withMockedUser(() => runHandler({
    file: { mimetype: 'image/gif', buffer: jpegBuffer() },
  }));
  assert.equal(calls.length, 0);
});

test('avatar update response carries no token or session fields', async () => {
  const { result } = await withMockedUser(() => runHandler({
    file: { mimetype: 'image/jpeg', buffer: jpegBuffer() },
  }));
  assert.deepEqual(Object.keys(result.body).sort(), ['success', 'user']);
  const serialized = JSON.stringify(result.body);
  assert.equal(/token/i.test(serialized), false);
  assert.equal(/password/i.test(serialized), false);
});

test('allowed avatar mimetypes are exactly JPEG, PNG, and WebP', () => {
  assert.deepEqual([...AVATAR_MIME_TYPES], ['image/jpeg', 'image/png', 'image/webp']);
});

test('detectAvatarMime recognizes only real image signatures', () => {
  assert.equal(detectAvatarMime(jpegBuffer()), 'image/jpeg');
  assert.equal(detectAvatarMime(pngBuffer()), 'image/png');
  assert.equal(detectAvatarMime(webpBuffer()), 'image/webp');
  assert.equal(detectAvatarMime(Buffer.from('plain text payload!!')), null);
  assert.equal(detectAvatarMime(Buffer.from([0xff, 0xd8])), null);
  assert.equal(detectAvatarMime('not-a-buffer'), null);
});

test('upload middleware rejects oversized avatar files with a bounded 400', async () => {
  const oversized = Buffer.alloc(AVATAR_MAX_BYTES + 2048, 0xff);
  oversized[1] = 0xd8;
  oversized[2] = 0xff;
  const res = await runUpload({ payload: oversized, declaredType: 'image/jpeg' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error, 'Avatar image must be 5MB or smaller.');
});

test('upload middleware skips unsupported file types so the handler fails closed', async () => {
  const res = await runUpload({
    payload: Buffer.from('GIF89a-not-allowed'),
    declaredType: 'image/gif',
    filename: 'anim.gif',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Avatar must be a JPEG, PNG, or WebP image.');
});

test('upload middleware accepts a small valid JPEG through the full route flow', async () => {
  const { result, calls } = await withMockedUser(() => runUpload({
    payload: jpegBuffer(),
    declaredType: 'image/jpeg',
  }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.success, true);
  assert.ok(result.body.user.avatar.startsWith('data:image/jpeg;base64,'));
  assert.equal(calls.length, 1);
});
