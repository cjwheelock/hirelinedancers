#!/usr/bin/env python3
"""Render a Hire Line Dancers Markdown strategy as a branded PDF."""

from __future__ import annotations

import argparse
import html
import re
from pathlib import Path
from urllib.parse import urlparse

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    Flowable,
    HRFlowable,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


INK = colors.HexColor("#1C2A44")
INK_2 = colors.HexColor("#3F4B66")
MUTED = colors.HexColor("#667087")
PAPER = colors.HexColor("#FBFAF5")
PAPER_2 = colors.HexColor("#F1EFE8")
WHITE = colors.white
LINE = colors.HexColor("#D8D9DC")
SUNSET = colors.HexColor("#B5472B")
AMBER = colors.HexColor("#E7A33C")
PALE_AMBER = colors.HexColor("#FFF4DF")
PALE_BLUE = colors.HexColor("#E8EBF2")

PAGE_WIDTH, PAGE_HEIGHT = letter
LEFT_MARGIN = 0.64 * inch
RIGHT_MARGIN = 0.64 * inch
TOP_MARGIN = 0.66 * inch
BOTTOM_MARGIN = 0.62 * inch
CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN - RIGHT_MARGIN


def register_fonts() -> tuple[str, str, str]:
    candidates = [
        (
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Italic.ttf",
        ),
        (
            "/System/Library/Fonts/Supplemental/Verdana.ttf",
            "/System/Library/Fonts/Supplemental/Verdana Bold.ttf",
            "/System/Library/Fonts/Supplemental/Verdana Italic.ttf",
        ),
    ]
    for regular, bold, italic in candidates:
        if all(Path(item).exists() for item in (regular, bold, italic)):
            pdfmetrics.registerFont(TTFont("HLDRegular", regular))
            pdfmetrics.registerFont(TTFont("HLDBold", bold))
            pdfmetrics.registerFont(TTFont("HLDItalic", italic))
            return "HLDRegular", "HLDBold", "HLDItalic"
    return "Helvetica", "Helvetica-Bold", "Helvetica-Oblique"


REGULAR_FONT, BOLD_FONT, ITALIC_FONT = register_fonts()


