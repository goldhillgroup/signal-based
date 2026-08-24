"""Build the Signal Radar handbook as a real PDF.

Not a printed web page. The earlier version was HTML rendered through headless
Chrome, which produced something legible and obviously second-hand: no cover, no
contents, no bookmarks, and pagination that had to be argued with in CSS three
times before headings stopped stranding at the foot of a page.

ReportLab lays out for paper directly, so the things that matter on paper are
expressible rather than approximated — KeepTogether around a box that must not
split, CondPageBreak before a section that would otherwise start two lines
before a break, a table header that repeats, and a real PDF outline so the
reader's sidebar works.

    python3 scripts/build_handbook.py

Writes "folder docs/Signal Radar Handbook.pdf".
"""
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "folder docs" / "Signal Radar Handbook.pdf"

# The product's own palette, lifted from app/globals.css so the document and the
# thing it documents are recognisably the same system.
NAVY = colors.HexColor("#001A57")
SKY = colors.HexColor("#0FA5E1")
SKY_LIGHT = colors.HexColor("#E7F5FC")
INK = colors.HexColor("#0B1220")
SLATE = colors.HexColor("#4B5768")
MUTED = colors.HexColor("#8892A0")
LINE = colors.HexColor("#E3E7EE")
SOFT = colors.HexColor("#F1F3F6")
GREEN = colors.HexColor("#0F7A52")
GREEN_LIGHT = colors.HexColor("#E4F4EC")
AMBER = colors.HexColor("#8A5A00")
AMBER_LIGHT = colors.HexColor("#FBF0DC")

# Arial on a Mac, DejaVu on Linux, Helvetica as a last resort — so this builds
# on whatever machine happens to have it, not only the one it was written on.
FONT_CANDIDATES = [
    ("/System/Library/Fonts/Supplemental/Arial.ttf",
     "/System/Library/Fonts/Supplemental/Arial Bold.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
     "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
]
MONO_CANDIDATES = [
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
]

FONT, FONT_BOLD, MONO = "Helvetica", "Helvetica-Bold", "Courier"
for regular, bold in FONT_CANDIDATES:
    if Path(regular).exists() and Path(bold).exists():
        pdfmetrics.registerFont(TTFont("HandbookSans", regular))
        pdfmetrics.registerFont(TTFont("HandbookSans-Bold", bold))
        FONT, FONT_BOLD = "HandbookSans", "HandbookSans-Bold"
        break
for mono in MONO_CANDIDATES:
    if Path(mono).exists():
        try:
            pdfmetrics.registerFont(TTFont("HandbookMono", mono))
            MONO = "HandbookMono"
            break
        except Exception:
            continue  # .ttc collections do not always load; fall through

# Without this, <b> inside a Paragraph silently does nothing: ReportLab resolves
# bold through the registered FAMILY rather than by guessing a "-Bold" suffix.
# Every emphasis in the document would render as plain text.
pdfmetrics.registerFontFamily(
    FONT, normal=FONT, bold=FONT_BOLD, italic=FONT, boldItalic=FONT_BOLD)

W = 166 * mm  # usable text width, inside 22mm margins


class HandbookDoc(BaseDocTemplate):
    """Adds PDF bookmarks and feeds the printed contents page."""

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name in ("Section", "Subsection"):
            level = 0 if flowable.style.name == "Section" else 1
            text = flowable.getPlainText()
            slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
            key = f"h{level}-{slug}"
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text, key, level=level, closed=False)
            # Only numbered sections reach the printed contents. Listing every
            # subsection too turns a one-page contents into two and makes a
            # short handbook look long; the sidebar still has them all.
            if level == 0:
                self.notify("TOCEntry", (level, text, self.page, key))


S = getSampleStyleSheet()
S.add(ParagraphStyle("Body", parent=S["BodyText"], fontName=FONT, fontSize=9.5,
                     leading=14.5, textColor=SLATE, spaceAfter=6))
S.add(ParagraphStyle("Lede", parent=S["BodyText"], fontName=FONT, fontSize=10.5,
                     leading=16, textColor=SLATE, spaceAfter=9))
S.add(ParagraphStyle("Section", parent=S["Heading1"], fontName=FONT_BOLD, fontSize=17,
                     leading=21, textColor=NAVY, spaceBefore=2, spaceAfter=8,
                     keepWithNext=True))
