import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const DIST_DIR = fileURLToPath(new URL('../../../dist', import.meta.url));
const INDEX_HTML = join(DIST_DIR, 'index.html');
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const EDGE_PATH = EDGE_CANDIDATES.find((p) => existsSync(p));
const SKIP_REASON = !existsSync(INDEX_HTML)
  ? 'client/dist missing - run npm run build first'
  : !EDGE_PATH
    ? 'Microsoft Edge not found'
    : false;

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const repeat = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

const API_MOCKS = {
  '/api/auth/me': {
    success: true,
    user: {
      _id: '64b64b64b64b64b64b64b642',
      name: 'Behavior Test Admin',
      email: 'admin@behavior.test',
      role: 'admin',
    },
  },
  '/api/admin/stats': {
    success: true,
    stats: {
      users: 120,
      songs: 14,
      plays: 9876,
      revenue: 4321,
      activeSubs: 37,
      pendingReports: 5,
      recentPlays: [],
      monthlyRevenue: 812,
      lastMonthRevenue: 700,
      monthlySubs: 9,
      totalSubs: 150,
      revenueByPlan: {},
    },
  },
  '/api/admin/users': {
    success: true,
    users: repeat(40, (i) => ({
      _id: `u${i}`,
      email: `user${i}@mail.test`,
      role: 'user',
      createdAt: '2026-08-01T00:00:00.000Z',
    })),
  },
  '/api/songs': {
    success: true,
    songs: repeat(14, (i) => ({
      _id: `song${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i}`,
      genre: 'Pop',
      language: 'English',
      poster_url: '',
      youtube_id: 'x',
      play_count: i * 10,
    })),
  },
  '/api/admin/reports': {
    success: true,
    reports: repeat(15, (i) => ({
      _id: `r${i}`,
      type: 'abuse',
      user_email: `user${i}@mail.test`,
      reason: 'spam',
      status: 'pending',
    })),
  },
  '/api/admin/subscriptions': {
    success: true,
    subscriptions: repeat(20, (i) => ({
      _id: `sub${i}`,
      user_email: `user${i}@mail.test`,
      plan: 'individual',
      status: 'active',
      end_date: '2026-12-01T00:00:00.000Z',
      amount: 9.99,
    })),
  },
  '/api/karaoke/all': {
    success: true,
    karaoke: repeat(12, (i) => ({
      _id: `k${i}`,
      title: `Track ${i}`,
      artist: `Artist ${i}`,
    })),
  },
  '/api/admin/recommendations/metrics': {
    success: true,
    data: {
      state: 'no-runs',
      source: 'evaluation-history',
      pipeline_stage: 'policy',
      latest: null,
    },
  },
  '/api/admin/recommendations/history': {
    success: true,
    data: {
      state: 'no-runs',
      source: 'evaluation-history',
      pipeline_stage: 'policy',
      limit: 20,
      count: 0,
      runs: [],
    },
  },
  '/api/admin/recommendations/health': {
    success: true,
    data: {
      state: 'never-run',
      source: 'retraining-health',
      lease: { active: false, run_id: null, expires_at: null },
      latest: null,
    },
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const startStaticServer = () =>
  new Promise((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        if (API_MOCKS[url.pathname]) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(API_MOCKS[url.pathname]));
          return;
        }
        if (url.pathname.startsWith('/api/')) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'not found' }));
          return;
        }
        let filePath = join(DIST_DIR, decodeURIComponent(url.pathname));
        if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = INDEX_HTML;
        const body = await readFile(filePath);
        res.writeHead(200, {
          'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
        });
        res.end(body);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });

