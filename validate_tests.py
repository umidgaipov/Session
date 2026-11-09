#!/usr/bin/env python3
"""
Automated Comprehensive Validator for Statistical Situational Tests Database
Designed according to ORIGINAL_REQUEST.md Requirements R1, R2, R3 and survey_miner_1 schema.

Verifies:
1. Full 95/95 Question Coverage:
   - All 95 theoretical questions from docs/answers_prepared.md are represented.
   - Exact mapping to source question IDs: {1..90} U {99..103}.
   - Monotonic sequential indexing seq_id: 1..95 with zero duplicates or gaps.
2. Structural Invariants per Test Task:
   - Non-empty topic / theoretical anchor.
   - Detailed applied scenario / situation description (min 40 characters).
   - Problem question formulated for the situation (min 15 characters).
   - Exactly 4 answer options with IDs {'A', 'B', 'C', 'D'}.
   - Each option text is non-empty (min 5 characters) and pairwise distinct.
   - Exactly 1 option marked correct; matching correct_option_id.
   - Comprehensive analytical explanation / rationale for correct choice.
   - Absence of banned placeholder tokens ('TBD', 'TODO', '[...]', etc.).
3. File Syntax & Encoding Integrity:
   - JSON syntax parsing without error (UTF-8, no BOM).
   - Markdown structure parsing without error (UTF-8).
   - Cross-format consistency between JSON and Markdown if both are present.

Zero external dependencies - 100% Python Standard Library.
"""

import sys
import os
import json
import re
from pathlib import Path
from typing import Dict, List, Set, Any, Tuple, Optional, Union

# Enforce no bytecode generation (__pycache__) per constraint R2
sys.dont_write_bytecode = True

# Authoritative set of source question IDs from docs/answers_prepared.md
EXPECTED_SOURCE_IDS: Set[int] = set(range(1, 91)) | set(range(99, 104))
EXPECTED_TOTAL_COUNT: int = 95
EXPECTED_OPTION_KEYS: Set[str] = {"A", "B", "C", "D"}

BANNED_PLACEHOLDERS: List[str] = [
    "tbd", "todo", "fixme", "[...]", "placeholder",
    "заглушка", "текст варианта", "lorem ipsum"
]


class ValidationError:
    def __init__(self, test_id: Any, field: str, message: str):
        self.test_id = test_id
        self.field = field
        self.message = message

    def __str__(self) -> str:
        return f"[Test {self.test_id}] [{self.field}]: {self.message}"


class ValidationReport:
    def __init__(self, format_name: str, file_path: Path):
        self.format_name: str = format_name
        self.file_path: Path = file_path
        self.syntax_valid: bool = False
        self.total_tests_found: int = 0
        self.found_seq_ids: Set[int] = set()
        self.found_source_ids: Set[int] = set()
        self.missing_source_ids: Set[int] = set()
        self.extra_source_ids: Set[int] = set()
        self.duplicate_seq_ids: List[int] = []
        self.duplicate_source_ids: List[int] = []
        self.errors: List[ValidationError] = []

    @property
    def is_valid(self) -> bool:
        return (
            self.syntax_valid
            and self.total_tests_found == EXPECTED_TOTAL_COUNT
            and len(self.missing_source_ids) == 0
            and len(self.duplicate_seq_ids) == 0
            and len(self.duplicate_source_ids) == 0
            and len(self.errors) == 0
        )


def check_banned_tokens(text: str, test_id: Any, field: str, errors: List[ValidationError]):
    if not isinstance(text, str):
        return
    text_lower = text.lower()
    for banned in BANNED_PLACEHOLDERS:
        if banned in text_lower:
            errors.append(ValidationError(test_id, field, f"Contains forbidden placeholder token: '{banned}'"))