S.add(ParagraphStyle("Subsection", parent=S["Heading2"], fontName=FONT_BOLD, fontSize=11.5,
                     leading=15, textColor=INK, spaceBefore=9, spaceAfter=4,
                     keepWithNext=True))
S.add(ParagraphStyle("CardTitle", parent=S["BodyText"], fontName=FONT_BOLD, fontSize=9.5,
                     leading=13, textColor=INK, spaceAfter=2))
S.add(ParagraphStyle("HBullet", parent=S["BodyText"], fontName=FONT, fontSize=9.5,
                     leading=14.5, leftIndent=13, firstLineIndent=-8, bulletIndent=0,
                     textColor=SLATE, spaceAfter=4))
S.add(ParagraphStyle("Cell", parent=S["BodyText"], fontName=FONT, fontSize=9,
                     leading=12.5, textColor=SLATE))
S.add(ParagraphStyle("CellKey", parent=S["BodyText"], fontName=FONT_BOLD, fontSize=9,
                     leading=12.5, textColor=INK))
S.add(ParagraphStyle("CellMono", parent=S["BodyText"], fontName=MONO, fontSize=8,
                     leading=11.5, textColor=NAVY))
S.add(ParagraphStyle("TH", parent=S["BodyText"], fontName=FONT_BOLD, fontSize=7.2,
                     leading=10, textColor=MUTED))
S.add(ParagraphStyle("CoverKicker", parent=S["BodyText"], fontName=FONT_BOLD, fontSize=10.5,
                     leading=14, textColor=SKY))
S.add(ParagraphStyle("CoverTitle", parent=S["Title"], fontName=FONT_BOLD, fontSize=34,
                     leading=37, textColor=NAVY, alignment=TA_LEFT, spaceAfter=12))
S.add(ParagraphStyle("CoverSub", parent=S["BodyText"], fontName=FONT, fontSize=13,
                     leading=19, textColor=SLATE))
S.add(ParagraphStyle("TOCHeading", parent=S["Heading1"], fontName=FONT_BOLD, fontSize=22,
                     leading=27, textColor=NAVY, spaceAfter=14))
S.add(ParagraphStyle("CredLabel", parent=S["BodyText"], fontName=FONT_BOLD, fontSize=7.2,
                     leading=10, textColor=MUTED))
S.add(ParagraphStyle("CredValue", parent=S["BodyText"], fontName=MONO, fontSize=11,
                     leading=15, textColor=NAVY))
S.add(ParagraphStyle("StepText", parent=S["BodyText"], fontName=FONT, fontSize=9.5,
                     leading=14.5, textColor=SLATE))
S.add(ParagraphStyle("StepNum", parent=S["BodyText"], fontName=FONT_BOLD, fontSize=8.5,
                     leading=8.5, textColor=colors.white, alignment=1))


def body(text):
    return Paragraph(text, S["Body"])


def lede(text):
    return Paragraph(text, S["Lede"])


def bullets(items):
    return [Paragraph(f"- {i}", S["HBullet"]) for i in items]


def section(number, title):
    # 55mm: enough that a section never starts with its heading alone at the
    # foot of a page, which is the single ugliest thing a long PDF does.
    return [
        CondPageBreak(55 * mm),
        Paragraph(f"{number}. {title}", S["Section"]),
        HRFlowable(width="100%", thickness=1.2, color=SKY, spaceAfter=8),
    ]


def subsection(title):
    return Paragraph(title, S["Subsection"])


def note(title, text, tone="sky"):
    bg, accent = {
        "sky": (SKY_LIGHT, SKY),
        "green": (GREEN_LIGHT, GREEN),
        "amber": (AMBER_LIGHT, AMBER),
        "gray": (SOFT, MUTED),
    }[tone]
    t = Table([[Paragraph(title, S["CardTitle"])], [body(text)]], colWidths=[W])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.5, accent),
        ("LINEBEFORE", (0, 0), (0, -1), 3.5, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("RIGHTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 1),
        ("TOPPADDING", (0, -1), (-1, -1), 0),
    ]))
    return KeepTogether([t, Spacer(1, 7)])


