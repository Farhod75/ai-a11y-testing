/**
 * Claude AI Accessibility Analyzer
 * Pipeline Steps 5–7: Chunk violations → Build prompt → Claude reasons → Output
 *
 * Usage: node scripts/analyze-with-claude.js
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config();

// ─── Types ────────────────────────────────────────────────────────────────────
interface Violation {
  id: string;
  impact: string | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: Array<{
    html: string;
    failureSummary?: string;
    target: string[];
  }>;
}

interface ScanResult {
  url: string;
  timestamp: string;
  violations: Violation[];
  passes: number;
  incomplete: number;
}

interface ClaudeAnalysis {
  violationId: string;
  impact: string;
  summary: string;
  rootCause: string;
  fixCode: string;
  wcagCriteria: string;
  priority: number;
  estimatedEffort: string;
  // ── New fields from improved prompt ──
  affectedUsers?: string;
  legalRisk?: string;
  storyPoints?: number;
  testCode?: string;
  before?: string;
  after?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const REPORTS_DIR = path.join(process.cwd(), 'reports');
const VIOLATIONS_FILE = path.join(REPORTS_DIR, 'violations.json');
const AI_ANALYSIS_FILE = path.join(REPORTS_DIR, 'ai-analysis.json');
const HTML_REPORT_FILE = path.join(REPORTS_DIR, 'ai-a11y-report.html');

// ─── STEP 5: Chunking — Group violations by impact ───────────────────────────
function chunkViolations(violations: Violation[]): Map<string, Violation[]> {
  const chunks = new Map<string, Violation[]>();
  const order = ['critical', 'serious', 'moderate', 'minor', 'unknown'];

  for (const impact of order) {
    const group = violations.filter(v => (v.impact ?? 'unknown') === impact);
    if (group.length > 0) chunks.set(impact, group);
  }
  return chunks;
}

function buildPrompt(violation: Violation, url: string): string {
  return `
You are an expert WCAG 2.1 accessibility auditor.

<example>
Input: { id: "image-alt", html: "<img src='logo.png'>" }
Output: {
  "violationId": "image-alt",
  "impact": "critical",
  "affectedUsers": "Blind users using screen readers",
  "summary": "Image has no alt text — invisible to assistive technology",
  "rootCause": "The img element lacks an alt attribute. Screen readers will announce the filename instead of a meaningful description.",
  "before": "<img src='logo.png'>",
  "after": "<img src='logo.png' alt='Company logo'>",
  "wcagCriteria": "1.1.1 Non-text Content",
  "legalRisk": "HIGH",
  "storyPoints": 1,
  "estimatedEffort": "low",
  "testCode": "await expect(page.getByRole('img')).toHaveAttribute('alt')",
  "priority": 1
}
</example>

<violation>
  <rule>${violation.id}</rule>
  <impact>${violation.impact}</impact>
  <description>${violation.description}</description>
  <url>${url}</url>
  <affected_elements>${violation.nodes.length}</affected_elements>
  <sample_html>${violation.nodes[0]?.html?.slice(0, 400)}</sample_html>
</violation>

<instructions>
  Analyze the violation and respond ONLY with JSON — no markdown, no backticks.
  Be specific to the actual HTML shown.
  Include a Playwright test assertion in testCode field.
  legalRisk: CRITICAL=sue immediately, HIGH=sue likely, MEDIUM=risk, LOW=minor
  storyPoints: 1=trivial, 2=easy, 3=medium, 5=complex
</instructions>`;
}

// ─── STEP 7: Claude LLM — Analyze each violation chunk ───────────────────────
async function analyzeWithClaude(
  violations: Violation[],
  url: string
): Promise<ClaudeAnalysis[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const analyses: ClaudeAnalysis[] = [];

  console.log(`\n🤖 Sending ${violations.length} violations to Claude for analysis...`);

  for (const violation of violations) {
    try {
      console.log(`   Analyzing: [${violation.impact?.toUpperCase()}] ${violation.id}...`);

      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: buildPrompt(violation, url),
          },
        ],
      });

      const rawText = response.content
        .filter(block => block.type === 'text')
        .map(block => (block as { type: 'text'; text: string }).text)
        .join('');

      // Parse Claude's JSON response
      const cleaned = rawText.replace(/```json|```/g, '').trim();
      const analysis: ClaudeAnalysis = JSON.parse(cleaned);
      analyses.push(analysis);

      // Rate limit: ~3 req/sec
      await new Promise(resolve => setTimeout(resolve, 350));

    } catch (err) {
      console.error(`   ❌ Failed to analyze ${violation.id}:`, err);
      // Push a fallback entry so the report still includes the violation
      analyses.push({
        violationId: violation.id,
        impact: violation.impact ?? 'unknown',
        summary: violation.help,
        rootCause: violation.description,
        fixCode: `<!-- Review ${violation.helpUrl} for fix guidance -->`,
        wcagCriteria: 'See: ' + violation.helpUrl,
        priority: 2,
        estimatedEffort: 'medium',
      });
    }
  }

  return analyses;
}

// ─── STEP 8: HTML Report Generator ───────────────────────────────────────────
function generateHTMLReport(
  scanResult: ScanResult,
  analyses: ClaudeAnalysis[]
): string {
  const impactColor: Record<string, string> = {
    critical: '#dc2626',
    serious:  '#ea580c',
    moderate: '#d97706',
    minor:    '#65a30d',
    unknown:  '#6b7280',
  };

  const rows = analyses
  .sort((a, b) => a.priority - b.priority)
  .map(a => `
    <tr>
      <td><span class="badge" style="background:${impactColor[a.impact] ?? '#6b7280'}">${a.impact.toUpperCase()}</span></td>
      <td><code>${a.violationId}</code></td>
      <td>${a.summary}</td>
      <td>${a.wcagCriteria}</td>
      <td><span class="risk risk-${(a.legalRisk ?? 'LOW').toLowerCase()}">${a.legalRisk ?? 'N/A'}</span></td>
      <td>${a.storyPoints ?? '?'} pt</td>
      <td>${a.estimatedEffort}</td>
      <td>
        <details>
          <summary>View Fix ▸</summary>
          <div class="fix-block">
            
            <p><strong>Root Cause:</strong> ${a.rootCause}</p>
            <p><strong>Before:</strong></p>
            
            <p><strong>After:</strong></p>
            
            <p><strong>Playwright Test:</strong></p>
            
          </div>
        </details>
      </td>
    </tr>`
  ).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Accessibility Report — ${scanResult.url}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { font-size: 1.5rem; color: #f8fafc; margin-bottom: 0.5rem; }
    .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 2rem; }
    .stats { display: flex; gap: 1rem; margin-bottom: 2rem; flex-wrap: wrap; }
    .stat-card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem 1.5rem; min-width: 140px; }
    .stat-card .num { font-size: 2rem; font-weight: 700; }
    .stat-card .label { color: #94a3b8; font-size: 0.8rem; }
    .red { color: #ef4444; } .orange { color: #f97316; } .green { color: #22c55e; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; }
    th { background: #0f172a; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.75rem 1rem; text-align: left; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; vertical-align: top; font-size: 0.875rem; }
    tr:last-child td { border-bottom: none; }
    .badge { color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; white-space: nowrap; }
    code { font-family: 'Courier New', monospace; font-size: 0.8rem; color: #a5f3fc; }
    pre { background: #0f172a; border: 1px solid #1e3a5f; border-radius: 6px; padding: 1rem; overflow-x: auto; margin-top: 0.5rem; }
    details summary { cursor: pointer; color: #60a5fa; font-size: 0.8rem; }
    .fix-block { margin-top: 0.5rem; }
    .ai-badge { display: inline-flex; align-items: center; gap: 4px; background: #431407; border: 1px solid #f59e0b; color: #fcd34d; font-size: 0.75rem; padding: 3px 8px; border-radius: 4px; margin-left: 1rem; }
    .risk { padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; }
    .risk-critical { background: #dc2626; color: white; }
    .risk-high     { background: #ea580c; color: white; }
    .risk-medium   { background: #d97706; color: white; }
    .risk-low      { background: #65a30d; color: white; }
  </style>
</head>
<body>
  <h1>♿ Accessibility Audit Report <span class="ai-badge">⚡ Claude AI Analysis</span></h1>
  <p class="meta">
    URL: <code>${scanResult.url}</code> &nbsp;|&nbsp;
    Scanned: ${new Date(scanResult.timestamp).toLocaleString()} &nbsp;|&nbsp;
    WCAG 2.1 AA
  </p>

  <div class="stats">
    <div class="stat-card"><div class="num red">${scanResult.violations.length}</div><div class="label">Violations</div></div>
    <div class="stat-card"><div class="num green">${scanResult.passes}</div><div class="label">Passes</div></div>
    <div class="stat-card"><div class="num orange">${scanResult.incomplete}</div><div class="label">Incomplete</div></div>
    <div class="stat-card"><div class="num">${analyses.length}</div><div class="label">AI Analyzed</div></div>
  </div>

  <table>
    <thead>
  <tr>
    <th>Impact</th>
    <th>Rule</th>
    <th>Summary</th>
    <th>WCAG</th>
    <th>Legal Risk</th>
    <th>Points</th>
    <th>Effort</th>
    <th>Fix</th>
  </tr>
</thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔍 AI Accessibility Analyzer — Claude + axe-core\n');

  if (!fs.existsSync(VIOLATIONS_FILE)) {
    console.error('❌ No violations.json found. Run "npm test" first.');
    process.exit(1);
  }

  const scanResults: ScanResult[] = JSON.parse(fs.readFileSync(VIOLATIONS_FILE, 'utf-8'));
  const latest = scanResults[scanResults.length - 1];

  if (!latest.violations.length) {
    console.log('✅ No violations found! Nothing to analyze.');
    return;
  }

  // STEP 5: Chunk violations by impact
  const chunks = chunkViolations(latest.violations);
  console.log('📦 Violation chunks:');
  for (const [impact, viols] of chunks) {
    console.log(`   ${impact}: ${viols.length}`);
  }

  // STEP 7: Analyze with Claude (process critical/serious first)
  const priorityOrder = ['critical', 'serious', 'moderate', 'minor'];
  const allAnalyses: ClaudeAnalysis[] = [];

  for (const impact of priorityOrder) {
    const group = chunks.get(impact) ?? [];
    if (group.length === 0) continue;
    const analyses = await analyzeWithClaude(group, latest.url);
    allAnalyses.push(...analyses);
  }

  // Save AI analysis JSON
  fs.writeFileSync(AI_ANALYSIS_FILE, JSON.stringify(allAnalyses, null, 2));
  console.log(`\n💾 AI analysis saved: ${AI_ANALYSIS_FILE}`);

  // STEP 8: Generate HTML report
  const html = generateHTMLReport(latest, allAnalyses);
  fs.writeFileSync(HTML_REPORT_FILE, html);
  console.log(`📊 HTML report saved: ${HTML_REPORT_FILE}`);
  console.log('\n✅ Analysis complete! Open reports/ai-a11y-report.html in your browser.');
}

main().catch(console.error);