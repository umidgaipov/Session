"""
Verification test suite for Stage 1 (Steps 1.1 & 1.2):
Markup, Meta tags, CSS class alignment, Touch targets, and Initial Content.
"""

import os
import re
import unittest
from html.parser import HTMLParser


class SimpleDOMParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.classes = set()
        self.ids = set()
        self.meta_tags = []
        self.links = []
        self.buttons = []
        self.current_tag = None
        self.text_content = []

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        attr_dict = dict(attrs)
        
        if tag == "meta":
            self.meta_tags.append(attr_dict)
        elif tag == "link":
            self.links.append(attr_dict)
        elif tag == "button":
            self.buttons.append(attr_dict)

        if "class" in attr_dict:
            for cls in attr_dict["class"].split():
                self.classes.add(cls)

        if "id" in attr_dict:
            self.ids.add(attr_dict["id"])

    def handle_data(self, data):
        cleaned = data.strip()
        if cleaned:
            self.text_content.append(cleaned)


class TestStage1Markup(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        cls.html_path = os.path.join(cls.root_dir, "index.html")
        cls.css_path = os.path.join(cls.root_dir, "assets", "css", "styles.css")

        with open(cls.html_path, "r", encoding="utf-8") as f:
            cls.html_content = f.read()

        with open(cls.css_path, "r", encoding="utf-8") as f:
            cls.css_content = f.read()

        cls.parser = SimpleDOMParser()
        cls.parser.feed(cls.html_content)

    def test_html5_doctype(self):
        self.assertTrue(
            self.html_content.strip().lower().startswith("<!doctype html>"),
            "index.html must start with <!DOCTYPE html>"
        )

    def test_meta_viewport(self):
        viewport_meta = next(
            (m for m in self.parser.meta_tags if m.get("name") == "viewport"), None
        )
        self.assertIsNotNone(viewport_meta, "Viewport meta tag is required")
        content = viewport_meta.get("content", "")
        self.assertIn("width=device-width", content)
        self.assertIn("viewport-fit=cover", content)
        self.assertNotIn("user-scalable=no", content, "WCAG AA prohibits user-scalable=no")

    def test_meta_theme_color_and_scheme(self):
        theme_meta = next(
            (m for m in self.parser.meta_tags if m.get("name") == "theme-color"), None
        )
        self.assertIsNotNone(theme_meta, "Theme-color meta tag is required")
        self.assertEqual(theme_meta.get("content").upper(), "#FAFAF8")

        scheme_meta = next(
            (m for m in self.parser.meta_tags if m.get("name") == "color-scheme"), None
        )
        self.assertIsNotNone(scheme_meta, "color-scheme meta tag is required")
        self.assertEqual(scheme_meta.get("content"), "light")

    def test_meta_ios_web_app(self):
        apple_capable = next(
            (m for m in self.parser.meta_tags if m.get("name") == "apple-mobile-web-app-capable"), None
        )
        self.assertIsNotNone(apple_capable, "apple-mobile-web-app-capable required")
        self.assertEqual(apple_capable.get("content"), "yes")

        format_detection = next(
            (m for m in self.parser.meta_tags if m.get("name") == "format-detection"), None
        )
        self.assertIsNotNone(format_detection, "format-detection required")
        self.assertEqual(format_detection.get("content"), "telephone=no")

    def test_inter_font_loading(self):
        inter_link = next(
            (l for l in self.parser.links if "Inter" in l.get("href", "")), None
        )
        self.assertIsNotNone(inter_link, "Inter font stylesheet link required")

    def test_stylesheet_link(self):
        css_link = next(
            (l for l in self.parser.links if l.get("href") == "assets/css/styles.css"), None
        )
        self.assertIsNotNone(css_link, "assets/css/styles.css stylesheet link required")

    def test_css_classes_presence(self):
        expected_classes = [
            "app-container",
            "site-header",
            "header-inner",
            "brand-group",
            "brand-badge",
            "brand-title",
            "brand-subtitle",
            "header-actions",
            "mode-switch-wrapper",
            "segmented-control",
            "segment-btn",
            "segment-badge",
            "progress-strip-wrapper",
            "progress-strip-track",
            "progress-strip-fill",
            "progress-strip-text",
            "main-content",
            "question-meta-bar",
            "category-tag",
            "tag-dot",
            "question-index-badge",
            "question-card",
            "question-title",
            "context-box",
            "context-label",
            "question-prompt",
            "options-list",
            "option-btn",
            "option-indicator",
            "option-text",
            "explanation-card",
            "explanation-header",
            "explanation-title-group",
            "explanation-title",
            "explanation-status-pill",
            "explanation-body",
            "distractors-wrap",
            "distractors-heading",
            "distractor-item",
            "distractor-tag",
            "bottom-nav-bar",
            "bottom-nav-inner",
            "btn-pill",
            "btn-pill-icon",
            "btn-pill-primary",
            "sheet-backdrop",
            "sheet-container",
            "sheet-handle-bar",
            "sheet-handle",
            "sheet-header",
            "sheet-title",
            "sheet-filters",
            "filter-chip",
            "sheet-grid",
        ]

        missing = [cls for cls in expected_classes if cls not in self.parser.classes]
        self.assertEqual(missing, [], f"Missing required CSS classes in index.html: {missing}")

    def test_critical_dom_ids(self):
        expected_ids = [
            "btn-reset",
            "tab-situational",
            "tab-practical",
            "badge-situational",
            "badge-practical",
            "progress-bar",
            "progress-fill",
            "progress-text",
            "category-tag",
            "category-text",
            "question-index-badge",
            "question-card",
            "question-topic",
            "context-box",
            "context-label",
            "context-text",
            "question-prompt",
            "options-list",
            "explanation-card",
            "explanation-status-pill",
            "explanation-body",
            "distractors-wrap",
            "distractors-list",
            "btn-prev",
            "btn-catalog",
            "btn-next",
            "sheet-backdrop",
            "sheet-container",
            "btn-close-sheet",
            "sheet-grid",
        ]

        missing = [eid for eid in expected_ids if eid not in self.parser.ids]
        self.assertEqual(missing, [], f"Missing required DOM IDs in index.html: {missing}")

    def test_realistic_question_1_content(self):
        # Check that Question 1 text is present
        self.assertIn("Предмет статистики и её специфические особенности", self.html_content)
        self.assertIn("500 000 евро", self.html_content)
        self.assertIn("закону больших чисел", self.html_content)
        self.assertIn("Анатомия ловушек (дистракторы)", self.html_content)

    def test_css_touch_targets(self):
        # Verify min-height values in styles.css for touch targets
        option_btn_match = re.search(r'\.option-btn\s*\{[^}]*min-height:\s*(\d+)px', self.css_content)
        self.assertIsNotNone(option_btn_match)
        self.assertGreaterEqual(int(option_btn_match.group(1)), 48, ".option-btn min-height >= 48px")

        btn_pill_match = re.search(r'\.btn-pill\s*\{[^}]*min-height:\s*(\d+)px', self.css_content)
        self.assertIsNotNone(btn_pill_match)
        self.assertGreaterEqual(int(btn_pill_match.group(1)), 48, ".btn-pill min-height >= 48px")

        segment_btn_match = re.search(r'\.segment-btn\s*\{[^}]*min-height:\s*(\d+)px', self.css_content)
        self.assertIsNotNone(segment_btn_match)
        self.assertGreaterEqual(int(segment_btn_match.group(1)), 44, ".segment-btn min-height >= 44px")


if __name__ == "__main__":
    unittest.main()