def credentials(rows):
    """The three things somebody needs in front of them to get in."""
    data = [[Paragraph(k.upper(), S["CredLabel"]), Paragraph(v, S["CredValue"])] for k, v in rows]
    t = Table(data, colWidths=[32 * mm, W - 32 * mm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 11),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return KeepTogether([t, Spacer(1, 8)])


def steps(items):
    """Numbered steps, each in a filled circle, each unsplittable."""
    out = []
    for n, (title, text) in enumerate(items, 1):
        num = Table([[Paragraph(str(n), S["StepNum"])]],
                    colWidths=[6 * mm], rowHeights=[6 * mm])
        num.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), NAVY),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("ROUNDEDCORNERS", [3 * mm] * 4),
        ]))
        text_p = Paragraph(f"<b>{title}</b> {text}" if title else text, S["StepText"])
        row = Table([[num, text_p]], colWidths=[11 * mm, W - 11 * mm])
        row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        out.append(KeepTogether(row))
    out.append(Spacer(1, 5))
    return out


def table(headers, rows, widths, mono_cols=()):
    """A table whose header repeats when it splits across a page."""
    head = [Paragraph(h.upper(), S["TH"]) for h in headers]
    data = [head]
    for r in rows:
        cells = []
        for i, c in enumerate(r):
            if i in mono_cols:
                cells.append(Paragraph(c, S["CellMono"]))
            elif i == 0:
                cells.append(Paragraph(c, S["CellKey"]))
            else:
                cells.append(Paragraph(c, S["Cell"]))
        data.append(cells)
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), SOFT),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("LINEBELOW", (0, 0), (-1, 0), 0.6, colors.HexColor("#CDD4E0")),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return [t, Spacer(1, 8)]


def draw_cover(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setFillColor(NAVY)
    canvas.rect(0, height - 16 * mm, width, 16 * mm, stroke=0, fill=1)
    canvas.setFillColor(SKY)
    canvas.rect(0, 0, width, 6 * mm, stroke=0, fill=1)
    canvas.restoreState()


def draw_body(canvas, doc):
    canvas.saveState()
    width, height = A4
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.5)
    canvas.line(22 * mm, height - 17 * mm, width - 22 * mm, height - 17 * mm)
    canvas.setFont(FONT_BOLD, 7.5)
    canvas.setFillColor(NAVY)
    canvas.drawString(22 * mm, height - 13.5 * mm, "SIGNAL RADAR")
    canvas.setFont(FONT, 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(width - 22 * mm, height - 13.5 * mm, "The Goldhill Group")
    canvas.line(22 * mm, 15 * mm, width - 22 * mm, 15 * mm)
    canvas.setFont(FONT, 7)
    canvas.drawString(22 * mm, 10.5 * mm, "Handbook")
    # Front matter carries no number. The cover is page 1 and the contents page
    # 2 in ReportLab's count, so the first page a reader would call "1" is 3.
    n = doc.page - 2
    if n >= 1:
        canvas.drawRightString(width - 22 * mm, 10.5 * mm, f"Page {n}")
    canvas.restoreState()


doc = HandbookDoc(
    str(OUTPUT), pagesize=A4,
    leftMargin=22 * mm, rightMargin=22 * mm, topMargin=24 * mm, bottomMargin=21 * mm,
    title="Signal Radar Handbook", author="The Goldhill Group",
    subject="How to use Signal Radar",
)
doc.addPageTemplates([
    PageTemplate(id="Cover", frames=[Frame(22 * mm, 18 * mm, W, 251 * mm, id="cover")],
                 onPage=draw_cover, autoNextPageTemplate="Body"),
    PageTemplate(id="Body", frames=[Frame(22 * mm, 21 * mm, W, 253 * mm, id="body")],
                 onPage=draw_body, autoNextPageTemplate="Body"),
])

story = []

# ── Cover ──────────────────────────────────────────────────────────────────
story += [
    Spacer(1, 36 * mm),
    Paragraph("THE GOLDHILL GROUP", S["CoverKicker"]),
    Spacer(1, 7 * mm),
    Paragraph("Signal<br/>Radar", S["CoverTitle"]),
    Spacer(1, 3 * mm),
    Paragraph(
        "Finds family firms where the founder still runs things and a son or daughter is stepping up beside them. Shows you the company's own words as proof.", S["CoverSub"]),
    Spacer(1, 12 * mm),
    HRFlowable(width="42%", thickness=2, color=SKY, hAlign="LEFT"),
    Spacer(1, 6 * mm),
    Paragraph("Handbook &middot; August 2026", S["Body"]),
    PageBreak(),
]

# ── Contents ───────────────────────────────────────────────────────────────
toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle("TOC0", fontName=FONT, fontSize=10.5, leading=20,
                   textColor=INK, leftIndent=0, firstLineIndent=0),
]
story += [Paragraph("Contents", S["TOCHeading"]), toc, PageBreak()]

