/**
 * Claude Vision Accessibility Analyzer
 * Uses Claude's vision capability to analyze screenshots
 * Finds visual issues that axe-core CANNOT detect
 */

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const REPORTS_DIR = path.join(process.cwd(), 'reports');
const VISION_REPORT = path.join(REPORTS_DIR, 'vision-analysis.json');

// ─── Vision Prompt ────────────────────────────────────────────────────────────
const VISION_PROMPT = `You are an expert accessibility auditor analyzing a website screenshot.

Analyze this screenshot for visual accessibility issues that automated tools CANNOT detect.

Check for:
1. COLOR & CONTRAST: Text hard to read, low contrast UI elements
2. TOUCH TARGETS: Buttons/links that appear smaller than 44x44px
3. VISUAL HIERARCHY: Confusing layout, unclear reading order
4. FOCUS INDICATORS: Missing or invisible focus rings
5. TEXT SIZING: Text that appears smaller than 16px body / 12px minimum
6. COGNITIVE LOAD: Too cluttered, overwhelming for cognitive disabilities
7. COLOR MEANING: Information conveyed ONLY by color (no icon/text backup)
8. MOTION: Any obvious animations that could trigger vestibular disorders

Respond ONLY with valid JSON (no markdown):
{
  "overallScore": 75,
  "summary": "One sentence overall assessment",
  "issues": [
    {
      "category": "COLOR_CONTRAST",
      "severity": "serious",
      "location": "Top navigation bar",
      "description": "What the issue is",
      "recommendation": "How to fix it",
      "wcagCriteria": "1.4.3 Contrast Minimum"
    }
  ],
  "positives": [
    "Good thing 1 about the accessibility"
  ]
}

Severity options: critical, serious, moderate, minor
Category options: COLOR_CONTRAST, TOUCH_TARGET, VISUAL_HIERARCHY, FOCUS_INDICATOR, TEXT_SIZE, COGNITIVE_LOAD, COLOR_MEANING, MOTION`;

// ─── Analyze Screenshot with Claude Vision ────────────────────────────────────
async function analyzeScreenshot(screenshotPath: string): Promise<any> {
  console.log(`\n👁️  Claude is analyzing screenshot: ${path.basename(screenshotPath)}`);

  // Read screenshot as base64
  const imageBuffer = fs.readFileSync(screenshotPath);
  const base64Image = imageBuffer.toString('base64');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: VISION_PROMPT,
          },
        ],
      },
    ],
  });

  const rawText = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as any).text)
    .join('');

  const cleaned = rawText.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

// ─── Find Screenshots from Playwright Run ────────────────────────────────────
function findScreenshots(): string[] {
  const resultsDir = path.join(REPORTS_DIR, 'playwright-results');
  if (!fs.existsSync(resultsDir)) {
    console.error('❌ No playwright-results folder. Run npm test first.');
    return [];
  }

  const screenshots: string[] = [];
  const walk = (dir: string) => {
    fs.readdirSync(dir).forEach(file => {
      const full = path.join(dir, file);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (file.endsWith('.png')) screenshots.push(full);
    });
  };
  walk(resultsDir);
  return screenshots;
}

