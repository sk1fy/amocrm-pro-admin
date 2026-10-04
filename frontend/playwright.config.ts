import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173'

export default defineConfig({
  testDir: './e2e',
  outputDir: process.env.E2E_ARTIFACTS_DIR
    ? `${process.env.E2E_ARTIFACTS_DIR}/test-results`
    : 'test-results',
  fullyParallel: false,
  // Files mutate one shared fixture adapter and Admin DB. Browser contexts do
  // not isolate installation guards; business concurrency is tested in Go/PG.
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
})