# ── 1. Signing in ──────────────────────────────────────────────────────────
story += section(1, "Signing in")
story += [credentials([
    ("Go to", "signal-based.vercel.app"),
    ("Email", "jonathan@thegoldhillgroup.com"),
    ("Password", "Goldhill-Radar-2026"),
])]
story += steps([
    ("Open the address above", "in any browser, on a laptop or a phone. There is nothing to install."),
    ("Type the email and password,", "then press <b>Sign in</b>."),
    ("You land on Overview:", "your numbers, and anything that finished while you were away."),
    ("Bookmark it", "so you never have to find the address again."),
])

# ── 2. The five screens ────────────────────────────────────────────────────
story += section(2, "The five screens")
story += table(
    ["Screen", "What it is for"],
    [
        ["Overview", "Your numbers at a glance, and anything finished while you were away."],
        ["Signal Radar", "Where you start a new search. This is the main screen."],
        ["Enrichment", "Finding email addresses for leads you already have."],
        ["Lead Lists", "Every search you have run, as cards or as a list. Open one to read its leads."],
        ["Settings", "The vendor keys, and what each service has left."],
    ],
    [38 * mm, W - 38 * mm],
)

# ── 3. Running a search ────────────────────────────────────────────────────
story += section(3, "Running a search")
story += [lede("Signal Radar &rarr; the form already carries sensible defaults, "
               "so most of the time you can simply press Search.")]
story += steps([
    ("Mode.", "Leave it on <i>Hybrid</i>. That looks for founder-and-successor pairs and keeps every other good family business it passes on the way."),
    ("Verticals.", "Eight are available: landscaping, home building, construction, specialty trades, manufacturing, distribution, property services, professional services. Pick any combination, or none to search all eight."),
    ("States.", "Your twelve are pre-selected: California, Florida, Texas, New York and the Northeast."),
    ("Revenue band.", "Defaults to $5-15M, the sweet spot. $5-30M widens it to your full profile."),
    ("How many to find.", "Higher numbers read more companies and take longer. The form tells you how many it will read and roughly what it will cost."),
    ("Signal focus.", "Optional. Tick any of the twelve signals from your profile, or type your own words. This changes what the search looks for."),
    ("Press Search.", "It shows exactly what it will read and what it will cost, and waits for you to confirm."),
])
story += [subsection("What happens after you press Search")]
story += [body(
    "It looks for companies in four different ways at once, then reads what it "
    "finds. The four are not equal, and it spends accordingly.")]
story += table(
    ["How it looks", "What that means", "How well it works"],
    [
        ["Web search",
         "Searches phrases a family firm uses about itself, like \"second generation\" "
         "or \"joined the business\", so the results are already the right shape.",
         "Best. About one pair in every 33 companies. Gets twice the budget."],
        ["Google Maps",
         "Asks for every landscaper in a town. No succession filter, but it returns "
         "the phone number and address with the listing.",
         "Weakest. One pair in 172. Kept small."],
        ["Directories",
         "Trade association member lists and similar, read for company names.",
         "No pairs yet. Kept alive on a floor in case that changes."],
        ["Licensing boards",
         "State contractor registries, where they publish openly.",
         "Occasional. Depends entirely on the state."],
    ],
    [26 * mm, W - 84 * mm, 58 * mm],
)
story += [body(
    "Each company it finds is then read. It opens the About or Team page and decides whether two generations are really named, and really there today. A second pass then tries to prove the first one wrong. What survives both is quoted back to you, with a link.")]
story += [body(
    "It also remembers. Every company it has judged is skipped next time. Run the same search twice and it covers new ground instead of paying for the old list again.")]

story += [note("A big search runs in several passes.",
               "The server stops any single run after five minutes. Everything found is "
               "saved and the next pass starts on its own. You do not have to do anything.")]

# ── 4. Reading the results ─────────────────────────────────────────────────
story += section(4, "Lead Lists")
story += [lede("A list is one search and everything it found.")]
story += [body(
    "Lead Lists shows them all. Use Cards or List, top right, to switch how they "
    "are drawn; List is easier once you have more than a few. Click anywhere on "
    "a list to open it. The pencil renames it, the bin deletes it.")]
