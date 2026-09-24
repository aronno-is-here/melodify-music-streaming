import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, 'Dashboard.css'), 'utf8');
const jsx = readFileSync(join(__dirname, 'Dashboard.jsx'), 'utf8');

function extractBlocks(src, openPattern) {
  const blocks = [];
  const re = new RegExp(openPattern, 'g');
  let match;
  while ((match = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') depth -= 1;
      i += 1;
    }
    blocks.push({ open: match[0], body: src.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

function parseRules(body) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(body))) {
    rules.push({ selector: match[1].trim(), body: match[2] });
  }
  return rules;
}

function selectorList(rule) {
  return rule.selector.split(',').map((part) => part.trim());
}

const mobileBlocks = extractBlocks(css, '@media\\s*\\(max-width:\\s*768px\\)\\s*\\{');
const mobileRules = mobileBlocks.flatMap((block) => parseRules(block.body));
const allMediaBlocks = extractBlocks(css, '@media[^{]*\\{');
let baseCss = css;
for (const block of allMediaBlocks) {
  const at = baseCss.indexOf(block.open);
  baseCss = baseCss.slice(0, at) + baseCss.slice(at + block.open.length + block.body.length + 1);
}
const baseRules = parseRules(baseCss);

const rulesFor = (rules, selector) => rules.filter((rule) => selectorList(rule).includes(selector));

test('1: <=768 Dashboard becomes one column', () => {
  const mainRules = rulesFor(mobileRules, 'main');
  assert.ok(mainRules.length > 0, 'mobile main rule exists');
  assert.ok(mainRules.some((rule) => /grid-template-columns:\s*1fr/.test(rule.body)));
});

test('2: mobile Dashboard does not retain the fixed viewport-height trap', () => {
  const mainRules = rulesFor(mobileRules, 'main');
  assert.ok(mainRules.some((rule) => /height:\s*auto/.test(rule.body)));
  assert.equal(mainRules.some((rule) => /(?<!-)height:\s*calc\(100vh - 60px\)/.test(rule.body)), false);
  const htmlRules = rulesFor(mobileRules, 'html');
  assert.ok(htmlRules.some((rule) => /height:\s*auto/.test(rule.body)));
  assert.equal(htmlRules.some((rule) => rule.body.includes('height: 100%')), false);
});

test('3: mobile page/content vertical scrolling is enabled', () => {
  const htmlRules = rulesFor(mobileRules, 'html');
  const bodyRules = rulesFor(mobileRules, 'body');
  for (const rules of [htmlRules, bodyRules]) {
    assert.ok(rules.some((rule) => /overflow-y:\s*auto/.test(rule.body)));
    assert.ok(rules.some((rule) => /overflow-x:\s*hidden/.test(rule.body)));
  }
  const base = rulesFor(baseRules, 'html');
  assert.ok(base.some((rule) => rule.body.includes('overflow: hidden')));
});

test('4: mobile stacked columns are reachable without clipping', () => {
  const gridRules = rulesFor(mobileRules, '.scroll-grid');
  assert.ok(gridRules.length > 0, 'mobile .scroll-grid rules exist');
  assert.ok(gridRules.some((rule) => rule.body.includes('overflow: visible')));
  assert.ok(gridRules.some((rule) => /height:\s*auto/.test(rule.body)));
  const playlistRules = rulesFor(mobileRules, '.playlist-list');
  assert.ok(playlistRules.some((rule) => /max-height:\s*none/.test(rule.body)));
});

test('5: column 2 is not hover dependent for vertical scrolling', () => {
  const hoverRules = rulesFor(mobileRules, '.scroll-grid:hover');
  assert.ok(hoverRules.length > 0, 'mobile .scroll-grid:hover override exists');
  assert.ok(hoverRules.some((rule) => rule.body.includes('overflow: visible')));
  assert.equal(hoverRules.some((rule) => /overflow-y:\s*auto/.test(rule.body)), false);
});

test('6: column 3 is not hover dependent for vertical scrolling', () => {
  const columnRules = [
    ...rulesFor(mobileRules, '.scroll-grid:nth-child(3)'),
    ...rulesFor(mobileRules, '.scroll-grid:nth-child(3):hover'),
  ];
  assert.ok(columnRules.length > 0, 'mobile column 3 override exists');
  assert.ok(columnRules.some((rule) => rule.body.includes('overflow: visible')));
  const collapsedRules = rulesFor(mobileRules, 'main.collapsed .scroll-grid:nth-child(1)');
  assert.ok(collapsedRules.some((rule) => rule.body.includes('overflow: visible')));
});

test('7: desktop three column layout remains', () => {
  const mainRules = rulesFor(baseRules, 'main');
  assert.ok(mainRules.some((rule) => /grid-template-columns:\s*25%\s+50%\s+25%/.test(rule.body)));
  assert.ok(mainRules.some((rule) => rule.body.includes('height: calc(100vh - 60px)')));
  const gridRules = rulesFor(baseRules, '.scroll-grid');
  assert.ok(gridRules.some((rule) => /overflow-y:\s*hidden/.test(rule.body)));
});

test('8: Trending Now remains present', () => {
  assert.ok(jsx.includes('Trending Now'));
});

test('9: Recommended For You remains present', () => {
  assert.ok(jsx.includes('Recommended For You'));
  assert.equal(jsx.includes('Recommended Songs'), false);
});

test('10: Now Playing remains present', () => {
  assert.ok(jsx.includes('Now Playing'));
});

test('mobile horizontal card rows stay horizontally scrollable', () => {
  const recentRules = rulesFor(baseRules, '.recent-grid');
  assert.ok(recentRules.some((rule) => /overflow-x:\s*auto/.test(rule.body)));
});

test('mobile control strip cannot force horizontal page overflow', () => {
  const controlRules = rulesFor(mobileRules, '.controls');
  assert.ok(controlRules.some((rule) => /max-width:\s*380px/.test(rule.body)));
  assert.ok(controlRules.some((rule) => /width:\s*100%/.test(rule.body)));
  const baseControls = rulesFor(baseRules, '.controls');
  assert.ok(baseControls.some((rule) => rule.body.includes('width: 380px')));
});

test('mobile stacked columns drop the negative side margin', () => {
  const gridRules = rulesFor(mobileRules, '.scroll-grid');
  assert.ok(gridRules.some((rule) => /margin-left:\s*0/.test(rule.body)));
});

test('playback status surface styles exist for the Now Playing column', () => {
  const statusRules = rulesFor(baseRules, '.np-status');
  const retryRules = rulesFor(baseRules, '.np-retry-btn');
  assert.ok(statusRules.length > 0);
  assert.ok(retryRules.length > 0);
  assert.ok(jsx.includes('np-status'));
  assert.ok(jsx.includes('np-retry-btn'));
});
