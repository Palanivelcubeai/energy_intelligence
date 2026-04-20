#!/usr/bin/env python3
"""Generate a submission-style PDF from markdown report content.

Formatting implemented from user requirements:
- A4 page, 1.5 inch left margin, 1 inch on other sides
- Times family font (Times-Roman/Times-Bold in PDF)
- 1.5 line spacing for body content
- Justified body paragraphs
- Chapter headings in bold uppercase and centered
- Section headings bold, left aligned
- Table styling with all borders and centered cells
- Front matter page numbering as Roman numerals
- Main chapters page numbering as Arabic numerals
"""

from __future__ import annotations

import argparse
import html
import os
import re
from typing import List, Tuple

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    PageTemplate,
    NextPageTemplate,
    PageBreak,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    KeepTogether,
)


def to_roman(number: int) -> str:
    """Convert integer to Roman numerals."""
    numerals = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ]
    result = []
    n = max(1, number)
    for value, symbol in numerals:
        while n >= value:
            result.append(symbol)
            n -= value
    return "".join(result)


def normalize_inline_markdown(text: str) -> str:
    """Convert limited markdown inline syntax to PDF-safe text."""
    # Convert markdown links to "text (url)".
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    # Remove inline code markers.
    text = text.replace("`", "")
    # Escape HTML-sensitive characters for reportlab Paragraph.
    return html.escape(text)


def split_table_row(row: str) -> List[str]:
    row = row.strip()
    if row.startswith("|"):
        row = row[1:]
    if row.endswith("|"):
        row = row[:-1]
    return [normalize_inline_markdown(cell.strip()) for cell in row.split("|")]


def parse_markdown_table(
    lines: List[str],
    start_index: int,
    max_width: float,
    styles: dict,
) -> Tuple[Table, int]:
    table_lines: List[str] = []
    i = start_index
    while i < len(lines) and lines[i].strip().startswith("|"):
        table_lines.append(lines[i].rstrip("\n"))
        i += 1

    rows = [split_table_row(line) for line in table_lines if line.strip()]
    if len(rows) >= 2 and re.match(r"^[|\-: ]+$", table_lines[1].strip()):
        rows = [rows[0]] + rows[2:]

    max_cols = max((len(r) for r in rows), default=1)
    normalized_rows = [r + [""] * (max_cols - len(r)) for r in rows]

    col_width = max_width / max_cols if max_cols else max_width

    wrapped_rows = []
    for row_idx, row in enumerate(normalized_rows):
        wrapped = []
        for cell in row:
            style = styles["table_header"] if row_idx == 0 else styles["table_cell"]
            wrapped.append(Paragraph(cell or "", style))
        wrapped_rows.append(wrapped)

    table = Table(
        wrapped_rows,
        repeatRows=1,
        hAlign="CENTER",
        colWidths=[col_width] * max_cols,
    )
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.8, colors.black),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )
    return table, i


def build_styles() -> dict:
    base = getSampleStyleSheet()
    return {
        "title_main": ParagraphStyle(
            "title_main",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=17,
            leading=24,
            alignment=TA_CENTER,
            spaceAfter=10,
            keepWithNext=True,
            textTransform="uppercase",
        ),
        "title_sub": ParagraphStyle(
            "title_sub",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=14,
            leading=20,
            alignment=TA_CENTER,
            spaceAfter=8,
            keepWithNext=True,
        ),
        "h1": ParagraphStyle(
            "h1",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=14,
            leading=20,
            alignment=TA_CENTER,
            spaceBefore=10,
            spaceAfter=10,
            textTransform="uppercase",
        ),
        "chapter_label": ParagraphStyle(
            "chapter_label",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=15,
            leading=20,
            alignment=TA_CENTER,
            spaceBefore=0,
            spaceAfter=4,
            keepWithNext=True,
            textTransform="uppercase",
        ),
        "chapter_title": ParagraphStyle(
            "chapter_title",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=14,
            leading=20,
            alignment=TA_CENTER,
            spaceBefore=0,
            spaceAfter=8,
            keepWithNext=True,
            textTransform="uppercase",
        ),
        "h2": ParagraphStyle(
            "h2",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=12.5,
            leading=18,
            alignment=TA_LEFT,
            spaceBefore=8,
            spaceAfter=4,
            keepWithNext=True,
            textTransform="uppercase",
        ),
        "h3": ParagraphStyle(
            "h3",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=12,
            leading=18,
            alignment=TA_LEFT,
            spaceBefore=6,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=12,
            leading=18,
            alignment=TA_JUSTIFY,
            firstLineIndent=0.35 * inch,
            spaceBefore=0,
            spaceAfter=6,
            allowWidows=0,
            allowOrphans=0,
        ),
        "list": ParagraphStyle(
            "list",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=12,
            leading=18,
            alignment=TA_JUSTIFY,
            leftIndent=0.28 * inch,
            spaceAfter=4,
            allowWidows=0,
            allowOrphans=0,
        ),
        "table_header": ParagraphStyle(
            "table_header",
            parent=base["Normal"],
            fontName="Times-Bold",
            fontSize=10,
            leading=12,
            alignment=TA_CENTER,
        ),
        "table_cell": ParagraphStyle(
            "table_cell",
            parent=base["Normal"],
            fontName="Times-Roman",
            fontSize=9.5,
            leading=11.5,
            alignment=TA_CENTER,
        ),
    }