def make_styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "cover_kicker": ParagraphStyle(
            "CoverKicker",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=8.5,
            leading=11,
            textColor=AMBER,
            spaceAfter=10,
            tracking=1.25,
            uppercase=True,
        ),
        "cover_title": ParagraphStyle(
            "CoverTitle",
            parent=base["Title"],
            fontName=BOLD_FONT,
            fontSize=30,
            leading=32,
            textColor=WHITE,
            alignment=TA_LEFT,
            spaceAfter=15,
        ),
        "cover_subtitle": ParagraphStyle(
            "CoverSubtitle",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=12,
            leading=17,
            textColor=colors.HexColor("#E9EDF5"),
        ),
        "cover_meta": ParagraphStyle(
            "CoverMeta",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=8.5,
            leading=12,
            textColor=colors.HexColor("#D4DAE6"),
        ),
        "h2": ParagraphStyle(
            "H2",
            parent=base["Heading2"],
            fontName=BOLD_FONT,
            fontSize=18,
            leading=21,
            textColor=INK,
            spaceBefore=8,
            spaceAfter=10,
            keepWithNext=True,
        ),
        "h3": ParagraphStyle(
            "H3",
            parent=base["Heading3"],
            fontName=BOLD_FONT,
            fontSize=11.8,
            leading=14.5,
            textColor=SUNSET,
            spaceBefore=9,
            spaceAfter=5,
            keepWithNext=True,
        ),
        "h4": ParagraphStyle(
            "H4",
            parent=base["Heading4"],
            fontName=BOLD_FONT,
            fontSize=9.7,
            leading=12,
            textColor=INK,
            spaceBefore=7,
            spaceAfter=3,
            keepWithNext=True,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=9.15,
            leading=13.2,
            textColor=INK_2,
            spaceAfter=7,
            splitLongWords=True,
            allowWidows=0,
            allowOrphans=0,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=8.95,
            leading=12.6,
            textColor=INK_2,
            leftIndent=14,
            firstLineIndent=0,
            bulletIndent=2,
            spaceAfter=3.2,
            splitLongWords=True,
        ),
        "numbered": ParagraphStyle(
            "Numbered",
            parent=base["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=8.95,
            leading=12.6,
            textColor=INK_2,
            leftIndent=19,
            firstLineIndent=0,
            bulletIndent=1,
            spaceAfter=3.5,
            splitLongWords=True,
        ),
        "quote": ParagraphStyle(
            "Quote",
            parent=base["BodyText"],
            fontName=BOLD_FONT,
            fontSize=12.5,
            leading=17,
            textColor=INK,
            spaceAfter=0,
        ),
        "table_header": ParagraphStyle(
            "TableHeader",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=7.3,
            leading=9.1,
            textColor=WHITE,
        ),
        "table_cell": ParagraphStyle(
            "TableCell",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=7.15,
            leading=9.25,
            textColor=INK_2,
            splitLongWords=True,
        ),
        "table_cell_bold": ParagraphStyle(
            "TableCellBold",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=7.25,
            leading=9.35,
            textColor=INK,
            splitLongWords=True,
        ),
        "card_title": ParagraphStyle(
            "CardTitle",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=9.2,
            leading=11,
            textColor=INK,
        ),
        "card_label": ParagraphStyle(
            "CardLabel",
            parent=base["Normal"],
            fontName=BOLD_FONT,
            fontSize=6.7,
            leading=8.5,
            textColor=SUNSET,
        ),
        "card_body": ParagraphStyle(
            "CardBody",
            parent=base["Normal"],
            fontName=REGULAR_FONT,
            fontSize=7.35,
            leading=9.7,
            textColor=INK_2,
            splitLongWords=True,
        ),
        "code": ParagraphStyle(
            "Code",
            parent=base["Code"],
            fontName="Courier",
            fontSize=7.5,
            leading=10,
            textColor=INK,
            backColor=PALE_BLUE,
            borderPadding=7,
            leftIndent=3,
            rightIndent=3,
            spaceAfter=8,
            splitLongWords=True,
        ),
        "source": ParagraphStyle(
            "Source",
            parent=base["BodyText"],
            fontName=REGULAR_FONT,
            fontSize=7.45,
            leading=10.4,
            textColor=INK_2,
            leftIndent=10,
            bulletIndent=1,
            spaceAfter=5,
            splitLongWords=True,
        ),
    }


STYLES = make_styles()


class FlywheelFlowable(Flowable):
    def __init__(self, width: float, height: float = 76):
        super().__init__()
        self.width = width
        self.height = height

    def draw(self) -> None:
        canvas = self.canv
        labels = ["DISCOVER", "LEARN", "QUALIFY", "DELIVER", "MENTOR"]
        gap = 11
        box_width = (self.width - gap * (len(labels) - 1)) / len(labels)
        y = 24
        for index, label in enumerate(labels):
            x = index * (box_width + gap)
            canvas.setFillColor(WHITE if index % 2 == 0 else colors.HexColor("#F6E4C5"))
            canvas.setStrokeColor(AMBER)
            canvas.setLineWidth(1.2)
            canvas.roundRect(x, y, box_width, 31, 3, fill=1, stroke=1)
            canvas.setFillColor(INK)
            canvas.setFont(BOLD_FONT, 7.2)
            canvas.drawCentredString(x + box_width / 2, y + 11, label)
            if index < len(labels) - 1:
                start_x = x + box_width + 2
                end_x = x + box_width + gap - 2
                arrow_y = y + 15.5
                canvas.setStrokeColor(AMBER)
                canvas.setFillColor(AMBER)
                canvas.line(start_x, arrow_y, end_x, arrow_y)
                canvas.line(end_x, arrow_y, end_x - 3, arrow_y + 2.3)
                canvas.line(end_x, arrow_y, end_x - 3, arrow_y - 2.3)
        canvas.setFillColor(colors.HexColor("#D4DAE6"))
        canvas.setFont(REGULAR_FONT, 7.4)
        canvas.drawString(0, 4, "From ordinary dancer to local leader, reliable instructor, and paid community program.")


def clean_title(text: str) -> str:
    return re.sub(r"[*_`]", "", text).strip()


