import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

export function loadConfig() {
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cfgPath = path.join(projectRoot, 'config', 'app.yaml');

  const cfgText = fs.readFileSync(cfgPath, 'utf8');
  const cfg = yaml.load(cfgText) ?? {};

  const baseUrl = process.env.TESTTRACKER_BASE_URL || cfg?.testtracker?.base_url || 'http://nztesttracker:8080';
  const revisionFilter = process.env.TESTTRACKER_REVISION || cfg?.testtracker?.revision || '';
  const resultsDir = process.env.RESULTS_DIR || cfg?.results?.dir || 'results';

  return {
    baseUrl: String(baseUrl).replace(/\/+$/, ''),
    revisionFilter: String(revisionFilter).trim(),
    resultsDir: String(resultsDir),
    writeRaw: Boolean(cfg?.results?.write_raw_response ?? true),
    writeSummaryJson: Boolean(cfg?.results?.write_summary_json ?? true),
    writeSummaryText: Boolean(cfg?.results?.write_summary_text ?? true)
  };
}