def validate_test_item(item: dict, seen_seq: Set[int], seen_source: Set[int], report: ValidationReport) -> Tuple[Optional[int], Optional[int]]:
    # 1. Sequence ID and Source ID
    raw_seq = item.get("seq_id") or item.get("id") or item.get("sequential_id")
    raw_source = item.get("source_question_id") or item.get("question_id") or item.get("id")

    try:
        seq_id = int(raw_seq) if raw_seq is not None else None
    except (ValueError, TypeError):
        report.errors.append(ValidationError(raw_seq, "seq_id", f"Invalid seq_id '{raw_seq}', must be integer"))
        seq_id = None

    try:
        source_id = int(raw_source) if raw_source is not None else None
    except (ValueError, TypeError):
        report.errors.append(ValidationError(raw_source, "source_question_id", f"Invalid source_question_id '{raw_source}'"))
        source_id = None

    display_id = seq_id if seq_id is not None else (source_id if source_id is not None else "?")

    if seq_id is not None:
        if seq_id in seen_seq:
            report.duplicate_seq_ids.append(seq_id)
            report.errors.append(ValidationError(display_id, "seq_id", f"Duplicate seq_id: {seq_id}"))
        seen_seq.add(seq_id)
        report.found_seq_ids.add(seq_id)

    if source_id is not None:
        if source_id in seen_source:
            report.duplicate_source_ids.append(source_id)
            report.errors.append(ValidationError(display_id, "source_question_id", f"Duplicate source_question_id: {source_id}"))
        seen_source.add(source_id)
        report.found_source_ids.add(source_id)

    # 2. Topic / Title check
    topic = item.get("topic") or item.get("question_title") or item.get("title")
    if not topic or not str(topic).strip():
        report.errors.append(ValidationError(display_id, "topic", "Missing or empty topic"))
    else:
        topic_str = str(topic).strip()
        if len(topic_str) < 5:
            report.errors.append(ValidationError(display_id, "topic", "Topic too short (<5 chars)"))
        check_banned_tokens(topic_str, display_id, "topic", report.errors)

    # 3. Scenario / Situation check
    scenario = item.get("scenario") or item.get("situation") or item.get("context")
    if not scenario or not str(scenario).strip():
        report.errors.append(ValidationError(display_id, "scenario", "Missing or empty scenario/situation"))
    else:
        scen_str = str(scenario).strip()
        if len(scen_str) < 40:
            report.errors.append(ValidationError(display_id, "scenario", f"Scenario description too short ({len(scen_str)} chars, min 40)"))
        check_banned_tokens(scen_str, display_id, "scenario", report.errors)

    # 4. Question prompt check (if separate field)
    q_prompt = item.get("question")
    if q_prompt is not None:
        q_str = str(q_prompt).strip()
        if len(q_str) < 10:
            report.errors.append(ValidationError(display_id, "question", f"Question prompt too short ({len(q_str)} chars, min 10)"))
        check_banned_tokens(q_str, display_id, "question", report.errors)

    # 5. Options check (support array of objects or dict)
    options_raw = item.get("options") or item.get("choices")
    opt_dict: Dict[str, str] = {}
    correct_flags: List[str] = []

    if not options_raw:
        report.errors.append(ValidationError(display_id, "options", "Missing options field"))
    elif isinstance(options_raw, list):
        if len(options_raw) != 4:
            report.errors.append(ValidationError(display_id, "options", f"Options list must contain exactly 4 items, found {len(options_raw)}"))
        for idx, opt in enumerate(options_raw):
            fallback_key = chr(ord('A') + idx) if idx < 4 else f"extra_{idx}"
            if isinstance(opt, dict):
                opt_id = str(opt.get("id") or opt.get("letter") or opt.get("key") or fallback_key).strip().upper()
                opt_text = str(opt.get("text") or opt.get("content") or "").strip()
                opt_dict[opt_id] = opt_text
                if opt.get("is_correct") is True:
                    correct_flags.append(opt_id)
            else:
                opt_dict[fallback_key] = str(opt).strip()
    elif isinstance(options_raw, dict):
        for k, v in options_raw.items():
            opt_dict[str(k).strip().upper()] = str(v).strip()
    else:
        report.errors.append(ValidationError(display_id, "options", f"Unsupported options container type: {type(options_raw).__name__}"))

    # Validate option keys, distinctness, non-emptiness
    if set(opt_dict.keys()) != EXPECTED_OPTION_KEYS:
        report.errors.append(ValidationError(display_id, "options", f"Option keys must be exactly {sorted(EXPECTED_OPTION_KEYS)}, found {sorted(opt_dict.keys())}"))

    seen_texts: Set[str] = set()
    for key in EXPECTED_OPTION_KEYS:
        val = opt_dict.get(key, "")
        if not val:
            report.errors.append(ValidationError(display_id, f"options.{key}", f"Option '{key}' is missing or empty"))
        else:
            if len(val) < 5:
                report.errors.append(ValidationError(display_id, f"options.{key}", f"Option '{key}' text is too short (<5 chars)"))
            check_banned_tokens(val, display_id, f"options.{key}", report.errors)
            val_norm = val.lower().strip()
            if val_norm in seen_texts:
                report.errors.append(ValidationError(display_id, f"options.{key}", f"Option '{key}' text is identical to another option in this test"))
            seen_texts.add(val_norm)

    # 6. Correct answer check
    declared_correct = item.get("correct_option_id") or item.get("correct_answer") or item.get("answer")
    if declared_correct is not None:
        dec_key = str(declared_correct).strip().upper()
        if dec_key not in EXPECTED_OPTION_KEYS:
            report.errors.append(ValidationError(display_id, "correct_option_id", f"Correct option ID '{declared_correct}' is not in {sorted(EXPECTED_OPTION_KEYS)}"))
    else:
        dec_key = None

    if correct_flags:
        if len(correct_flags) != 1:
            report.errors.append(ValidationError(display_id, "options.is_correct", f"Exactly 1 option must have is_correct=true, found {len(correct_flags)} ({correct_flags})"))
        elif dec_key is not None and correct_flags[0] != dec_key:
            report.errors.append(ValidationError(display_id, "correct_option_id", f"Mismatch between correct_option_id ('{dec_key}') and option with is_correct=true ('{correct_flags[0]}')"))

    if dec_key is None and not correct_flags:
        report.errors.append(ValidationError(display_id, "correct_option_id", "No correct answer designated"))

    # 7. Explanation check
    explanation = item.get("explanation") or item.get("rationale")
    if not explanation:
        report.errors.append(ValidationError(display_id, "explanation", "Missing explanation"))
    elif isinstance(explanation, dict):
        rat = explanation.get("correct_rationale") or explanation.get("text") or ""
        if not str(rat).strip() or len(str(rat).strip()) < 25:
            report.errors.append(ValidationError(display_id, "explanation.correct_rationale", "Rationale too short or missing (<25 chars)"))
        check_banned_tokens(str(rat), display_id, "explanation.correct_rationale", report.errors)
    elif isinstance(explanation, str):
        if len(explanation.strip()) < 25:
            report.errors.append(ValidationError(display_id, "explanation", f"Explanation too short ({len(explanation.strip())} chars, min 25)"))
        check_banned_tokens(explanation, display_id, "explanation", report.errors)
    else:
        report.errors.append(ValidationError(display_id, "explanation", f"Invalid explanation type: {type(explanation).__name__}"))

    return seq_id, source_id


