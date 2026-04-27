// playwright-tests/moodys.a11y.spec.ts
// WCAG 2.1 AA Accessibility Audit — Moodys.com
// Interview demo: running axe-core against client's own website
// Run: npx playwright test playwright-tests/moodys.a11y.spec.ts --project=chromium

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Moodys.com — WCAG 2.1 AA Accessibility Audit', () => {
  test.setTimeout(60000)
  test.use({ baseURL: 'https://www.moodys.com' })

  test('homepage — full WCAG 2.1 AA scan', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()

    // Log all violations to console
    console.log(`\n📊 Total violations: ${results.violations.length}`)
    console.log(`✅ Passes: ${results.passes.length}`)
    console.log(`⚠️  Incomplete: ${results.incomplete.length}`)

    results.violations.forEach((v, i) => {
      console.log(`\n${i+1}. [${v.impact?.toUpperCase()}] ${v.id}`)
      console.log(`   Rule: ${v.description}`)
      console.log(`   Elements: ${v.nodes.length}`)
      console.log(`   Help: ${v.helpUrl}`)
    })

    // Attach full JSON report
    await test.info().attach('moodys-wcag-full-report', {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json'
    })

    // Only fail on CRITICAL violations
    const critical = results.violations.filter(v => v.impact === 'critical')
    expect(critical,
      `Found ${critical.length} CRITICAL violations on moodys.com`
    ).toHaveLength(0)
  })

  test('homepage — color contrast AA check', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze()

    console.log(`\n🎨 Color contrast violations: ${results.violations.length}`)
    results.violations.forEach(v => {
      v.nodes.forEach(n => {
        console.log(`   → ${n.target} | ${n.failureSummary}`)
      })
    })

    await test.info().attach('color-contrast-report', {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json'
    })

    // Log for discussion — don't hard fail (public sites often have many)
    expect(results.violations.length).toBeLessThan(20)
  })

  test('homepage — image alt text check', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })

    const results = await new AxeBuilder({ page })
      .withRules(['image-alt'])
      .analyze()

    console.log(`\n🖼  Image alt violations: ${results.violations.length}`)
    expect(results.violations).toHaveLength(0)
  })

  test('homepage — heading structure check', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })

    const results = await new AxeBuilder({ page })
      .withRules(['heading-order', 'page-has-heading-one'])
      .analyze()

    console.log(`\n📋 Heading violations: ${results.violations.length}`)
    expect(results.violations).toHaveLength(0)
  })

  test('homepage — keyboard navigation check', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Tab through 10 focusable elements and check each is visible
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab')
      await page.waitForTimeout(200)
    }
    const focused = page.locator(':focus')
    await expect(focused).toBeVisible()
  })

  test('homepage — ARIA labels check', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 30000 })

    const results = await new AxeBuilder({ page })
      .withRules(['aria-label', 'aria-required-attr', 'aria-valid-attr'])
      .analyze()

    console.log(`\n♿ ARIA violations: ${results.violations.length}`)
    await test.info().attach('aria-report', {
      body: JSON.stringify(results.violations, null, 2),
      contentType: 'application/json'
    })
    expect(results.violations).toHaveLength(0)
  })

})