def readable_url(url: str) -> str:
    parsed = urlparse(url)
    host = parsed.netloc.removeprefix("www.")
    path = parsed.path.rstrip("/")
    display = host + (path if len(path) < 42 else path[:39] + "...")
    return display or url


def inline_markup(text: str) -> str:
    placeholders: dict[str, str] = {}

    def reserve(markup: str) -> str:
        token = f"@@TOKEN{len(placeholders)}@@"
        placeholders[token] = markup
        return token

    def markdown_link(match: re.Match[str]) -> str:
        label = html.escape(match.group(1))
        url = html.escape(match.group(2), quote=True)
        return reserve(f'<link href="{url}" color="#8E341F"><u>{label}</u></link>')

    text = re.sub(r"\[([^\]]+)\]\((https?://[^)]+|\.?\.?/[^)]+)\)", markdown_link, text)

    def code_span(match: re.Match[str]) -> str:
        value = html.escape(match.group(1))
        return reserve(f'<font name="Courier" size="7.6" color="#1C2A44">{value}</font>')

    text = re.sub(r"`([^`]+)`", code_span, text)

    def raw_url(match: re.Match[str]) -> str:
        url = match.group(0).rstrip(".,")
        suffix = match.group(0)[len(url) :]
        safe_url = html.escape(url, quote=True)
        label = html.escape(readable_url(url))
        return reserve(f'<link href="{safe_url}" color="#8E341F"><u>{label}</u></link>') + suffix

    text = re.sub(r"https?://[^\s<]+", raw_url, text)
    text = html.escape(text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    for token, markup in placeholders.items():
        text = text.replace(html.escape(token), markup)
    return text


def is_separator_row(line: str) -> bool:
    cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells)


def parse_table(lines: list[str], start: int) -> tuple[list[list[str]], int]:
    rows: list[list[str]] = []
    index = start
    while index < len(lines) and lines[index].lstrip().startswith("|"):
        row = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
        rows.append(row)
        index += 1
    if len(rows) >= 2 and is_separator_row(lines[start + 1]):
        rows.pop(1)
    return rows, index


def column_widths(rows: list[list[str]], width: float) -> list[float]:
    columns = len(rows[0])
    weights: list[float] = []
    for column in range(columns):
        lengths = [len(clean_title(row[column])) for row in rows if column < len(row)]
        average_length = sum(lengths) / max(1, len(lengths))
        max_length = max(lengths) if lengths else 1
        weights.append(max(7.0, min(34.0, average_length * 0.55 + max_length * 0.18)))
    total = sum(weights)
    widths = [width * weight / total for weight in weights]
    minimum = 0.55 * inch
    deficit = sum(max(0.0, minimum - item) for item in widths)
    if deficit:
        adjustable = [max(0.0, item - minimum) for item in widths]
        adjustable_total = sum(adjustable)
        widths = [
            minimum if item < minimum else item - deficit * (room / adjustable_total if adjustable_total else 0)
            for item, room in zip(widths, adjustable)
        ]
    return widths


def standard_table(rows: list[list[str]]) -> Table:
    columns = len(rows[0])
    normalized = [row + [""] * (columns - len(row)) for row in rows]
    data: list[list[Paragraph]] = []
    for row_index, row in enumerate(normalized):
        style = STYLES["table_header"] if row_index == 0 else STYLES["table_cell"]
        data.append([Paragraph(inline_markup(cell), style) for cell in row])
    widths = column_widths(normalized, CONTENT_WIDTH)
    table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), INK),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("GRID", (0, 0), (-1, -1), 0.45, LINE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, PAPER_2]),
            ]
        )
    )
    return table


