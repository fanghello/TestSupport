import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import { loadConfig } from '../src/config.js';

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function resolveInputPath(p) {
  const raw = String(p ?? '').trim();
  if (!raw) return '';
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function safeJsonParse(text, filePath) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse JSON. file=${filePath} error=${msg}`);
  }
}

function stableCopy(value) {
  if (Array.isArray(value)) return value.map(stableCopy);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const k of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    out[k] = stableCopy(value[k]);
  }
  return out;
}

function stableStringify(value) {
  return JSON.stringify(stableCopy(value), null, 2);
}

function formatValue(v, maxLen = 800) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}… (len=${s.length})`;
}

/**
 * @returns {null | { path: string, left: unknown, right: unknown, leftType: string, rightType: string }}
 */
function findFirstDifference(left, right, currentPath = '$') {
  if (Object.is(left, right)) return null;

  const leftIsArray = Array.isArray(left);
  const rightIsArray = Array.isArray(right);
  if (leftIsArray !== rightIsArray) {
    return {
      path: currentPath,
      left,
      right,
      leftType: leftIsArray ? 'array' : typeof left,
      rightType: rightIsArray ? 'array' : typeof right
    };
  }

  const leftIsObj = left !== null && typeof left === 'object';
  const rightIsObj = right !== null && typeof right === 'object';
  if (leftIsObj !== rightIsObj) {
    return { path: currentPath, left, right, leftType: typeof left, rightType: typeof right };
  }

  if (!leftIsObj || !rightIsObj) {
    return { path: currentPath, left, right, leftType: typeof left, rightType: typeof right };
  }

  if (leftIsArray && rightIsArray) {
    const a = /** @type {unknown[]} */ (left);
    const b = /** @type {unknown[]} */ (right);

    if (a.length !== b.length) {
      return {
        path: `${currentPath}.length`,
        left: a.length,
        right: b.length,
        leftType: 'number',
        rightType: 'number'
      };
    }

    for (let i = 0; i < a.length; i += 1) {
      const diff = findFirstDifference(a[i], b[i], `${currentPath}[${i}]`);
      if (diff) return diff;
    }

    return null;
  }

  const lo = /** @type {Record<string, unknown>} */ (left);
  const ro = /** @type {Record<string, unknown>} */ (right);

  const leftKeys = Object.keys(lo);
  const rightKeys = Object.keys(ro);

  const leftKeySet = new Set(leftKeys);
  for (const k of rightKeys) leftKeySet.add(k);

  const allKeys = Array.from(leftKeySet).sort((a, b) => a.localeCompare(b));
  for (const k of allKeys) {
    const hasL = Object.prototype.hasOwnProperty.call(lo, k);
    const hasR = Object.prototype.hasOwnProperty.call(ro, k);

    if (!hasL || !hasR) {
      return {
        path: `${currentPath}.${k}`,
        left: hasL ? lo[k] : undefined,
        right: hasR ? ro[k] : undefined,
        leftType: hasL ? typeof lo[k] : 'missing',
        rightType: hasR ? typeof ro[k] : 'missing'
      };
    }

    const diff = findFirstDifference(lo[k], ro[k], `${currentPath}.${k}`);
    if (diff) return diff;
  }

  return null;
}

test('JSON compare: two files should match', async () => {
  const leftPath = resolveInputPath(process.env.JSON_LEFT_PATH);
  const rightPath = resolveInputPath(process.env.JSON_RIGHT_PATH);

  expect(
    leftPath,
    'Missing JSON_LEFT_PATH env var. Example: JSON_LEFT_PATH=results/a.json JSON_RIGHT_PATH=results/b.json npm run test:json-compare'
  ).toBeTruthy();
  expect(
    rightPath,
    'Missing JSON_RIGHT_PATH env var. Example: JSON_LEFT_PATH=results/a.json JSON_RIGHT_PATH=results/b.json npm run test:json-compare'
  ).toBeTruthy();

  expect(fs.existsSync(leftPath), `Left JSON file does not exist: ${leftPath}`).toBeTruthy();
  expect(fs.existsSync(rightPath), `Right JSON file does not exist: ${rightPath}`).toBeTruthy();

  const leftText = fs.readFileSync(leftPath, 'utf8');
  const rightText = fs.readFileSync(rightPath, 'utf8');

  const leftJson = safeJsonParse(leftText, leftPath);
  const rightJson = safeJsonParse(rightText, rightPath);

  const diff = findFirstDifference(leftJson, rightJson);

  if (diff) {
    const cfg = loadConfig();
    const resultsDir = path.resolve(process.cwd(), cfg.resultsDir);
    fs.mkdirSync(resultsDir, { recursive: true });

    const ts = timestamp();
    const base = path.join(resultsDir, `${ts}_json_compare`);

    fs.writeFileSync(`${base}_left.canonical.json`, stableStringify(leftJson), 'utf8');
    fs.writeFileSync(`${base}_right.canonical.json`, stableStringify(rightJson), 'utf8');
    fs.writeFileSync(
      `${base}_diff.txt`,
      [
        `left=${leftPath}`,
        `right=${rightPath}`,
        `path=${diff.path}`,
        `leftType=${diff.leftType}`,
        `rightType=${diff.rightType}`,
        `leftValue=${formatValue(diff.left)}`,
        `rightValue=${formatValue(diff.right)}`,
        ''
      ].join('\n'),
      'utf8'
    );
  }

  expect(
    diff,
    diff
      ? `JSON files differ at ${diff.path}\nleftType=${diff.leftType} rightType=${diff.rightType}\nleft=${formatValue(diff.left)}\nright=${formatValue(diff.right)}`
      : undefined
  ).toBeNull();
});
