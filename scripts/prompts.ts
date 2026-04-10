/**
 * Prompt Engineering Library
 * Demonstrates different prompting techniques for Claude API
 * Aligned with: Claude Certified Architect + ISTQB CT-GenAI
 */

// ─── Technique 1: ZERO-SHOT (Basic) ──────────────────────────────────────────
// Just ask directly with no examples
export const zeroShotPrompt = (violation: any) => `
Analyze this accessibility violation and suggest a fix:
Rule: ${violation.id}
Impact: ${violation.impact}
HTML: ${violation.nodes[0]?.html}
`;

// ─── Technique 2: ROLE + CONTEXT (Better) ────────────────────────────────────
// Give Claude a specific role and context
export const rolePrompt = (violation: any) => `
You are a senior accessibility engineer at a Fortune 500 company.
You specialize in WCAG 2.1 AA compliance and Next.js/React applications.
Your fixes must be production-ready and include Tailwind CSS classes.

Analyze this violation found on a Next.js app:
Rule:        ${violation.id}
Impact:      ${violation.impact}  
Description: ${violation.description}
Affected HTML: ${violation.nodes[0]?.html?.slice(0, 300)}

Provide a concise fix with before/after code.
`;

// ─── Technique 3: FEW-SHOT (Best for consistency) ────────────────────────────
// Show Claude examples of what you want
export const fewShotPrompt = (violation: any) => `
You are an accessibility engineer. Analyze violations like these examples:

EXAMPLE 1:
Input: { id: "image-alt", html: "<img src='logo.png'>" }
Output: {
  "summary": "Image missing alt text — invisible to screen readers",
  "before": "<img src='logo.png'>",
  "after": "<img src='logo.png' alt='Company logo'>",
  "wcag": "1.1.1",
  "effort": "low",
  "storyPoints": 1,
  "legalRisk": "HIGH"
}

EXAMPLE 2:
Input: { id: "color-contrast", html: "<p class='text-gray-400'>Welcome</p>" }
Output: {
  "summary": "Text contrast ratio 2.5:1 fails minimum 4.5:1 requirement",
  "before": "<p class='text-gray-400'>Welcome</p>",
  "after": "<p class='text-gray-200'>Welcome</p>",
  "wcag": "1.4.3",
  "effort": "low", 
  "storyPoints": 1,
  "legalRisk": "MEDIUM"
}

NOW ANALYZE THIS:
Input: { 
  id: "${violation.id}", 
  html: "${violation.nodes[0]?.html?.slice(0, 200)?.replace(/"/g, "'")}" 
}
Output (JSON only, no markdown):
`;

// ─── Technique 4: CHAIN OF THOUGHT ───────────────────────────────────────────
// Ask Claude to reason step by step before answering
export const chainOfThoughtPrompt = (violation: any) => `
You are an accessibility expert. Think through this step by step.

VIOLATION:
Rule: ${violation.id}
Impact: ${violation.impact}
HTML: ${violation.nodes[0]?.html?.slice(0, 300)}
Affected users: ${violation.nodes.length} elements

THINK THROUGH:
Step 1 - Who is affected? (which disability group)
Step 2 - What assistive technology breaks? (screen reader/keyboard/etc)
Step 3 - What is the root cause in the HTML?
Step 4 - What is the minimal code change to fix it?
Step 5 - What WCAG criterion does this violate?
Step 6 - What is the legal risk? (ADA/EAA)

After thinking, respond with JSON only:
{
  "affectedUsers": "description of who is impacted",
  "assistiveTech": "what breaks",
  "rootCause": "technical reason",
  "before": "broken code",
  "after": "fixed code", 
  "wcag": "criterion number",
  "legalRisk": "LOW|MEDIUM|HIGH|CRITICAL",
  "storyPoints": 1
}
`;

// ─── Technique 5: STRUCTURED OUTPUT with XML tags ────────────────────────────
// Claude performs better with XML structure
export const structuredPrompt = (violation: any, url: string) => `
You are an expert WCAG 2.1 accessibility auditor.

<violation>
  <rule>${violation.id}</rule>
  <impact>${violation.impact}</impact>
  <description>${violation.description}</description>
  <url>${url}</url>
  <affected_elements>${violation.nodes.length}</affected_elements>
  <sample_html>${violation.nodes[0]?.html?.slice(0, 400)}</sample_html>
  <wcag_reference>${violation.helpUrl}</wcag_reference>
</violation>

<instructions>
  Analyze the violation above and respond with a JSON object.
  Be specific to the actual HTML shown — not generic advice.
  If the app uses Tailwind CSS classes, provide Tailwind-based fixes.
  Estimate story points: 1=trivial, 2=easy, 3=medium, 5=complex, 8=hard
</instructions>

<required_output>
Respond ONLY with this JSON structure (no markdown backticks):
{
  "violationId": "rule id",
  "impact": "critical|serious|moderate|minor",
  "affectedUsers": "which disability group affected",
  "summary": "one sentence plain English explanation",
  "rootCause": "technical explanation 2-3 sentences",
  "before": "exact broken HTML from above",
  "after": "corrected HTML with fix applied",
  "wcagCriteria": "X.X.X Criterion Name",
  "legalRisk": "LOW|MEDIUM|HIGH|CRITICAL",
  "storyPoints": 2,
  "estimatedEffort": "low|medium|high",
  "testCode": "playwright expect statement to verify fix",
  "priority": 1
}
</required_output>
`;