def make_pdf(input_path: str, output_path: str) -> None:
    with open(input_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    styles = build_styles()

    doc = BaseDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=1.5 * inch,
        rightMargin=1.0 * inch,
        topMargin=1.0 * inch,
        bottomMargin=1.0 * inch,
        title="Project Report",
        author="Energy Intelligence Platform",
    )

    frame = Frame(doc.leftMargin, doc.bottomMargin, doc.width, doc.height, id="normal")

    def on_front_page(canvas, _doc):
        canvas.saveState()
        canvas.setFont("Times-Roman", 11)
        canvas.drawCentredString(A4[0] / 2.0, 0.6 * inch, to_roman(canvas.getPageNumber()).lower())
        canvas.restoreState()

    def on_main_page(canvas, _doc):
        if not hasattr(_doc, "_main_start_page"):
            _doc._main_start_page = canvas.getPageNumber()
        logical_page = canvas.getPageNumber() - _doc._main_start_page + 1
        canvas.saveState()
        canvas.setFont("Times-Roman", 11)
        canvas.drawCentredString(A4[0] / 2.0, 0.6 * inch, str(logical_page))
        canvas.restoreState()

    doc.addPageTemplates(
        [
            # Front matter: Roman numerals
            PageTemplate(id="front", frames=[frame], onPage=on_front_page),
            # Main chapters: Arabic numerals
            PageTemplate(id="main", frames=[frame], onPage=on_main_page),
        ]
    )

    story = []
    in_main = False
    first_chapter_seen = False
    pending_blank_gap = False

    i = 0
    while i < len(lines):
        raw = lines[i].rstrip("\n")
        text = raw.strip()

        if not text:
            pending_blank_gap = True
            i += 1
            continue

        if text == "---":
            pending_blank_gap = True
            i += 1
            continue

        if text.startswith("|"):
            table, next_i = parse_markdown_table(lines, i, doc.width, styles)
            if pending_blank_gap:
                story.append(Spacer(1, 2))
            story.append(table)
            story.append(Spacer(1, 4))
            pending_blank_gap = False
            i = next_i
            continue

        if text.startswith("# "):
            heading = normalize_inline_markdown(text[2:].strip())

            # Keep TABLE OF CONTENTS heading and list entries together so the
            # heading does not appear alone at page bottom or on a mostly blank page.
            if heading.upper() == "TABLE OF CONTENTS":
                toc_flowables = [Paragraph(heading.upper(), styles["h1"])]
                j = i + 1
                while j < len(lines):
                    nxt = lines[j].strip()
                    if not nxt:
                        j += 1
                        continue
                    if nxt == "---":
                        j += 1
                        break
                    if re.match(r"^\d+\.\s+", nxt):
                        toc_flowables.append(Paragraph(normalize_inline_markdown(nxt), styles["list"]))
                        j += 1
                        continue
                    break

                story.append(KeepTogether(toc_flowables))
                pending_blank_gap = False
                i = j
                continue

            chapter_match = re.match(r"^(CHAPTER\s+\d+)\s*-\s*(.+)$", heading, re.IGNORECASE)
            if chapter_match:
                if not in_main:
                    story.append(NextPageTemplate("main"))
                    story.append(PageBreak())
                    in_main = True
                elif first_chapter_seen:
                    story.append(PageBreak())

                first_chapter_seen = True
                chapter_label = chapter_match.group(1).upper()
                chapter_title = chapter_match.group(2).upper()
                story.append(Paragraph(chapter_label, styles["chapter_label"]))
                story.append(Paragraph(chapter_title, styles["chapter_title"]))
            else:
                # Front-page title can be larger.
                if "TITLE OF THE PROJECT" in heading.upper():
                    story.append(Paragraph(heading.upper(), styles["title_main"]))
                elif "PROJECT REPORT" in heading.upper():
                    story.append(Paragraph(heading, styles["title_sub"]))
                else:
                    story.append(Paragraph(heading.upper(), styles["h1"]))
            pending_blank_gap = False
            i += 1
            continue

        if text.startswith("## "):
            heading = normalize_inline_markdown(text[3:].strip())
            story.append(Paragraph(heading.upper(), styles["h2"]))
            pending_blank_gap = False
            i += 1
            continue

        if text.startswith("### "):
            heading = normalize_inline_markdown(text[4:].strip())
            story.append(Paragraph(heading, styles["h3"]))
            pending_blank_gap = False
            i += 1
            continue

        if re.match(r"^\d+\.\s+", text) or re.match(r"^-\s+", text):
            if pending_blank_gap:
                story.append(Spacer(1, 2))
            story.append(Paragraph(normalize_inline_markdown(text), styles["list"]))
            pending_blank_gap = False
            i += 1
            continue

        if pending_blank_gap:
            story.append(Spacer(1, 2))
        story.append(Paragraph(normalize_inline_markdown(text), styles["body"]))
        pending_blank_gap = False
        i += 1

    if not story:
        story.append(Paragraph("No content found in input markdown.", styles["body"]))

    doc.build(story)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create an academic-format PDF from markdown report content."
    )
    parser.add_argument(
        "--input",
        default=os.path.join("docs", "ENERGY_INTELLIGENCE_PROJECT_REPORT.md"),
        help="Input markdown report path.",
    )
    parser.add_argument(
        "--output",
        default=os.path.join("docs", "ENERGY_INTELLIGENCE_PROJECT_REPORT.pdf"),
        help="Output PDF path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    make_pdf(args.input, args.output)
    print(f"PDF created: {args.output}")


if __name__ == "__main__":
    main()