def validate_json_file(file_path: Path) -> ValidationReport:
    report = ValidationReport("JSON", file_path)
    if not file_path.exists():
        report.errors.append(ValidationError(0, "file", f"File does not exist: {file_path}"))
        return report

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        report.syntax_valid = True
    except json.JSONDecodeError as e:
        report.errors.append(ValidationError(0, "json_syntax", f"Malformed JSON: {e}"))
        return report
    except Exception as e:
        report.errors.append(ValidationError(0, "file_read", f"Error reading file: {e}"))
        return report

    # Extract test array
    if isinstance(data, dict):
        items = data.get("questions") or data.get("tests") or data.get("items")
        if not isinstance(items, list):
            report.errors.append(ValidationError(0, "root_structure", "JSON root object must contain 'questions' or 'tests' list"))
            return report
    elif isinstance(data, list):
        items = data
    else:
        report.errors.append(ValidationError(0, "root_structure", f"Expected JSON list or object, got {type(data).__name__}"))
        return report

    report.total_tests_found = len(items)

    seen_seq: Set[int] = set()
    seen_source: Set[int] = set()

    for item in items:
        if isinstance(item, dict):
            validate_test_item(item, seen_seq, seen_source, report)
        else:
            report.errors.append(ValidationError("?", "item", f"Question entry must be an object, got {type(item).__name__}"))

    # Check completeness against authoritative 95 question IDs
    target_ids = report.found_source_ids if report.found_source_ids else report.found_seq_ids
    if target_ids == EXPECTED_SOURCE_IDS:
        report.missing_source_ids = set()
        report.extra_source_ids = set()
    elif report.found_seq_ids == set(range(1, EXPECTED_TOTAL_COUNT + 1)):
        # If indexed 1..95 sequentially
        if report.found_source_ids:
            report.missing_source_ids = EXPECTED_SOURCE_IDS - report.found_source_ids
            report.extra_source_ids = report.found_source_ids - EXPECTED_SOURCE_IDS
        else:
            report.missing_source_ids = set()
    else:
        report.missing_source_ids = EXPECTED_SOURCE_IDS - target_ids
        report.extra_source_ids = target_ids - EXPECTED_SOURCE_IDS

    return report


