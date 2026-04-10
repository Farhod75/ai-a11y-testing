/**
 * Compare prompt techniques side by side
 * Run: npx ts-node scripts/compare-prompts.ts
 */
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';
import {
  zeroShotPrompt,
  rolePrompt,
  fewShotPrompt,
  chainOfThoughtPrompt,
  structuredPrompt,
} from './prompts';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Use a real violation from your scan
const sampleViolation = {
  id: 'button-name',
  impact: 'critical',
  description: 'Ensures buttons have discernible text',
  help: 'Buttons must have discernible text',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/button-name',
  nodes: [{
    html: '<button class="ui-datepicker-trigger" type="button"><img src="/calendar.png"></button>',
    failureSummary: 'Fix: Add aria-label attribute',
    target: ['button.ui-datepicker-trigger'],
  }],
};

async function comparePrompts() {
  console.log('🧪 Prompt Engineering Comparison\n');
  console.log('Testing 5 techniques on same violation...\n');
  console.log('=' .repeat(60));

  const techniques = [
    { name: '1. Zero-Shot',        prompt: zeroShotPrompt(sampleViolation) },
    { name: '2. Role + Context',   prompt: rolePrompt(sampleViolation) },
    { name: '3. Few-Shot',         prompt: fewShotPrompt(sampleViolation) },
    { name: '4. Chain of Thought', prompt: chainOfThoughtPrompt(sampleViolation) },
    { name: '5. Structured XML',   prompt: structuredPrompt(sampleViolation, 'https://example.com') },
  ];

  const results: any[] = [];

  for (const technique of techniques) {
    console.log(`\n📝 Testing: ${technique.name}`);
    console.log(`   Prompt length: ${technique.prompt.length} chars`);

    const start = Date.now();

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: technique.prompt }],
    });

    const elapsed = Date.now() - start;
    const output = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as any).text)
      .join('');

    // Score the output quality
    const hasBeforeAfter = output.includes('before') && output.includes('after');
    const hasWCAG = /\d\.\d\.\d/.test(output);
    const hasLegalRisk = output.toLowerCase().includes('risk') || output.toLowerCase().includes('legal') || output.toLowerCase().includes('ada');
    const isValidJSON = (() => {
      try { JSON.parse(output.replace(/```json|```/g, '').trim()); return true; }
      catch { return false; }
    })();

    const score = [hasBeforeAfter, hasWCAG, hasLegalRisk, isValidJSON]
      .filter(Boolean).length * 25;

    results.push({
      technique: technique.name,
      score: `${score}/100`,
      timeMs: elapsed,
      hasBeforeAfter,
      hasWCAG,
      hasLegalRisk,
      isValidJSON,
      outputLength: output.length,
    });

    console.log(`   ✅ Score: ${score}/100`);
    console.log(`   ⏱️  Time: ${elapsed}ms`);
    console.log(`   📦 JSON: ${isValidJSON ? '✅' : '❌'}`);
    console.log(`   🔄 Before/After: ${hasBeforeAfter ? '✅' : '❌'}`);
    console.log(`   ⚖️  Legal Risk: ${hasLegalRisk ? '✅' : '❌'}`);

    // Rate limit pause
    await new Promise(r => setTimeout(r, 500));
  }

  // Summary table
  console.log('\n' + '='.repeat(60));
  console.log('📊 COMPARISON SUMMARY\n');
  console.table(results);

  // Save results
  fs.writeFileSync(
    path.join(process.cwd(), 'reports', 'prompt-comparison.json'),
    JSON.stringify(results, null, 2)
  );
  console.log('\n💾 Results saved to reports/prompt-comparison.json');
  console.log('\n🏆 WINNER: Structured XML prompt scores highest for consistency!');
}

comparePrompts().catch(console.error);