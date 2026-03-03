import fs from 'node:fs';
import path from 'node:path';
import { test, expect, request } from '@playwright/test';

import { loadConfig } from '../src/config.js';

// Finds the most recently modified file in a directory that matches `pattern`.
// Used to locate the latest results artifact produced by a previous test run.
function findLatestFileByPattern(dir, pattern) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const matches = [];

  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!pattern.test(e.name)) continue;
    const p = path.join(dir, e.name);
    const st = fs.statSync(p);
    matches.push({ path: p, name: e.name, mtimeMs: st.mtimeMs });
  }

  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return matches[0]?.path ?? '';
}

function loadTeamNamesFromLatestResultsFile(resultsDir) {
  // The batch-results test writes a timestamped `*_team_names.json` file.
  // This spec consumes that file as its source of truth for team names.
  const latest = findLatestFileByPattern(resultsDir, /_team_names\.json$/);
  expect(latest, `No *_team_names.json file found in results dir: ${resultsDir}. Run the batch-results test first.`).toBeTruthy();

  const txt = fs.readFileSync(latest, 'utf8');
  const parsed = JSON.parse(txt);
  expect(Array.isArray(parsed), `Latest team names file is not a JSON array: ${latest}`).toBeTruthy();
  return parsed.map((x) => String(x).trim()).filter(Boolean);
}

function timestamp() {
  // Timestamp used for output filenames in `results/`.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function getTeamLinks(page) {
  /** @type {{ name: string, href: string }[]} */
  const links = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));

    const items = anchors
      .map((a) => {
        const rawHref = a.getAttribute('href') || '';
        const name = (a.textContent || '').trim();
        return { name, href: rawHref.trim() };
      })
      .filter((x) => x.name && x.href);

    const teamLike = items.filter((x) => {
      const href = x.href;
      if (href === '/teams' || href.endsWith('/teams')) return false;
      return href.includes('/teams/') || href.includes('/team/');
    });

    const seen = new Set();
    const deduped = [];
    for (const x of teamLike) {
      if (seen.has(x.href)) continue;
      seen.add(x.href);
      deduped.push(x);
    }

    return deduped;
  });

  return links;
}

function extractTeamNamesFromApiData(data) {
  const names = [];

  if (Array.isArray(data)) {
    for (const item of data) {
      if (!item || typeof item !== 'object') continue;
      const n = item.name ?? item.teamName ?? item.team ?? item.id;
      if (typeof n === 'string' && n.trim()) names.push(n.trim());
    }
  } else if (data && typeof data === 'object') {
    const candidateArrays = [data.teams, data.items, data.data, data.results];
    for (const arr of candidateArrays) {
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        if (!item || typeof item !== 'object') continue;
        const n = item.name ?? item.teamName ?? item.team ?? item.id;
        if (typeof n === 'string' && n.trim()) names.push(n.trim());
      }
    }
  }

  return Array.from(new Set(names));
}

async function getStatusSamples(page, statusText, maxSamples) {
  const statusLoc = page.getByText(statusText, { exact: true });
  const count = await statusLoc.count();

  const sampleCount = Math.min(maxSamples, count);
  const samples = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const cell = statusLoc.nth(i);
    const rowText = await cell.locator('xpath=ancestor::tr[1]').innerText().catch(async () => {
      return cell.locator('xpath=ancestor::*[self::li or self::div][1]').innerText().catch(() => '');
    });

    if (rowText && rowText.trim()) samples.push(rowText.trim());
  }

  return { count, samples };
}

function normalizeStatus(s) {
  // Normalizes status strings from the API payload to uppercase.
  return String(s ?? '').trim().toUpperCase();
}

function findVersionIdFromPayload(payload, revisionName) {
  // `/api/v1/teams/{team}/versions` may return different shapes.
  // This helper looks through common containers and finds the version object
  // whose `name` matches `revisionName`, then returns its `id`.
  const target = String(revisionName).trim();

  /** @type {any[]} */
  const candidates = [];
  if (Array.isArray(payload)) candidates.push(...payload);
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.versions)) candidates.push(...payload.versions);
    if (Array.isArray(payload.items)) candidates.push(...payload.items);
    if (Array.isArray(payload.data)) candidates.push(...payload.data);
    if (Array.isArray(payload.results)) candidates.push(...payload.results);
  }

  for (const v of candidates) {
    if (!v || typeof v !== 'object') continue;
    const name = v.name ?? v.versionName ?? v.label;
    if (String(name ?? '').trim() !== target) continue;
    const id = v.id ?? v.versionId ?? v.ID;
    if (typeof id === 'number' || (typeof id === 'string' && String(id).trim())) return id;
  }

  return null;
}

function countStatusesInPayload(payload) {
  // The tests-and-results payload can be nested.
  // This recursively walks objects/arrays and counts any field that looks like
  // a test status.
  //
  // Requirement: Use "timesFailed" field.
  // - timesFailed == 0  => PASS
  // - timesFailed > 0   => FAILED
  let pass = 0;
  let failed = 0;

  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const x of node) visit(x);
      return;
    }
    if (typeof node !== 'object') return;

    if (Object.prototype.hasOwnProperty.call(node, 'timesFailed')) {
      const raw = node.timesFailed;
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      if (!Number.isNaN(n)) {
        if (n <= 0) pass += 1;
        else failed += 1;
      }
    }

    for (const v of Object.values(node)) visit(v);
  };

  visit(payload);
  return { pass, failed };
}