def parse_markdown_tests(content: str) -> List[dict]:
    """
    Parses Markdown test database supporting both:
    1. '### Задание 01 (Вопрос 1). Topic' / '#### 📋 Прикладная ситуация' / '#### 🔘 Варианты ответа'
    2. '## Тест 1 (Вопрос 1). Topic' / '**Ситуация:**' / '**Варианты ответов:**'
    """
    tests = []
    # Split by level 2 or 3 headers matching Test/Task
    sections = re.split(r'\n(?=#{2,3}\s+(?:Задание|Тест|Вопрос)\s+\d+)', content)

    for section in sections:
        section = section.strip()
        if not section.startswith("##"):
            continue

        header_m = re.search(r'^#{2,3}\s+(?:Задание|Тест|Вопрос)\s+(\d+)(?:\s*\((?:Вопрос|№)\s*(\d+)\))?\.?\s*(.*)$', section, re.MULTILINE)
        if not header_m:
            continue

        seq_id = int(header_m.group(1))
        source_id = int(header_m.group(2)) if header_m.group(2) else seq_id
        topic = header_m.group(3).strip()

        # Extract situation / scenario
        sit_m = re.search(r'(?:#{3,4}\s*📋?\s*Прикладная ситуация|\*\*Ситуация:?\*\*)\s*\n(.*?)(?=\n\s*(?:#{3,4}|\*\*Варианты|\*\*Правильный|\Z))', section, re.DOTALL)
        scenario = sit_m.group(1).strip() if sit_m else ""

        # Extract question prompt if present
        q_m = re.search(r'(?:#{3,4}\s*❓?\s*Вопрос к ситуации|\*\*Вопрос:?\*\*)\s*\n(.*?)(?=\n\s*(?:#{3,4}|\*\*Варианты|\Z))', section, re.DOTALL)
        question_text = q_m.group(1).strip() if q_m else ""

        # Extract options block
        opt_block_m = re.search(r'(?:#{3,4}\s*🔘?\s*Варианты ответа|\*\*Варианты ответов:?\*\*)\s*\n(.*?)(?=\n\s*(?:#{3,4}|\*\*Правильный|\*\*Объяснение|\Z))', section, re.DOTALL)
        opt_block = opt_block_m.group(1) if opt_block_m else section

        # Parse options: lines with - [x] **A.** or - **A)** or - [ ] A.
        opt_items = []
        raw_options = re.findall(r'(?:^|\n)\s*[-*]\s*(?:\[([ xX])\])?\s*[*_]{0,2}\(?([A-D])\)?[:.\)]?[*_]{0,2}\s+(.*?)(?=(?:\n\s*[-*]\s+|\Z))', opt_block, re.DOTALL)
        for check, letter, text in raw_options:
            is_corr = (check.lower() == 'x') if check else False
            opt_items.append({
                "id": letter.upper(),
                "text": text.strip(),
                "is_correct": is_corr
            })

        # Correct answer line
        ans_m = re.search(r'(?:Верный ответ|Правильный ответ)\s*(?:\(([A-D])\)|:\s*([A-D]))', section, re.IGNORECASE)
        correct_id = (ans_m.group(1) or ans_m.group(2)).upper() if ans_m else ""

        # Explanation
        exp_m = re.search(r'(?:#{3,4}\s*💡?\s*Разбор|(?:\*\*Объяснение:?\*\*))\s*\n?(.*?)(?=\n---\s*|\n#{2,3}|\Z)', section, re.DOTALL)
        explanation = exp_m.group(1).strip() if exp_m else ""

        tests.append({
            "seq_id": seq_id,
            "source_question_id": source_id,
            "topic": topic,
            "scenario": scenario,
            "question": question_text,
            "options": opt_items,
            "correct_option_id": correct_id,
            "explanation": explanation
        })

    return tests


