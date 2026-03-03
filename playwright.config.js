/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './tests',
  timeout: 60_000,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'results/playwright-report', open: 'never' }]
  ],
  outputDir: 'results/test-artifacts'
};

export default config;
