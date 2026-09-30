import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FRIEND_ACTION_LABELS, FRIEND_STATUSES } from '../../services/friendRequests.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'UserProfile.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'UserProfile.css'), 'utf8');

test('10. UserProfile loads and renders the friendship state', () => {
  assert.match(src, /import \{[\s\S]*?fetchFriendStatus,[\s\S]*?\} from '\.\.\/\.\.\/services\/friendRequests\.js';/);
  assert.match(src, /await fetchFriendStatus\(id, \{ apiClient: api \}\)/);
  assert.match(src, /setFriendStatus\(result\.status\)/);
  assert.match(src, /friendStatus === FRIEND_STATUSES\.NONE/);
  assert.equal(src.includes('window.location.href'), false);
});

test('11. Add Friend action sends a friend request', () => {
  assert.match(src, /onClick=\{\(\) => handleFriendAction\('send'\)\}/);
  assert.match(src, /await sendFriendRequest\(id, \{ apiClient: api \}\)/);
  assert.equal(FRIEND_ACTION_LABELS.none, 'Add Friend');
});

test('12. outgoing request shows Request Sent and is not re-clickable', () => {
  assert.match(src, /friendStatus === FRIEND_STATUSES\.OUTGOING_PENDING/);
  assert.match(src, /\{FRIEND_ACTION_LABELS\.outgoing_pending\}/);
  assert.equal(FRIEND_ACTION_LABELS.outgoing_pending, 'Request Sent');
  const block = src.match(/friendStatus === FRIEND_STATUSES\.OUTGOING_PENDING \? \([\s\S]*?\) : null/);
  assert.ok(block, 'outgoing branch exists');
  assert.match(block[0], /disabled/);
  assert.equal(/onClick/.test(block[0]), false);
});

test('13. incoming request shows Accept and Reject', () => {
  assert.match(src, /friendStatus === FRIEND_STATUSES\.INCOMING_PENDING/);
  assert.match(src, /onClick=\{\(\) => handleFriendAction\('accept'\)\}/);
  assert.match(src, /onClick=\{\(\) => handleFriendAction\('reject'\)\}/);
  assert.match(src, /await acceptFriendRequest\(friendRequestId, \{ apiClient: api \}\)/);
  assert.match(src, /await rejectFriendRequest\(friendRequestId, \{ apiClient: api \}\)/);
  assert.equal(FRIEND_ACTION_LABELS.incoming_pending, 'Accept Request');
});

test('14. friends state renders the Friends label', () => {
  assert.match(src, /friendStatus === FRIEND_STATUSES\.FRIENDS/);
  assert.match(src, /\{FRIEND_ACTION_LABELS\.friends\}/);
  assert.equal(FRIEND_ACTION_LABELS.friends, 'Friends');
});

test('friend controls never render on your own profile', () => {
  assert.match(src, /\{!profile\.isOwnProfile && currentUser \? \(/);
  assert.equal(/isOwnProfile \? null/.test(src), false);
});

test('follow actions are preserved alongside friend actions', () => {
  assert.match(src, /api\.post\(`\/api\/follows\/\$\{id\}`\)/);
  assert.match(src, /api\.del\(`\/api\/follows\/\$\{id\}`\)/);
  assert.match(src, /`\/api\/follows\/\$\{id\}\/followers`/);
  assert.match(src, /onClick=\{handleFollow\}/);
  assert.match(src, /up-follow-btn/);
  assert.match(src, /up-friend-actions/);
  assert.match(css, /\.up-friend-actions\s*\{/);
  assert.match(css, /\.up-friend-btn\s*\{/);
});

test('friend state changes update the UI without a full page reload', () => {
  assert.equal(src.includes('window.location.reload'), false);
  assert.equal(src.includes('window.location.href'), false);
  assert.equal(src.includes("'Friend request sent.'"), true);
  assert.equal(src.includes("'You are now friends.'"), true);
  assert.equal(src.includes("'Friend request rejected.'"), true);
  assert.match(src, /setFriendStatus\(result\.status\)/);
});