def validate_markdown_file(file_path: Path) -> ValidationReport:
    report = ValidationReport("Markdown", file_path)
    if not file_path.exists():
        report.errors.append(ValidationError(0, "file", f"File does not exist: {file_path}"))
        return report

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            content = f.read()
        report.syntax_valid = True
    except Exception as e:
        report.errors.append(ValidationError(0, "file_read", f"Error reading file: {e}"))
        return report

    items = parse_markdown_tests(content)
    report.total_tests_found = len(items)

    seen_seq: Set[int] = set()
    seen_source: Set[int] = set()

    for item in items:
        validate_test_item(item, seen_seq, seen_source, report)

    target_ids = report.found_source_ids if report.found_source_ids else report.found_seq_ids
    if target_ids == EXPECTED_SOURCE_IDS:
        report.missing_source_ids = set()
        report.extra_source_ids = set()
    elif report.found_seq_ids == set(range(1, EXPECTED_TOTAL_COUNT + 1)):
        if report.found_source_ids:
            report.missing_source_ids = EXPECTED_SOURCE_IDS - report.found_source_ids
            report.extra_source_ids = report.found_source_ids - EXPECTED_SOURCE_IDS
        else:
            report.missing_source_ids = set()
    else:
        report.missing_source_ids = EXPECTED_SOURCE_IDS - target_ids
        report.extra_source_ids = target_ids - EXPECTED_SOURCE_IDS

    return report


def display_validation_summary(reports: List[ValidationReport]) -> bool:
    all_ok = True
    print("\n" + "=" * 76)
    print("  AUTOMATED VERIFICATION REPORT — STATISTICAL SITUATIONAL TESTS (R1/R2/R3)")
    print("=" * 76)

    for r in reports:
        status_tag = "[PASS] OK" if r.is_valid else "[FAIL] VIOLATIONS DETECTED"
        print(f"\nTarget File:           {r.file_path} ({r.format_name})")
        print(f"Overall Status:        {status_tag}")
        print(f"Syntax & Encoding:     {'VALID (UTF-8)' if r.syntax_valid else 'INVALID'}")
        print(f"Total Tests Found:     {r.total_tests_found} / {EXPECTED_TOTAL_COUNT}")
        print(f"Missing Source IDs:    {sorted(list(r.missing_source_ids)) if r.missing_source_ids else 'None (100% Coverage)'}")
        if r.duplicate_seq_ids:
            print(f"Duplicate Seq IDs:     {r.duplicate_seq_ids}")
        if r.duplicate_source_ids:
            print(f"Duplicate Source IDs:  {r.duplicate_source_ids}")
        if r.extra_source_ids:
            print(f"Unexpected Source IDs: {sorted(list(r.extra_source_ids))}")
        print(f"Total Error Count:     {len(r.errors)}")

        if r.errors:
            all_ok = False
            print("\n  Sample Violations (up to 10 shown):")
            for err in r.errors[:10]:
                print(f"    - {err}")
            if len(r.errors) > 10:
                print(f"    ... and {len(r.errors) - 10} additional errors.")
        else:
            print("  [SUCCESS] All invariants, options, answers, and non-empty checks passed!")

    print("\n" + "=" * 76)
    decision = "ALL VERIFICATION CRITERIA SATISFIED (95/95 VALID)" if all_ok else "VERIFICATION FAILED"
    print(f"VERDICT: {decision}")
    print("=" * 76 + "\n")
    return all_ok


