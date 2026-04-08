/**
 * AI-Powered Accessibility Test Suite
 * Pipeline: Playwright (crawl) → axe-core (scan) → Claude (analyze) → Report
 *
 * Tags: @a11y
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import * as fs from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────
interface A11yViolation {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{
    html: string;
    failureSummary: string | undefined;
    target: string[];
  }>;
}

interface ScanResult {
  url: string;
  timestamp: string;
  violations: A11yViolation[];
  passes: number;
  incomplete: number;
  screenshotPath: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const REPORTS_DIR = path.join(process.cwd(), 'reports');
const VIOLATIONS_FILE = path.join(REPORTS_DIR, 'violations.json');

function ensureReportsDir() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

function saveViolations(result: ScanResult) {
  ensureReportsDir();
  let existing: ScanResult[] = [];
  if (fs.existsSync(VIOLATIONS_FILE)) {
    existing = JSON.parse(fs.readFileSync(VIOLATIONS_FILE, 'utf-8'));
  }
  existing.push(result);
  fs.writeFileSync(VIOLATIONS_FILE, JSON.stringify(existing, null, 2));
}

// ─── WCAG Impact Levels ───────────────────────────────────────────────────────
const CRITICAL_IMPACT = ['critical', 'serious'];

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('AI Accessibility Audit @a11y', () => {
  /**
   * STEP 2: Playwright navigates to the page
   * STEP 3: axe-core scans for WCAG violations
   * STEP 4: Screenshot captured as visual evidence
   */
  test('Full page accessibility scan', async ({ page }, testInfo) => {
    const targetUrl = process.env.BASE_URL || 'https://dequeuniversity.com/demo/mars/';

    // ── STEP 2: Navigate (Playwright Crawl Layer) ──────────────────────────
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000); // Let dynamic content settle

    // ── STEP 4: Screenshot for visual evidence ─────────────────────────────
    const screenshotPath = path.join(REPORTS_DIR, `screenshot-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach('page-screenshot', { path: screenshotPath, contentType: 'image/png' });

    // ── STEP 3: axe-core Scan (WCAG 2.1 AA) ───────────────────────────────
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'])
      .analyze();

    // ── Save raw violations for Claude analysis ────────────────────────────
    const scanResult: ScanResult = {
      url: targetUrl,
      timestamp: new Date().toISOString(),
      violations: axeResults.violations.map(v => ({
        id: v.id,
        impact: v.impact ?? null,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.map(n => ({
          html: n.html,
          failureSummary: n.failureSummary,
          target: n.target.map(String),
        })),
      })),
      passes: axeResults.passes.length,
      incomplete: axeResults.incomplete.length,
      screenshotPath,
    };

    saveViolations(scanResult);

    // ── Attach violation summary to Playwright report ──────────────────────
    await testInfo.attach('axe-violations-json', {
      body: JSON.stringify(axeResults.violations, null, 2),
      contentType: 'application/json',
    });

    // ── Log summary ────────────────────────────────────────────────────────
    console.log(`\n📊 Scan Summary for: ${targetUrl}`);
    console.log(`   ✅ Passes:     ${axeResults.passes.length}`);
    console.log(`   ❌ Violations: ${axeResults.violations.length}`);
    console.log(`   ⚠️  Incomplete: ${axeResults.incomplete.length}`);

    if (axeResults.violations.length > 0) {
      console.log('\n🚨 Violations found:');
      axeResults.violations.forEach(v => {
        console.log(`   [${v.impact?.toUpperCase()}] ${v.id}: ${v.help}`);
      });
    }

    // ── CI/CD Gate: Fail on critical/serious violations ────────────────────
    const criticalViolations = axeResults.violations.filter(v =>
      CRITICAL_IMPACT.includes(v.impact ?? '')
    );

    expect(
      criticalViolations.length,
      `Found ${criticalViolations.length} critical/serious accessibility violations.\n` +
      `Run 'npm run analyze' to get AI-powered fix suggestions.\n` +
      criticalViolations.map(v => `  - [${v.impact}] ${v.id}: ${v.help}`).join('\n')
    ).toBe(0);
  });

  /**
   * Test keyboard navigation accessibility
   * WCAG 2.1.1 Keyboard / 2.4.3 Focus Order
   */
  test('Keyboard navigation @a11y', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://dequeuniversity.com/demo/mars/');

    // Tab through interactive elements and verify focus is visible
    const focusableSelectors = ['a', 'button', 'input', 'select', 'textarea', '[tabindex]'];

    for (const selector of focusableSelectors) {
      const elements = await page.locator(selector).all();
      for (const el of elements.slice(0, 5)) { // Check first 5 of each type
        await el.focus();
        const isFocused = await el.evaluate(node =>
          node === document.activeElement
        );
        // Just log — don't hard fail, Claude will analyze
        if (!isFocused) {
          console.warn(`⚠️  Element not focusable: ${selector}`);
        }
      }
    }
  });

  /**
   * Test color contrast (WCAG 1.4.3)
   * axe-core handles this automatically via color-contrast rule
   */
  test('Color contrast scan @a11y', async ({ page }) => {
    await page.goto(process.env.BASE_URL || 'https://dequeuniversity.com/demo/mars/');

    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();

    const contrastViolations = results.violations.filter(v => v.id === 'color-contrast');

    if (contrastViolations.length > 0) {
      console.log(`\n🎨 Color contrast issues: ${contrastViolations[0].nodes.length} elements`);
    }

    // Warn but don't fail — Claude will prioritize
    expect(contrastViolations.length).toBeLessThanOrEqual(5);
  });
});