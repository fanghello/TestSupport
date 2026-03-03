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

## Configuration

- `config/app.yaml`
- Environment overrides:
  - `TESTTRACKER_BASE_URL`
  - `RESULTS_DIR`
