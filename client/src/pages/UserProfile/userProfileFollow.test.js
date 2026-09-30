import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProfileDetailRows } from './profileAboutUi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'UserProfile.jsx'), 'utf8');
const css = readFileSync(join(__dirname, 'UserProfile.css'), 'utf8');
const aboutSrc = readFileSync(join(__dirname, 'profileAboutUi.js'), 'utf8');

test('UserProfile follows users with the follow APIs and no friend-request service', () => {
  assert.match(src, /api\.post\(`\/api\/follows\/\$\{id\}`\)/);
  assert.match(src, /api\.del\(`\/api\/follows\/\$\{id\}`\)/);
  assert.match(src, /`\/api\/follows\/\$\{id\}\/followers`/);
  assert.match(src, /`\/api\/follows\/\$\{id\}\/following`/);
  assert.equal(src.includes('friendRequests'), false);
  assert.equal(/fetchFriendStatus|sendFriendRequest|acceptFriendRequest|rejectFriendRequest/.test(src), false);
  assert.equal(/friendStatus|friendRequestId|handleFriendAction|FRIEND_STATUSES|FRIEND_ACTION_LABELS/.test(src), false);
});

test('follow button label follows Following / Follow Back / Follow', () => {
  assert.match(
    src,
    /const followLabel = followLoading\s*\?\s*'Updating\.\.\.'\s*:\s*isFollowing\s*\?\s*'Following'\s*:\s*followedBy\s*\?\s*'Follow Back'\s*:\s*'Follow';/,
  );
  assert.match(src, /\{followLabel\}/);
  assert.match(src, /onClick=\{handleFollow\}/);
  assert.match(src, /disabled=\{followLoading\}/);
  assert.match(css, /\.up-follow-btn\s*\{/);
});

test('profile fetch applies the server-provided followedBy relationship', () => {
  assert.match(src, /setIsFollowing\(Boolean\(data\.isFollowing\)\)/);
  assert.match(src, /setFollowedBy\(Boolean\(data\.followedBy\)\)/);
  assert.match(src, /setFollowedBy\(Boolean\(data\.followedBy\)\);/);
  assert.match(src, /isFollowing \? 'Unfollowed user\.' : 'Now following user\.'/);
});

test('follow controls never render on your own profile', () => {
  assert.match(src, /\{!profile\.isOwnProfile && currentUser \? \(/);
  assert.equal(/isOwnProfile \? null/.test(src), false);
});

test('friend-request UX is fully retired', () => {
  assert.equal(css.includes('up-friend-actions'), false);
  assert.equal(css.includes('up-friend-btn'), false);
  assert.equal(src.includes('up-friend-actions'), false);
  assert.equal(src.includes('up-friend-btn'), false);
  assert.equal(/'Friend request sent\.'|'You are now friends\.'|'Friend request rejected\.'/.test(src), false);
  assert.equal(/Add Friend|Request Sent|Accept Request/.test(src), false);
  assert.equal(src.includes('window.location.reload'), false);
  assert.equal(src.includes('window.location.href'), false);
});

test('About section renders detail rows with optional visibility tags', () => {
  assert.match(src, /import \{ buildProfileDetailRows, getProfileDetailVisibility \} from '\.\/profileAboutUi\.js';/);
  assert.match(src, /const detailRows = useMemo\(\(\) => buildProfileDetailRows\(profile\), \[profile\]\);/);
  assert.match(src, /<dl className="up-detail-list">/);
  assert.match(src, /getProfileDetailVisibility\(profile, row\.field\)/);
  assert.match(src, /title="About"/);
  assert.match(src, /profile\.isOwnProfile \? 'Your profile details and their visibility' : 'Details this listener shares publicly'/);
  assert.match(src, /title="No public details"/);
  assert.match(css, /\.up-detail-list\s*\{/);
  assert.match(css, /\.up-detail-visibility\s*\{/);
});

test('profileAboutUi builds rows only from present fields and never bio', () => {
  assert.match(aboutSrc, /PROFILE_DETAIL_FIELDS = Object\.freeze\(\['email', 'phone', 'dob', 'gender', 'country'\]\)/);
  assert.equal(aboutSrc.includes("add('bio'"), false);
  const sample = buildProfileDetailRows({
    email: 'a@b.co',
    phone: ' 017 ',
    dob: '2000-01-02T00:00:00.000Z',
    gender: 'woman',
    country: 'BD',
    bio: 'hello',
  });
  assert.deepEqual(sample.map((row) => row.field), ['email', 'phone', 'dob', 'gender', 'country']);
  assert.equal(sample[1].value, '017');
  assert.equal(sample[2].value, '2000-01-02');
  assert.equal(sample[3].value, 'Woman');
  assert.deepEqual(
    buildProfileDetailRows({ email: 'a@b.co' }).map((row) => row.field),
    ['email'],
  );
  assert.deepEqual(buildProfileDetailRows(null), []);
});

test('follower/following dialog stays open through the shared AppDialog', () => {
  assert.match(src, /<AppDialog/);
  assert.match(src, /if \(listDialogType === 'followers'\) return 'Followers';/);
  assert.match(src, /if \(listDialogType === 'following'\) return 'Following';/);
});