story += [body(
    "Open one to read the leads, check a quote, export them, or look up email "
    "addresses. Inside, four tabs.")]
story += table(
    ["Tab", "What it means"],
    [
        ["All leads", "Everything the search got you. This is where it opens."],
        ["Founder + successor", "Both generations named, both running it today. What the product is for, and the rarest: about one company in thirty."],
        ["Good fit, no successor named", "Right trade, right area, family-run, but the site does not name a successor. There may still be one; worth a call."],
        ["Not a fit", "Cut, with the reason on the row. Shown so you can disagree with it."],
    ],
    [42 * mm, W - 42 * mm],
)
story += [body(
    "The first three add up to the All leads number. Deleting a list removes it "
    "from Recent searches on the Overview too.")]
story += [subsection("Making room")]
story += [body(
    "Collapse at the foot of the dark menu narrows it to icons and remembers, "
    "so it stays that way until you widen it again. Hover an icon to see its "
    "name. On a phone the menu is behind the button at the top left.")]
story += [subsection("The quote is the point")]
story += [body(
    "Every confirmed pair carries a sentence from the company's own website, with "
    "a link to the page it came from. You can check any claim in one click. If a "
    "lead has no quote, it has not earned the label, and the system lowers "
    "it rather than pretending.")]
story += [subsection("Confidence")]
story += table(
    ["Label", "Means"],
    [
        ["High", "Both named with titles, explicit succession language, and two or more supporting signals. Act on it."],
        ["Medium", "The pair is there, but the handover is implied rather than spelled out."],
        ["Verify", "Real but thin. Worth a look before you call."],
    ],
    [26 * mm, W - 26 * mm],
)

# ── 5. Finding email addresses ─────────────────────────────────────────────
story += section(5, "Finding a personal email")
story += [lede("This step looks for a named person\u2019s own address, not another "
               "office inbox. Separate from searching, never automatic, and it "
               "costs money per address found.")]
story += [body(
    "Where a company already prints a general address such as office@ or "
    "info@, the list keeps it in the General inbox column. That is the front "
    "desk. The Email column is the one that reaches the founder or the son "
    "or daughter by name, and it reads Needs enrichment until this step has "
    "run, or Not found if it ran and there was nothing to find.")]
story += steps([
    ("Press Find personal emails:", "on the Overview, inside a list, or on the Enrichment screen. All three do the same thing."),
    ("Tick who you want:", "founder + successor, good fits, or cut but arguable. Pairs and fits are ticked for you."),
    ("The button shows", "the number of companies and the most it can cost. Press it to start."),
])
story += [note("You are only charged when an address is actually found.",
               "A miss costs nothing, so the real figure is almost always lower than the "
               "estimate. Every address found is then checked to make sure it is deliverable.",
               "green")]
story += [note("It looks for the successor first.",
               "Where a next-generation family member is named, that is who it tries to "
               "reach. The founder is the fallback.")]

# ── 6. Getting the list out ────────────────────────────────────────────────
story += section(6, "Getting the list out")
story += bullets([
    "<b>Download CSV</b>, opens in Excel or Numbers.",
    "<b>Copy for Google Sheets</b>, copies to your clipboard; paste straight into a sheet.",
])
story += [Spacer(1, 4)]
story += [note("The file contains exactly what the screen shows.",
               "Companies hidden as a different kind of business entirely, such as funeral "
               "homes, newspapers, trade associations, are left out of both.", "gray")]

# ── 7. Settings ────────────────────────────────────────────────────────────
story += section(7, "Settings")
story += [body(
    "One thing lives here: the six vendor keys, each with its balance shown live "
    "beside it. If a service ever runs out, this is where you paste a new key, and "
    "it takes effect immediately, with no developer and no waiting.")]
story += [note("Everything about what a search looks for is on the search form itself.",
               "The verticals, the states, the revenue band and the signal focus. There is "
               "no second place to set them, so nothing can be quietly steering a search "
               "from a screen you have not opened.")]

