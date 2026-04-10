/**
 * Multi-Page Accessibility Crawler
 * Crawls entire website and runs axe-core on every page
 * 
 * Usage: npx ts-node scripts/multi-page-crawler.ts
 */

import { chromium, Browser, Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ─── Configuration ────────────────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || 'https://interview-prep-app-plvmxg.abacusai.app/';
const MAX_PAGES = parseInt(process.env.MAX_PAGES || '10');
const REPORTS_DIR = path.join(process.cwd(), 'reports');
const CRAWL_REPORT = path.join(REPORTS_DIR, 'crawl-results.json');
const CRAWL_HTML   = path.join(REPORTS_DIR, 'crawl-report.html');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Types ────────────────────────────────────────────────────────────────────
interface PageScanResult {
  url: string;
  title: string;
  violations: any[];
  passes: number;
  incomplete: number;
  screenshotPath: string;
  scanDuration: number;
  status: 'success' | 'error';
  error?: string;
}

interface CrawlSummary {
  baseUrl: string;
  timestamp: string;
  totalPages: number;
  totalViolations: number;
  criticalCount: number;
  seriousCount: number;
  moderateCount: number;
  minorCount: number;
  mostProblematicPage: string;
  cleanestPage: string;
  pages: PageScanResult[];
}

// ─── STEP 1: Link Extractor ───────────────────────────────────────────────────
async function extractLinks(page: Page, baseUrl: string): Promise<string[]> {
  const links = await page.evaluate((base) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    return anchors
      .map(a => (a as HTMLAnchorElement).href)
      .filter(href => {
        try {
          const url = new URL(href);
          const baseUrlObj = new URL(base);
          // Same domain only — no external links
          return url.hostname === baseUrlObj.hostname &&
                 !href.includes('#') &&           // Skip anchor links
                 !href.match(/\.(pdf|jpg|png|gif|svg|css|js|ico)$/i); // Skip files
        } catch { return false; }
      });
  }, baseUrl);

  // Deduplicate
  return [...new Set(links)];
}

// ─── STEP 2: Single Page Scanner ─────────────────────────────────────────────
async function scanPage(
  browser: Browser,
  url: string,
  index: number
): Promise<PageScanResult> {
  const page = await browser.newPage();
  const start = Date.now();

  try {
    console.log(`\n   📄 [${index}] Scanning: ${url}`);

    // Navigate with timeout
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForTimeout(1000);

    // Get page title
    const title = await page.title();

    // Screenshot
    const screenshotPath = path.join(
      REPORTS_DIR,
      `page-${index}-${Date.now()}.png`
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // axe-core scan
    const axeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    const duration = Date.now() - start;

    console.log(`   ✅ Done in ${duration}ms — ${axeResults.violations.length} violations`);

    return {
      url,
      title,
      violations: axeResults.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 3).map(n => ({
          html: n.html,
          failureSummary: n.failureSummary,
          target: n.target.map(String),
        })),
      })),
      passes: axeResults.passes.length,
      incomplete: axeResults.incomplete.length,
      screenshotPath,
      scanDuration: duration,
      status: 'success',
    };

  } catch (error: any) {
    console.log(`   ❌ Failed: ${error.message}`);
    return {
      url,
      title: 'Error',
      violations: [],
      passes: 0,
      incomplete: 0,
      screenshotPath: '',
      scanDuration: Date.now() - start,
      status: 'error',
      error: error.message,
    };
  } finally {
    await page.close();
  }
}