def wide_table_cards(rows: list[list[str]]) -> list[Flowable]:
    header = rows[0]
    output: list[Flowable] = []
    for row in rows[1:]:
        row = row + [""] * (len(header) - len(row))
        if len(row) > 1:
            title = f"{header[0]} {clean_title(row[0])} | {clean_title(row[1])}"
        else:
            title = clean_title(row[0])
        card_rows: list[list[object]] = [
            [Paragraph(inline_markup(title), STYLES["card_title"]), ""]
        ]
        for label, value in zip(header[2:], row[2:]):
            card_rows.append(
                [
                    Paragraph(inline_markup(label.upper()), STYLES["card_label"]),
                    Paragraph(inline_markup(value), STYLES["card_body"]),
                ]
            )
        card = Table(card_rows, colWidths=[1.12 * inch, CONTENT_WIDTH - 1.12 * inch], hAlign="LEFT", splitByRow=1)
        card.setStyle(
            TableStyle(
                [
                    ("SPAN", (0, 0), (-1, 0)),
                    ("BACKGROUND", (0, 0), (-1, 0), PALE_AMBER),
                    ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#E0C28D")),
                    ("INNERGRID", (0, 1), (-1, -1), 0.35, LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 6),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]
            )
        )
        output.extend([card, Spacer(1, 7)])
    return output


def quote_box(text: str) -> Table:
    content = Paragraph(inline_markup(text), STYLES["quote"])
    table = Table([[content]], colWidths=[CONTENT_WIDTH], hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE_AMBER),
                ("BOX", (0, 0), (-1, -1), 0.8, AMBER),
                ("LINEBEFORE", (0, 0), (0, -1), 5, SUNSET),
                ("LEFTPADDING", (0, 0), (-1, -1), 15),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 13),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 13),
            ]
        )
    )
    return table


MAJOR_PAGE_BREAKS = {
    "Buyer portfolio",
    "90-day paid pilot",
    "Twelve-month rollout",
    "Sources and reference observations",
}


def is_special_line(line: str) -> bool:
    stripped = line.strip()
    return (
        not stripped
        or stripped.startswith("#")
        or stripped.startswith("|")
        or stripped.startswith("- ")
        or stripped.startswith(">")
        or stripped.startswith("```")
        or bool(re.match(r"^\d+\.\s", stripped))
    )


def markdown_story(markdown_text: str) -> list[Flowable]:
    if any(character in markdown_text for character in ("\u2014", "\u2013", "\u2011")):
        raise ValueError("Strategy contains a non-ASCII dash. Replace it before rendering.")

    lines = markdown_text.splitlines()
    story: list[Flowable] = []
    start = next((i for i, line in enumerate(lines) if line.startswith("## ")), 0)
    lines = lines[start:]
    index = 0
    first_h2 = True
    in_sources = False

    while index < len(lines):
        line = lines[index].rstrip()
        stripped = line.strip()

        if not stripped:
            index += 1
            continue

        if stripped.startswith("## "):
            title = clean_title(stripped[3:])
            in_sources = title == "Sources and reference observations"
            if not first_h2 and title in MAJOR_PAGE_BREAKS:
                story.append(PageBreak())
            first_h2 = False
            story.extend(
                [
                    Paragraph(inline_markup(title.upper()), STYLES["h2"]),
                    HRFlowable(width="100%", thickness=1.2, color=AMBER, spaceBefore=0, spaceAfter=8),
                ]
            )
            index += 1
            continue

        if stripped.startswith("### "):
            story.append(Paragraph(inline_markup(stripped[4:]), STYLES["h3"]))
            index += 1
            continue

        if stripped.startswith("#### "):
            story.append(Paragraph(inline_markup(stripped[5:]), STYLES["h4"]))
            index += 1
            continue

        if stripped.startswith("```"):
            code_lines: list[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code_lines.append(lines[index])
                index += 1
            index += 1
            code_text = "<br/>".join(html.escape(item) for item in code_lines)
            story.append(Paragraph(code_text, STYLES["code"]))
            continue

        if stripped.startswith("|") and index + 1 < len(lines) and is_separator_row(lines[index + 1]):
            rows, index = parse_table(lines, index)
            if len(rows[0]) > 5:
                story.extend(wide_table_cards(rows))
            else:
                story.append(KeepTogether([standard_table(rows), Spacer(1, 9)]))
            continue

        if stripped.startswith(">"):
            quote_lines: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                quote_lines.append(lines[index].strip().lstrip(">").strip())
                index += 1
            story.extend([quote_box(" ".join(quote_lines)), Spacer(1, 9)])
            continue

        numbered = re.match(r"^(\d+)\.\s+(.*)", stripped)
        if numbered:
            story.append(
                Paragraph(
                    inline_markup(numbered.group(2)),
                    STYLES["numbered"],
                    bulletText=f"{numbered.group(1)}.",
                )
            )
            index += 1
            continue

        if stripped.startswith("- "):
            style = STYLES["source"] if in_sources else STYLES["bullet"]
            story.append(Paragraph(inline_markup(stripped[2:]), style, bulletText="-"))
            index += 1
            continue

        paragraph_lines = [stripped]
        index += 1
        while index < len(lines) and not is_special_line(lines[index]):
            paragraph_lines.append(lines[index].strip())
            index += 1
        story.append(Paragraph(inline_markup(" ".join(paragraph_lines)), STYLES["body"]))

    return story


def cover_story() -> list[Flowable]:
    cover_panel = Table(
        [
            [Paragraph("HIRE LINE DANCERS / STRATEGY 01", STYLES["cover_kicker"])],
            [Paragraph("Recurring Institutional Programs", STYLES["cover_title"])],
            [
                Paragraph(
                    "A managed-program agency plan for turning reliable instructors into recurring paid community programs.",
                    STYLES["cover_subtitle"],
                )
            ],
            [Spacer(1, 20)],
            [FlywheelFlowable(CONTENT_WIDTH - 38)],
            [Spacer(1, 18)],
            [Paragraph("WORKING STRATEGY / VERSION 1.0 / AUGUST 4, 2026", STYLES["cover_meta"])],
        ],
        colWidths=[CONTENT_WIDTH],
        hAlign="LEFT",
    )
    cover_panel.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), INK),
                ("BOX", (0, 0), (-1, -1), 0, INK),
                ("LEFTPADDING", (0, 0), (-1, -1), 20),
                ("RIGHTPADDING", (0, 0), (-1, -1), 20),
                ("TOPPADDING", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
            ]
        )
    )
    return [Spacer(1, 0.72 * inch), cover_panel, PageBreak()]