# ── 8. What it costs ───────────────────────────────────────────────────────
story += section(8, "What it costs")
J = "jonathan@<br/>thegoldhillgroup.com"
G = "thegoldhillgroup@<br/>gmail.com"
story += table(
    ["Service", "What it does", "Cost", "Left today", "Account"],
    [
        ["Apify", "Finds companies and fetches their pages", "$29<br/>per month", "$9.53 used<br/>this month", J],
        ["OpenRouter", "Reads each page and judges it", "Pay per use<br/>~45&cent; a search", "$49.50<br/>left", J],
        ["AnymailFinder", "Finds an email address", "$29 a month<br/>400 credits", "286 credits<br/>left", J],
        ["MillionVerifier", "Checks it is deliverable", "Pay per use<br/>$0.006 a check", "10,408 left<br/>plenty", J],
        ["Firecrawl", "Reads pages that need a browser", "free", "693 pages<br/>left", J],
        ["Tavily", "Finds trade directories", "free", "1,000 a month", J],
        ["Supabase", "The database and the login", "free", "", G],
        ["Vercel", "Hosts the app", "free", "", G],
        ["GitHub", "Holds the code", "free", "", G],
    ],
    [31 * mm, 46 * mm, 24 * mm, 23 * mm, W - 124 * mm],
    mono_cols=(4,),
)

story += [body(
    "<b>$58 a month is the fixed cost</b>, being Apify at $29 and AnymailFinder "
    "at $29. Everything else moves only when you press something. OpenRouter is "
    "the one that varies: about 45&cent; for a typical search, so twenty searches in "
    "a month is roughly $9 on top.")]
story += [body(
    "MillionVerifier is pay-per-use at less than a cent a check, and with 10,408 "
    "credits sitting there it is unlikely ever to need topping up. Firecrawl and "
    "Tavily have not come close to their free allowances.")]

# ── 9. If something looks wrong ────────────────────────────────────────────
story += section(9, "If something looks wrong")
story += table(
    ["What you see", "What it means"],
    [
        ["&ldquo;Not enough credit&rdquo;", "A vendor needs topping up. Settings shows which one."],
        ["&ldquo;Stopped at the time limit&rdquo;", "Normal. Everything found is saved. Press Search again to carry on."],
        ["A search finds very little", "Usually that ground is well covered already. Try another state, or widen the verticals."],
        ["No founder + successor pairs", "Expected on a small search. They occur about once in thirty companies read."],
    ],
    [48 * mm, W - 48 * mm],
)

# ── 10. Questions ──────────────────────────────────────────────────────────
story += section(10, "Questions you are likely to have")
QA = [
    ("How many leads should I expect?",
     "A search reads twenty to sixty companies and typically keeps five to ten. Of those, a confirmed founder-and-successor pair turns up about once in every thirty companies read. So a single search often finds none, and a few searches find several. The good family-owned companies without a named "
     "successor are kept either way, because they are still worth a call."),
    ("Why does it reject so many?",
     "Because searching the web for &ldquo;family landscaping business&rdquo; also "
     "returns funeral homes, trade magazines, associations and software companies. "
     "Those are removed silently. What you see under &ldquo;Not a fit&rdquo; is only the arguable ones: the right sort of company that failed a test. Those you can disagree with."),
    ("Can I trust what it says about a company?",
     "Every confirmed pair carries a sentence from the company's own website and a "
     "link to the page. If the quote does not say what the lead claims, that is a "
     "fault worth reporting. Nothing is included on the strength of a shared surname "
     "or a guess."),
    ("Do I have to run it often?",
     "No, and nothing runs on its own at all. There is no scheduled job and no "
     "background activity. Every cost follows a button you pressed. Leave it a month "
     "and it costs you the $29 Apify subscription and nothing else."),
    ("What if I search the same thing twice?",
     "It goes further rather than repeating itself. Every company already looked at "
     "is remembered and skipped, so a second search of the same trade and state finds "
     "new companies. Your existing leads stay exactly where they are."),
    ("Can I change what it looks for?",
     "Yes, on the search form. The verticals, states, revenue band and signal focus are all set per search, so you can see what this one will do."),
    ("Something is wrong with a lead. What do I do?",
     "Open it, read the quote, and check the source page. If the page supports it and "
     "you still disagree, that is a judgement call worth telling Daniel about. "
     "The rules that decide a lead were built from your own list of accepted and "
     "rejected companies, and they can be adjusted the same way."),
]
for q, a in QA:
    story.append(KeepTogether([subsection(q), body(a)]))

doc.multiBuild(story)
print(f"wrote {OUTPUT}")