// ─── Generate Vision HTML Report ─────────────────────────────────────────────
function generateVisionReport(analyses: any[]): string {
  const severityColor: Record<string, string> = {
    critical: '#dc2626',
    serious: '#ea580c',
    moderate: '#d97706',
    minor: '#65a30d',
  };

  const issueRows = analyses.flatMap(a =>
    (a.issues || []).map((issue: any) => `
      <tr>
        <td><span class="badge" style="background:${severityColor[issue.severity] ?? '#6b7280'}">${issue.severity.toUpperCase()}</span></td>
        <td>${issue.category.replace(/_/g, ' ')}</td>
        <td>${issue.location}</td>
        <td>${issue.description}</td>
        <td>${issue.recommendation}</td>
        <td><code>${issue.wcagCriteria}</code></td>
      </tr>`)
  ).join('');

  const positives = analyses.flatMap(a =>
    (a.positives || []).map((p: string) => `<li>✅ ${p}</li>`)
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Claude Vision Accessibility Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #e2e8f0; padding: 2rem; }
    h1 { color: #f8fafc; margin-bottom: 0.5rem; font-size: 1.5rem; }
    h2 { color: #94a3b8; font-size: 1rem; margin: 1.5rem 0 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .meta { color: #64748b; font-size: 0.85rem; margin-bottom: 1.5rem; }
    .score { display: inline-block; background: #1e293b; border: 2px solid #22c55e; border-radius: 12px; padding: 1rem 2rem; margin-bottom: 1.5rem; }
    .score .num { font-size: 3rem; font-weight: 700; color: #22c55e; }
    .score .label { color: #94a3b8; font-size: 0.8rem; }
    .vision-badge { display: inline-flex; align-items: center; gap: 4px; background: #1e1b4b; border: 1px solid #818cf8; color: #a5b4fc; font-size: 0.75rem; padding: 3px 10px; border-radius: 4px; margin-left: 1rem; }
    table { width: 100%; border-collapse: collapse; background: #1e293b; border-radius: 8px; overflow: hidden; margin-bottom: 1.5rem; }
    th { background: #0f172a; color: #64748b; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.75rem 1rem; text-align: left; }
    td { padding: 0.75rem 1rem; border-bottom: 1px solid #334155; font-size: 0.875rem; vertical-align: top; }
    .badge { color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; }
    code { color: #a5f3fc; font-size: 0.8rem; }
    ul { background: #1e293b; border-radius: 8px; padding: 1rem 1rem 1rem 2rem; list-style: none; }
    ul li { padding: 0.4rem 0; color: #86efac; font-size: 0.875rem; }
  </style>
</head>
<body>
  <h1>👁️ Claude Vision Report <span class="vision-badge">⚡ AI Screenshot Analysis</span></h1>
  <p class="meta">Visual issues axe-core cannot detect • Analyzed ${analyses.length} screenshot(s)</p>

  <div class="score">
    <div class="num">${analyses[0]?.overallScore ?? 'N/A'}<span style="font-size:1.5rem">/100</span></div>
    <div class="label">Visual Accessibility Score</div>
  </div>

  <p style="color:#94a3b8; margin-bottom:1.5rem">${analyses[0]?.summary ?? ''}</p>

  <h2>Visual Issues Found</h2>
  <table>
    <thead>
      <tr>
        <th>Severity</th><th>Category</th><th>Location</th>
        <th>Issue</th><th>Fix</th><th>WCAG</th>
      </tr>
    </thead>
    <tbody>${issueRows}</tbody>
  </table>

  <h2>What Your App Does Well</h2>
  <ul>${positives}</ul>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('👁️  Claude Vision Accessibility Analyzer\n');

  const screenshots = findScreenshots();

  if (screenshots.length === 0) {
    console.log('No screenshots found. Run playwright test first.');
    return;
  }

  console.log(`Found ${screenshots.length} screenshot(s) to analyze`);

  const analyses: any[] = [];

  // Analyze first 3 screenshots max (cost control)
  for (const shot of screenshots.slice(0, 3)) {
    try {
      const analysis = await analyzeScreenshot(shot);
      analyses.push({ screenshot: path.basename(shot), ...analysis });
      console.log(`   ✅ Score: ${analysis.overallScore}/100 — ${analysis.issues?.length ?? 0} issues found`);
    } catch (err) {
      console.error(`   ❌ Failed: ${err}`);
    }
  }

  // Save JSON
  fs.writeFileSync(VISION_REPORT, JSON.stringify(analyses, null, 2));
  console.log(`\n💾 Vision analysis saved: ${VISION_REPORT}`);

  // Generate HTML report
  const html = generateVisionReport(analyses);
  const htmlPath = path.join(REPORTS_DIR, 'vision-report.html');
  fs.writeFileSync(htmlPath, html);
  console.log(`📊 Vision report saved: ${htmlPath}`);
  console.log('\n✅ Done! Open reports/vision-report.html');
}

main().catch(console.error);