def draw_page(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFillColor(PAPER)
    canvas.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, fill=1, stroke=0)
    if doc.page == 1:
        canvas.setFillColor(AMBER)
        canvas.rect(0, PAGE_HEIGHT - 0.18 * inch, PAGE_WIDTH, 0.18 * inch, fill=1, stroke=0)
    else:
        canvas.setStrokeColor(AMBER)
        canvas.setLineWidth(1.25)
        canvas.line(LEFT_MARGIN, PAGE_HEIGHT - 0.36 * inch, PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 0.36 * inch)
        canvas.setFillColor(INK)
        canvas.setFont(BOLD_FONT, 7.2)
        canvas.drawString(LEFT_MARGIN, PAGE_HEIGHT - 0.28 * inch, "HIRE LINE DANCERS")
        canvas.setFillColor(MUTED)
        canvas.setFont(REGULAR_FONT, 7.0)
        canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, PAGE_HEIGHT - 0.28 * inch, "RECURRING PROGRAMS STRATEGY")
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.5)
        canvas.line(LEFT_MARGIN, 0.39 * inch, PAGE_WIDTH - RIGHT_MARGIN, 0.39 * inch)
        canvas.setFillColor(MUTED)
        canvas.setFont(REGULAR_FONT, 7)
        canvas.drawString(LEFT_MARGIN, 0.23 * inch, "Working strategy | August 4, 2026")
        canvas.drawRightString(PAGE_WIDTH - RIGHT_MARGIN, 0.23 * inch, f"{doc.page}")
    canvas.restoreState()


def build_pdf(input_path: Path, output_path: Path) -> None:
    markdown_text = input_path.read_text(encoding="utf-8")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=letter,
        rightMargin=RIGHT_MARGIN,
        leftMargin=LEFT_MARGIN,
        topMargin=TOP_MARGIN,
        bottomMargin=BOTTOM_MARGIN,
        title="Hire Line Dancers Recurring Institutional Programs Strategy",
        author="Hire Line Dancers",
        subject="Managed recurring institutional line-dance programs",
        creator="Hire Line Dancers strategy renderer",
    )
    story = cover_story() + markdown_story(markdown_text)
    doc.build(story, onFirstPage=draw_page, onLaterPages=draw_page)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build_pdf(args.input.resolve(), args.output.resolve())


if __name__ == "__main__":
    main()
