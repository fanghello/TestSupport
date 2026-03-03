# TestSupport

## TestTracker batch results summary

This project fetches data from the TestTracker API endpoint `GET /teams` and produces a summary showing:

- which **batch** belongs to which **revision**
- how many **test cases failed** per batch

Outputs are written under the `results/` folder.

## Run

1. Install dependencies

```
npm install
npx playwright install
```

2. Run the summary workflow

```
npm run test:summary
```

3. Run Playwright

```powershell
npm test
```

Open the last HTML report:

```powershell
npm run show-report
```

## JSON file compare

Run a test that compares two JSON files and fails with the first difference path.

```powershell
$env:JSON_LEFT_PATH = "left\\file-a.json"
$env:JSON_RIGHT_PATH = "right\\file-b.json"
npm run test:json-compare
```

## Configuration

- `config/app.yaml`
- Environment overrides:
  - `TESTTRACKER_BASE_URL`
  - `RESULTS_DIR`