const connectCdp = async (port, attempts = 60) => {
  let ws;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((resolve, reject) => {
          ws.onopen = resolve;
          ws.onerror = reject;
        });
        break;
      }
    } catch {
      // browser not ready yet
    }
    await sleep(250);
  }
  if (!ws) throw new Error('could not connect to Edge CDP');
  const pending = new Map();
  const exceptions = [];
  let nextId = 0;
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') {
      exceptions.push(
        message.params.exceptionDetails?.exception?.description ||
          message.params.exceptionDetails?.text ||
          'unknown exception',
      );
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      nextId += 1;
      pending.set(nextId, { resolve, reject });
      ws.send(JSON.stringify({ id: nextId, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(`evaluate failed: ${result.exceptionDetails.text}`);
    }
    return result.result.value;
  };
  const waitFor = async (expression, timeoutMs = 12000) => {
    for (let i = 0; i < timeoutMs / 200; i += 1) {
      if ((await evaluate(expression)) === true) return true;
      await sleep(200);
    }
    return false;
  };
  return { send, evaluate, waitFor, exceptions, close: () => ws.close() };
};

test(
  'admin AI Recommendation: real click chain opens the section in a browser',
  { skip: SKIP_REASON },
  async (t) => {
    const { server, port } = await startStaticServer();
    const origin = `http://127.0.0.1:${port}`;
    const profile = mkdtempSync(join(tmpdir(), 'edge-ai-behavior-'));
    const cdpPort = 10000 + Math.floor(Math.random() * 20000);
    const browser = spawn(
      EDGE_PATH,
      [
        '--headless=new',
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-gpu',
        '--window-size=1280,720',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    let cdp;
    try {
      cdp = await connectCdp(cdpPort);
      const { send, evaluate, waitFor, exceptions } = cdp;
      await send('Page.enable');
      await send('Runtime.enable');

      await send('Page.navigate', { url: `${origin}/` });
      assert.equal(
        await waitFor(`document.getElementById('root')?.childElementCount > 0`),
        true,
        'app shell must mount',
      );
      await evaluate(`localStorage.setItem('melodify_token', 'behavior-test'); 'ok'`);

      await send('Page.navigate', { url: `${origin}/admin` });
      assert.equal(
        await waitFor(
          `!!document.querySelector('.sidebar a') && !document.body.textContent.includes('Loading admin panel')`,
        ),
        true,
        'admin panel must finish loading',
      );
      await sleep(500);

      const before = await evaluate(`(() => ({
        pathname: location.pathname,
        active: document.querySelector('.sidebar a.active')?.textContent?.trim(),
        aiLink: (() => {
          const a = [...document.querySelectorAll('.sidebar a')].find(
            (x) => x.textContent.trim() === 'AI Recommendation',
          );
          if (!a) return null;
          return {
            hasActiveClass: a.classList.contains('active'),
            cursor: getComputedStyle(a).cursor,
          };
        })(),
        dashboardHeading: document.querySelector('#dashboard h2')?.textContent?.trim() || null,
        aiSectionPresent: !!document.querySelector('#ai-recommendation'),
      }))()`);
      assert.equal(before.pathname, '/admin', 'starts on the admin root path');
      assert.equal(before.active, 'Dashboard', 'default active section is Dashboard');
      assert.equal(before.dashboardHeading, 'Dashboard', 'dashboard section is rendered');
      assert.equal(before.aiSectionPresent, false, 'AI section not rendered by default');
      assert.ok(before.aiLink, 'AI Recommendation sidebar entry exists');
      assert.equal(before.aiLink.hasActiveClass, false, 'AI entry inactive before click');
      assert.equal(before.aiLink.cursor, 'pointer', 'AI entry is visibly clickable');

      await evaluate(`(() => {
        const c = document.querySelector('main.content');
        c.scrollTop = Math.round((c.scrollHeight - c.clientHeight) * 0.6);
        return c.scrollTop;
      })()`);

      const clickResult = await evaluate(`(() => {
        const a = [...document.querySelectorAll('.sidebar a')].find(
          (x) => x.textContent.trim() === 'AI Recommendation',
        );
        if (!a) return false;
        a.click();
        return true;
      })()`);
      assert.equal(clickResult, true, 'click event must fire on the AI Recommendation entry');

      assert.equal(
        await waitFor(
          `location.pathname === '/admin/ai-recommendation' &&
           document.querySelector('.sidebar a.active')?.textContent?.trim() === 'AI Recommendation'`,
        ),
        true,
        'click must sync both the URL and the active section state',
      );

      const afterClick = await evaluate(`(() => {
        const content = document.querySelector('main.content');
        const heading = document.querySelector('#ai-recommendation h2');
        const contentRect = content.getBoundingClientRect();
        const headingRect = heading ? heading.getBoundingClientRect() : null;
        return {
          pathname: location.pathname,
          active: document.querySelector('.sidebar a.active')?.textContent?.trim(),
          activeHasClass: document.querySelector('.sidebar a.active')?.classList.contains('active'),
          heading: heading?.textContent?.trim() || null,
          headingInView:
            !!headingRect &&
            headingRect.top >= contentRect.top - 1 &&
            headingRect.bottom <= contentRect.bottom + 1,
          stageButtons: [...document.querySelectorAll('.ai-rec-stage-btn')].map(
            (b) => b.textContent.trim(),
          ),
          states: [...document.querySelectorAll('.ai-rec-state')].map((s) =>
            s.textContent.trim(),
          ),
          sectionTitles: [...document.querySelectorAll('main.content h3')].map((h) =>
            h.textContent.trim(),
          ),
          errorBoundaryShown: document.body.textContent.includes('Something went wrong'),
        };
      })()`);

      assert.equal(afterClick.pathname, '/admin/ai-recommendation', 'URL is synced');
      assert.equal(afterClick.active, 'AI Recommendation', 'active sidebar entry switches');
      assert.equal(afterClick.activeHasClass, true, 'active styling is applied');
      assert.equal(afterClick.heading, 'AI Recommendation', 'AI section heading renders');
      assert.equal(afterClick.headingInView, true, 'AI section heading is inside the viewport');
      assert.deepEqual(
        afterClick.stageButtons,
        ['Policy', 'Hybrid', 'Collaborative'],
        'stage selector renders',
      );
      assert.equal(
        afterClick.states.some((s) => s.includes('No persisted evaluation run')),
        true,
        'metrics empty state is visible',
      );
      assert.equal(
        afterClick.states.some((s) => s.includes('No persisted evaluation history')),
        true,
        'history empty state is visible',
      );
      assert.equal(
        afterClick.sectionTitles.includes('Model Health'),
        true,
        'model health section renders',
      );
      assert.equal(afterClick.errorBoundaryShown, false, 'no crash fallback rendered');

      const leaveResult = await evaluate(`(() => {
        const a = [...document.querySelectorAll('.sidebar a')].find(
          (x) => x.textContent.trim() === 'Dashboard',
        );
        if (!a) return false;
        a.click();
        return true;
      })()`);
      assert.equal(leaveResult, true, 'leave click fires');
      assert.equal(
        await waitFor(
          `location.pathname === '/admin' &&
           document.querySelector('.sidebar a.active')?.textContent?.trim() === 'Dashboard'`,
        ),
        true,
        'leaving restores the previous section state and path',
      );
      const afterLeave = await evaluate(`(() => ({
        heading: document.querySelector('#dashboard h2')?.textContent?.trim() || null,
        aiSectionPresent: !!document.querySelector('#ai-recommendation'),
      }))()`);
      assert.equal(afterLeave.heading, 'Dashboard', 'dashboard view renders after leaving');
      assert.equal(afterLeave.aiSectionPresent, false, 'AI section unmounts after leaving');

      await send('Page.navigate', { url: `${origin}/admin/ai-recommendation` });
      assert.equal(
        await waitFor(
          `document.querySelector('.sidebar a.active')?.textContent?.trim() === 'AI Recommendation' &&
           document.querySelector('#ai-recommendation h2')?.textContent?.trim() === 'AI Recommendation'`,
        ),
        true,
        'deep link directly opens the AI section',
      );

      assert.deepEqual(exceptions, [], 'no uncaught page exceptions during the whole flow');
      t.diagnostic(
        `behavior verified: click -> section state -> route -> rendered AI view -> leave restore -> deep link`,
      );
    } finally {
      try {
        cdp?.close();
      } catch {
        // already closed
      }
      try {
        spawn('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch {
        // browser already exited
      }
      await sleep(300);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // profile cleanup is best-effort
      }
      await new Promise((resolve) => server.close(resolve));
    }
  },
);
