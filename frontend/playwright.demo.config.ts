import { defineConfig } from '@playwright/test'
import config from './playwright.config'

export default defineConfig({
  ...config,
  testDir: './e2e-demo',
  use: { ...config.use, baseURL: process.env.E2E_DEMO_BASE_URL ?? 'http://127.0.0.1:5175' },
})