test('TestTracker: drill into each team API and capture results for a revision', async () => {
  test.setTimeout(10 * 60 * 1000);

  // Load runtime config (base URL, revision, output dir, flags)
  // baseUrl comes from config/app.yaml or TESTTRACKER_BASE_URL.
  // resultsDir comes from config/app.yaml or RESULTS_DIR.
  const cfg = loadConfig();

  // Revision name to locate in the Versions API.
  // This is the `name` field within `/api/v1/teams/{team}/versions`.
  const revisionToCheck = '26.1';

  // Ensure results output folder exists
  const resultsDir = path.resolve(process.cwd(), cfg.resultsDir);
  fs.mkdirSync(resultsDir, { recursive: true });

  const ts = timestamp();

  // Load team names from the latest `results/*_team_names.json` file.
  // This file is produced by the batch-results test.
  const teamNames = loadTeamNamesFromLatestResultsFile(resultsDir);
  expect(teamNames.length, 'No team names loaded from latest *_team_names.json file.').toBeGreaterThan(0);

  // Optional override:
  // - If TESTTRACKER_TEAM is set, that team must exist in the team names file,
  //   and it must contain revision `26.1` (otherwise we fail).
  // - If not set, we scan teams from the file until we find one that contains
  //   revision `26.1`.
  const requestedTeam = String(process.env.TESTTRACKER_TEAM ?? '').trim();
  if (requestedTeam) {
    expect(teamNames.includes(requestedTeam), `Requested team not found in latest team names file. requested=${requestedTeam}`).toBeTruthy();
  }

  // Prepare output model written at end of run
  /** @type {{ revision: string, teams: { name: string, versionId: string | number | null, passCount: number, failedCount: number, missingRevision: boolean, error?: string }[] }} */
  const out = { revision: revisionToCheck, teams: [] };

  // API base origin (e.g. http://nztesttracker:8080)
  const baseOrigin = new URL(cfg.baseUrl).origin;
  const api = await request.newContext({ baseURL: baseOrigin });

  const teamsToTry = requestedTeam ? [requestedTeam] : teamNames;
  let foundAnyRevision = false;

  for (const t of teamsToTry) {
    const teamCandidate = String(t).trim();
    if (!teamCandidate) continue;

    try {
      // 1) Versions API: /api/v1/teams/{team}/versions
      const versionsPath = `/api/v1/teams/${encodeURIComponent(teamCandidate)}/versions`;
      const versionsResp = await api.get(versionsPath, { headers: { Accept: 'application/json' } });
      const versionsOk = versionsResp.status() >= 200 && versionsResp.status() < 300;
      expect(
        versionsOk,
        `Versions request failed. team=${teamCandidate} url=${versionsResp.url()} status=${versionsResp.status()} statusText=${versionsResp.statusText()}`
      ).toBeTruthy();

      const versionsPayload = await versionsResp.json();
      const versionId = findVersionIdFromPayload(versionsPayload, revisionToCheck);

      if (versionId === null || versionId === undefined || String(versionId).trim() === '') {
        out.teams.push({
          name: teamCandidate,
          versionId: null,
          passCount: 0,
          failedCount: 0,
          missingRevision: true
        });

        console.log(`Revision=${revisionToCheck} team=${teamCandidate} versionId= missingRevision=true pass=0 failed=0`);
        continue;
      }

      foundAnyRevision = true;

      // 2) Tests-and-results API: /api/v1/tests-and-results/{team}/version/{versionId}
      const testsPath = `/api/v1/tests-and-results/${encodeURIComponent(teamCandidate)}/version/${encodeURIComponent(String(versionId))}`;
      const testsResp = await api.get(testsPath, { headers: { Accept: 'application/json' } });
      const testsOk = testsResp.status() >= 200 && testsResp.status() < 300;
      expect(
        testsOk,
        `Tests-and-results request failed. team=${teamCandidate} versionId=${versionId} url=${testsResp.url()} status=${testsResp.status()} statusText=${testsResp.statusText()}`
      ).toBeTruthy();

      const testsPayload = await testsResp.json();

      // Count PASS/FAILED statuses found anywhere in the payload.
      const counts = countStatusesInPayload(testsPayload);

      out.teams.push({
        name: teamCandidate,
        versionId,
        passCount: counts.pass,
        failedCount: counts.failed,
        missingRevision: false
      });

      console.log(
        `Revision=${revisionToCheck} team=${teamCandidate} versionId=${String(versionId)} missingRevision=false pass=${counts.pass} failed=${counts.failed}`
      );
    } catch (e) {
      out.teams.push({
        name: teamCandidate,
        versionId: null,
        passCount: 0,
        failedCount: 0,
        missingRevision: false,
        error: e instanceof Error ? e.message : String(e)
      });

      console.log(
        `Revision=${revisionToCheck} team=${teamCandidate} versionId= missingRevision=false pass=0 failed=0 error=${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  expect(foundAnyRevision, `No team found with revision=${revisionToCheck} in latest team names file.`).toBeTruthy();

  // Write output JSON to results folder
  // This includes the chosen team, resolved version id, and PASS/FAILED counts.
  fs.writeFileSync(path.join(resultsDir, `${ts}_team_drilldown_${revisionToCheck}.json`), JSON.stringify(out, null, 2), 'utf8');
});
