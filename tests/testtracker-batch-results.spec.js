import fs from 'node:fs';
import path from 'node:path';
import { test, expect, request } from '@playwright/test';

import { loadConfig } from '../src/config.js';

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

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

test('TestTracker: get batch names from teams API', async () => {
  // Load runtime config (base URL, output dir, flags)
  const cfg = loadConfig();

  // Ensure results output folder exists
  const resultsDir = path.resolve(process.cwd(), cfg.resultsDir);
  fs.mkdirSync(resultsDir, { recursive: true });

  // Build API request details
  const ts = timestamp();
  const baseOrigin = new URL(cfg.baseUrl).origin;
  const teamsApiPath = '/api/v1/teams/';

  // Call TestTracker API to get all team/batch data
  const api = await request.newContext({ baseURL: baseOrigin });
  const resp = await api.get(teamsApiPath, { headers: { Accept: 'application/json' } });

  // Determine request success explicitly from the HTTP status code
  const isOk = resp.status() >= 200 && resp.status() < 300;

  // On failure, write response details to a file for debugging
  if (!isOk) {
    const bodyText = await resp.text().catch(() => '');
    fs.writeFileSync(
      path.join(resultsDir, `${ts}_teams_error_${resp.status()}.txt`),
      `url=${resp.url()}\nstatus=${resp.status()}\nstatusText=${resp.statusText()}\n\n${bodyText}`,
      'utf8'
    );
  }

  // Fail the test if the API request failed
  console.log(`HTTP status=${resp.status()} ok=${resp.ok()} isOk=${isOk}`);
  expect(isOk).toBeTruthy();
  
  expect(
    isOk,
    `Request failed. url=${resp.url()} status=${resp.status()} statusText=${resp.statusText()} ok=${resp.ok()}`
  ).toBeTruthy();


  // Parse JSON response
  const data = await resp.json();

  // Extract team names from API response and store them into an array
  const teamNames = extractTeamNamesFromApiData(data);
  fs.writeFileSync(path.join(resultsDir, `${ts}_team_names.json`), JSON.stringify(teamNames, null, 2), 'utf8');

  // Also capture available version names per team (useful for choosing revision tabs in UI)
  const teamVersions = Array.isArray(data)
    ? data.map((t) => ({
      teamName: t?.teamName ?? t?.name ?? t?.team ?? t?.id ?? '',
      versions: Array.isArray(t?.versions) ? t.versions.map((v) => v?.name).filter(Boolean) : []
    }))
    : [];
  fs.writeFileSync(path.join(resultsDir, `${ts}_team_versions.json`), JSON.stringify(teamVersions, null, 2), 'utf8');

  // Optionally write raw API response to results folder
  if (cfg.writeRaw) {
    fs.writeFileSync(path.join(resultsDir, `${ts}_teams_api.json`), JSON.stringify(data, null, 2), 'utf8');
  }

  console.log(`Batches=${teamNames.length}`);
});