// ─── STEP 3: Claude Summary Analysis ─────────────────────────────────────────
async function generateCrawlInsights(summary: CrawlSummary): Promise<string> {
  console.log('\n🤖 Claude is analyzing full site crawl...');

  // Build violation frequency map
  const violationFrequency: Record<string, number> = {};
  summary.pages.forEach(p => {
    p.violations.forEach(v => {
      violationFrequency[v.id] = (violationFrequency[v.id] || 0) + 1;
    });
  });

  const topViolations = Object.entries(violationFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, count]) => `${id}: ${count} pages`)
    .join('\n');

  const prompt = `You are an accessibility consultant reviewing a full website audit.

<crawl_summary>
  <base_url>${summary.baseUrl}</base_url>
  <pages_scanned>${summary.totalPages}</pages_scanned>
  <total_violations>${summary.totalViolations}</total_violations>
  <critical>${summary.criticalCount}</critical>
  <serious>${summary.seriousCount}</serious>
  <moderate>${summary.moderateCount}</moderate>
  <most_problematic_page>${summary.mostProblematicPage}</most_problematic_page>
  <cleanest_page>${summary.cleanestPage}</cleanest_page>
  <top_violations_by_frequency>
${topViolations}
  </top_violations_by_frequency>
</crawl_summary>

Provide an executive summary for a QA Manager. Respond with JSON only:
{
  "executiveSummary": "2-3 sentence overview for management",
  "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
  "topPriority": "single most important thing to fix first",
  "estimatedFixTime": "total estimated time to fix all violations",
  "recommendation": "strategic recommendation in 1-2 sentences",
  "complianceStatus": "COMPLIANT|AT_RISK|NON_COMPLIANT"
}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('');

  return text.replace(/```json|```/g, '').trim();
}

// ─── STEP 4: HTML Report Generator ───────────────────────────────────────────
function generateCrawlHTML(summary: CrawlSummary, insights: any): string {
  const riskColor: Record<string, string> = {
    CRITICAL: '#dc2626',
    HIGH:     '#ea580c',
    MEDIUM:   '#d97706',
    LOW:      '#65a30d',
  };

  const complianceColor: Record<string, string> = {
    'NON_COMPLIANT': '#dc2626',
    'AT_RISK':       '#d97706',
    'COMPLIANT':     '#22c55e',
  };

  const pageRows = summary.pages
    .sort((a, b) => b.violations.length - a.violations.length)
    .map(p => `
      <tr>
        <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">
          <a href="${p.url}" target="_blank" style="color:#60a5fa">${p.url}</a>
        </td>
        <td>${p.title.slice(0, 40)}</td>
        <td style="color:${p.violations.length > 0 ? '#ef4444' : '#22c55e'};font-weight:700">
          ${p.violations.length}
        </td>
        <td>${p.passes}</td>
        <td>${p.scanDuration}ms</td>
        <td>
          ${p.violations.map(v => `
            <span style="background:${
              v.impact === 'critical' ? '#dc2626' :
              v.impact === 'serious'  ? '#ea580c' :
              v.impact === 'moderate' ? '#d97706' : '#65a30d'
            };color:white;padding:1px 6px;border-radius:3px;font-size:0.7rem;margin:1px;display:inline-block">
              ${v.id}
            </span>`).join('')}
        </td>
      </tr>`
    ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Full Site Accessibility Crawl — ${summary.baseUrl}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { color: #f8fafc; font-size: 1.5rem; margin-bottom: 0.5rem; }
    h2 { color: #94a3b8; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 1.5rem 0 0.75rem; }
    .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .stats { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
    .stat { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem 1.5rem; min-width: 130px; }
    .stat .num { font-size: 2.5rem; font-weight: 700; }
    .stat .label { color: #94a3b8; font-size: 0.75rem; }
    .insights { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
    .insight-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-top: 1rem; }
    .insight-item { background: #0f172a; border-radius: 6px; padding: 0.75rem; }
    .insight-item .label { color: #64748b; font-size: 0.75rem; text-transform: uppercase; margin-bottom: 0.25rem; }
    .insight-item .value { color: #e2e8f0; font-size: 0.875rem; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; color: white; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th { background: #0f172a; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.75rem 1rem; text-align: left; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; font-size: 0.8rem; vertical-align: top; }
    a { color: #60a5fa; }
  </style>
</head>
<body>
  <h1>🕷️ Full Site Accessibility Crawl</h1>
  <p class="meta">
    Base URL: <code>${summary.baseUrl}</code> &nbsp;|&nbsp;
    Scanned: ${new Date(summary.timestamp).toLocaleString()} &nbsp;|&nbsp;
    WCAG 2.1 AA
  </p>

  <!-- Stats -->
  <div class="stats">
    <div class="stat"><div class="num">${summary.totalPages}</div><div class="label">Pages Scanned</div></div>
    <div class="stat"><div class="num" style="color:#ef4444">${summary.totalViolations}</div><div class="label">Total Violations</div></div>
    <div class="stat"><div class="num" style="color:#dc2626">${summary.criticalCount}</div><div class="label">Critical</div></div>
    <div class="stat"><div class="num" style="color:#ea580c">${summary.seriousCount}</div><div class="label">Serious</div></div>
    <div class="stat"><div class="num" style="color:#d97706">${summary.moderateCount}</div><div class="label">Moderate</div></div>
  </div>

  <!-- Claude Insights -->
  <div class="insights">
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.5rem">
      <h2 style="margin:0">🤖 Claude Executive Summary</h2>
      <span class="badge" style="background:${riskColor[insights.riskLevel] ?? '#6b7280'}">
        ${insights.riskLevel} RISK
      </span>
      <span class="badge" style="background:${complianceColor[insights.complianceStatus] ?? '#6b7280'}">
        ${insights.complianceStatus}
      </span>
    </div>
    <p style="color:#cbd5e1;font-size:0.9rem;margin-bottom:1rem">${insights.executiveSummary}</p>
    <div class="insight-grid">
      <div class="insight-item">
        <div class="label">Top Priority</div>
        <div class="value">${insights.topPriority}</div>
      </div>
      <div class="insight-item">
        <div class="label">Est. Fix Time</div>
        <div class="value">${insights.estimatedFixTime}</div>
      </div>
      <div class="insight-item">
        <div class="label">Recommendation</div>
        <div class="value">${insights.recommendation}</div>
      </div>
      <div class="insight-item">
        <div class="label">Most Problematic Page</div>
        <div class="value" style="word-break:break-all">${summary.mostProblematicPage}</div>
      </div>
    </div>
  </div>

  <!-- Page Results Table -->
  <h2>📄 Results by Page</h2>
  <table>
    <thead>
      <tr>
        <th>URL</th>
        <th>Title</th>
        <th>Violations</th>
        <th>Passes</th>
        <th>Scan Time</th>
        <th>Issues Found</th>
      </tr>
    </thead>
    <tbody>${pageRows}</tbody>
  </table>
</body>
</html>`;
}

