"""
pytest Accessibility Test Runner - Windows Compatible
Reads existing violations.json and ai-analysis.json directly.
No subprocess calls needed since we already ran the scans.

Run: pytest tests\ -v --html=reports\pytest-report.html
"""

import json
import pytest
from pathlib import Path
from typing import Any

# ─── Configuration ─────────────────────────────────────────────────────────────
REPORTS_DIR = Path("reports")
VIOLATIONS_FILE = REPORTS_DIR / "violations.json"
AI_ANALYSIS_FILE = REPORTS_DIR / "ai-analysis.json"

# Thresholds
MAX_CRITICAL_VIOLATIONS = 0
MAX_SERIOUS_VIOLATIONS = 7
MAX_TOTAL_VIOLATIONS = 15

# ─── Fixtures ──────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def violations_data() -> list[dict[str, Any]]:
    """Load violations from existing scan output."""
    if not VIOLATIONS_FILE.exists():
        pytest.skip("No violations.json found - run Playwright scan first")
    data = json.loads(VIOLATIONS_FILE.read_text(encoding="utf-8"))
    return data[-1]["violations"]  # Latest scan


@pytest.fixture(scope="session")
def ai_analysis() -> list[dict[str, Any]]:
    """Load existing Claude AI analysis."""
    if not AI_ANALYSIS_FILE.exists():
        pytest.skip("No ai-analysis.json found - run 'npm run analyze' first")
    return json.loads(AI_ANALYSIS_FILE.read_text(encoding="utf-8"))


# ─── Tests ─────────────────────────────────────────────────────────────────────

class TestAccessibilityThresholds:
    """CI/CD Gate — Assert violation counts are within thresholds."""

    def test_no_critical_violations(self, violations_data):
        """Zero tolerance for critical violations."""
        critical = [v for v in violations_data if v.get("impact") == "critical"]
        details = "\n".join([f"  ❌ [{v['id']}] {v['help']}" for v in critical])
        assert len(critical) <= MAX_CRITICAL_VIOLATIONS, (
            f"Found {len(critical)} critical violations "
            f"(threshold: {MAX_CRITICAL_VIOLATIONS}):\n{details}"
        )

    def test_serious_violations_within_threshold(self, violations_data):
        """Serious violations below threshold."""
        serious = [v for v in violations_data if v.get("impact") == "serious"]
        assert len(serious) <= MAX_SERIOUS_VIOLATIONS, (
            f"Found {len(serious)} serious violations "
            f"(threshold: {MAX_SERIOUS_VIOLATIONS})"
        )

    def test_total_violations_within_threshold(self, violations_data):
        """Total violations below threshold."""
        assert len(violations_data) <= MAX_TOTAL_VIOLATIONS, (
            f"Total violations {len(violations_data)} "
            f"exceeds threshold {MAX_TOTAL_VIOLATIONS}"
        )


class TestAIAnalysisQuality:
    """ISTQB CT-GenAI: Validate Claude's output quality."""

    def test_ai_analysis_has_required_fields(self, ai_analysis):
        """Every AI entry must have all required fields."""
        required = [
            "violationId", "impact", "summary",
            "rootCause", "fixCode", "wcagCriteria",
            "priority", "estimatedEffort"
        ]
        for entry in ai_analysis:
            for field in required:
                assert field in entry, (
                    f"AI analysis for '{entry.get('violationId', '?')}' "
                    f"missing field: '{field}'"
                )

    def test_ai_priority_values_are_valid(self, ai_analysis):
        """Priority must be 1-4."""
        for entry in ai_analysis:
            assert 1 <= entry["priority"] <= 4, (
                f"Invalid priority {entry['priority']} "
                f"for {entry['violationId']}"
            )

    def test_ai_effort_values_are_valid(self, ai_analysis):
        """Effort must be low/medium/high."""
        valid = {"low", "medium", "high"}
        for entry in ai_analysis:
            assert entry["estimatedEffort"] in valid, (
                f"Invalid effort '{entry['estimatedEffort']}' "
                f"for {entry['violationId']}"
            )

    def test_ai_fix_code_not_empty(self, ai_analysis):
        """Claude must provide fix code."""
        for entry in ai_analysis:
            assert entry["fixCode"].strip(), (
                f"Empty fixCode for: {entry['violationId']}"
            )

    def test_ai_wcag_criteria_referenced(self, ai_analysis):
        """Each entry must reference WCAG criteria."""
        for entry in ai_analysis:
            assert len(entry.get("wcagCriteria", "")) > 5, (
                f"Missing WCAG criteria for {entry['violationId']}"
            )

    def test_critical_violations_prioritized_first(self, ai_analysis):
        """ISTQB CT-AI: Claude must rank critical as priority 1."""
        critical = [e for e in ai_analysis if e["impact"] == "critical"]
        for entry in critical:
            assert entry["priority"] == 1, (
                f"Critical violation '{entry['violationId']}' "
                f"should be priority 1, got: {entry['priority']}"
            )


class TestSpecificWCAGRules:
    """Spot-check legally required WCAG rules (ADA / EAA)."""

    def test_images_have_alt_text(self, violations_data):
        """WCAG 1.1.1 — No missing alt text."""
        violations = [
            v for v in violations_data
            if v["id"] in ("image-alt", "input-image-alt", "area-alt")
        ]
        assert len(violations) == 0, (
            f"Found {len(violations)} images missing alt text (WCAG 1.1.1)"
        )

    def test_form_inputs_have_labels(self, violations_data):
        """WCAG 1.3.1 — All inputs labeled."""
        violations = [
            v for v in violations_data
            if v["id"] in ("label", "label-content-name-mismatch")
        ]
        assert len(violations) == 0, (
            f"Found {len(violations)} unlabeled inputs (WCAG 1.3.1)"
        )

    def test_page_has_language(self, violations_data):
        """WCAG 3.1.1 — Page must declare language."""
        violations = [v for v in violations_data if v["id"] == "html-has-lang"]
        assert len(violations) == 0, (
            "Page missing lang attribute (WCAG 3.1.1)"
        )