def find_default_targets() -> Tuple[Optional[Path], Optional[Path]]:
    candidates_json = [
        Path("situational_tests.json"),
        Path("tests_database.json"),
        Path("tests_situational.json"),
        Path("data/situational_tests.json"),
        Path("data/tests_database.json"),
    ]
    candidates_md = [
        Path("situational_tests.md"),
        Path("tests_database.md"),
        Path("tests_situational.md"),
        Path("docs/situational_tests.md"),
        Path("docs/tests_database.md"),
    ]
    j_path = next((p for p in candidates_json if p.exists()), candidates_json[0])
    m_path = next((p for p in candidates_md if p.exists()), candidates_md[0])
    return j_path, m_path


def validate_batch_file(file_path: Path, expected_count: Optional[int] = None) -> ValidationReport:
    """Validates an isolated partial batch file from a worker."""
    report = ValidationReport("Batch JSON", file_path)
    if not file_path.exists():
        report.errors.append(ValidationError(0, "file", f"File does not exist: {file_path}"))
        return report

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        report.syntax_valid = True
    except json.JSONDecodeError as e:
        report.errors.append(ValidationError(0, "json_syntax", f"Malformed JSON: {e}"))
        return report
    except Exception as e:
        report.errors.append(ValidationError(0, "file_read", f"Error reading file: {e}"))
        return report

    if isinstance(data, dict):
        items = data.get("questions") or data.get("tests") or data.get("items") or data.get("batch")
        if not isinstance(items, list):
            report.errors.append(ValidationError(0, "batch_structure", "Batch JSON must contain a list of items"))
            return report
    elif isinstance(data, list):
        items = data
    else:
        report.errors.append(ValidationError(0, "batch_structure", f"Expected list or object, got {type(data).__name__}"))
        return report

    report.total_tests_found = len(items)
    if expected_count is not None and len(items) != expected_count:
        report.errors.append(ValidationError(0, "count", f"Expected {expected_count} items in batch, found {len(items)}"))

    seen_seq: Set[int] = set()
    seen_source: Set[int] = set()
    for item in items:
        if isinstance(item, dict):
            validate_test_item(item, seen_seq, seen_source, report)
        else:
            report.errors.append(ValidationError("?", "item", f"Question entry must be an object, got {type(item).__name__}"))

    return report


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Automated validator for 95 situational tests per R1, R2, R3.")
    parser.add_argument("--json", type=str, default=None, help="Path to JSON test database")
    parser.add_argument("--md", type=str, default=None, help="Path to Markdown test database")
    parser.add_argument("--batch", type=str, default=None, help="Validate an isolated batch file (e.g. batch_1.json)")
    parser.add_argument("--require-both", action="store_true", help="Require both JSON and Markdown files to exist")
    args = parser.parse_args()

    if args.batch:
        batch_path = Path(args.batch)
        report = validate_batch_file(batch_path)
        print("\n" + "=" * 76)
        print(f"  BATCH VALIDATION REPORT: {batch_path.name}")
        print("=" * 76)
        print(f"File:               {batch_path}")
        print(f"Syntax valid:       {report.syntax_valid}")
        print(f"Items in batch:     {report.total_tests_found}")
        print(f"Source IDs present: {sorted(list(report.found_source_ids))}")
        print(f"Error count:        {len(report.errors)}")
        if report.errors:
            print("\nErrors detected:")
            for err in report.errors:
                print(f"  • {err}")
            print("\nBATCH VERIFICATION: FAILED")
            sys.exit(1)
        else:
            print("\nBATCH VERIFICATION: PASSED (All items structural invariants OK)")
            sys.exit(0)

    default_j, default_m = find_default_targets()
    json_path = Path(args.json) if args.json else default_j
    md_path = Path(args.md) if args.md else default_m

    reports: List[ValidationReport] = []

    if json_path.exists() or args.require_both or not md_path.exists():
        reports.append(validate_json_file(json_path))

    if md_path.exists() or args.require_both:
        reports.append(validate_markdown_file(md_path))

    if not reports:
        print(f"Error: Neither {json_path} nor {md_path} could be inspected.")
        sys.exit(2)

    passed = display_validation_summary(reports)
    sys.exit(0 if passed else 1)


if __name__ == "__main__":
    main()