// ─── Main Crawler ─────────────────────────────────────────────────────────────
async function main() {
  console.log('🕷️  Multi-Page Accessibility Crawler');
  console.log(`   Target: ${BASE_URL}`);
  console.log(`   Max pages: ${MAX_PAGES}\n`);

  if (!fs.existsSync(REPORTS_DIR)) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
  }

  const browser = await chromium.launch({ headless: true });

  try {
    // ── Discover pages ──────────────────────────────────────────────────────
    console.log('🔍 Discovering pages...');
    const homePage = await browser.newPage();
    await homePage.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    const discoveredLinks = await extractLinks(homePage, BASE_URL);
    await homePage.close();

    // Always include homepage + discovered links
    const pagesToScan = [BASE_URL, ...discoveredLinks]
      .filter((url, i, arr) => arr.indexOf(url) === i) // dedupe
      .slice(0, MAX_PAGES);

    console.log(`✅ Found ${pagesToScan.length} pages to scan:\n`);
    pagesToScan.forEach((url, i) => console.log(`   ${i + 1}. ${url}`));

    // ── Scan each page ──────────────────────────────────────────────────────
    console.log('\n🎭 Scanning pages with Playwright + axe-core...');
    const results: PageScanResult[] = [];

    for (let i = 0; i < pagesToScan.length; i++) {
      const result = await scanPage(browser, pagesToScan[i], i + 1);
      results.push(result);
      // Small pause between pages
      await new Promise(r => setTimeout(r, 500));
    }

    // ── Build summary ───────────────────────────────────────────────────────
    const allViolations = results.flatMap(r => r.violations);
    const criticalCount = allViolations.filter(v => v.impact === 'critical').length;
    const seriousCount  = allViolations.filter(v => v.impact === 'serious').length;
    const moderateCount = allViolations.filter(v => v.impact === 'moderate').length;
    const minorCount    = allViolations.filter(v => v.impact === 'minor').length;

    const sortedByViolations = [...results].sort(
      (a, b) => b.violations.length - a.violations.length
    );

    const summary: CrawlSummary = {
      baseUrl: BASE_URL,
      timestamp: new Date().toISOString(),
      totalPages: results.length,
      totalViolations: allViolations.length,
      criticalCount,
      seriousCount,
      moderateCount,
      minorCount,
      mostProblematicPage: sortedByViolations[0]?.url ?? 'N/A',
      cleanestPage: sortedByViolations[sortedByViolations.length - 1]?.url ?? 'N/A',
      pages: results,
    };

    // Save crawl results
    fs.writeFileSync(CRAWL_REPORT, JSON.stringify(summary, null, 2));
    console.log(`\n💾 Crawl results saved: ${CRAWL_REPORT}`);

    // ── Claude executive summary ────────────────────────────────────────────
    const insightsRaw = await generateCrawlInsights(summary);
    const insights = JSON.parse(insightsRaw);

    // ── Generate HTML report ────────────────────────────────────────────────
    const html = generateCrawlHTML(summary, insights);
    fs.writeFileSync(CRAWL_HTML, html);

    // ── Print summary ───────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(50));
    console.log('📊 CRAWL COMPLETE\n');
    console.log(`   Pages scanned:    ${summary.totalPages}`);
    console.log(`   Total violations: ${summary.totalViolations}`);
    console.log(`   Critical:         ${criticalCount}`);
    console.log(`   Serious:          ${seriousCount}`);
    console.log(`   Risk Level:       ${insights.riskLevel}`);
    console.log(`   Compliance:       ${insights.complianceStatus}`);
    console.log(`\n   Most issues:  ${summary.mostProblematicPage}`);
    console.log(`   Cleanest page: ${summary.cleanestPage}`);
    console.log('\n' + '='.repeat(50));
    console.log(`\n📊 HTML report: ${CRAWL_HTML}`);

  } finally {
    await browser.close();
  }
}

main().catch(console.error);