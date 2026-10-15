"""Parse UNIverse CSL bibliography strings (Harvard / "cite them right" style).

The listing exposes only a rendered citation per record, so every structured
field here is an *extraction* and carries parse warnings. The original string
is always kept next to the parsed result.
"""
from __future__ import annotations

import html
import re
import unicodedata
from dataclasses import dataclass, field

ITALIC_OPEN = "\u0001"
ITALIC_CLOSE = "\u0002"

YEAR_RE = re.compile(r"\((\d{4})[a-z]?\)|\((n\.d\.|no date|o\.J\.)\)")
DOI_RE = re.compile(r"\b(10\.\d{4,9}/[^\s\"<>]+)", re.I)
ED_RE = re.compile(r"\s*\((?:eds?\.?|hrsg\.?|ed\.\s*by|editors?)\)\s*$", re.I)
COMMENTARY_RE = re.compile(
    r"komment|kommentar|commentaire|commentary|commentario|handkommentar|praxiskommentar|"
    r"basler kommentar|berner kommentar|zürcher kommentar|kurzkommentar|"
    r"\bCR\b|\bBSK\b|\bOFK\b|\bCHK\b",
    re.I,
)
THESIS_RE = re.compile(r"(doctoral|postdoctoral|master'?s?|bachelor'?s?|phd)\s+thesis|dissertation|habilitation", re.I)
INITIALS_RE = re.compile(r"^(?:[A-ZÄÖÜÀ-Ý][a-zà-ÿ]?\.\s*-?\s*)+$")
PARTICLES = {"van", "von", "de", "der", "den", "di", "da", "du", "del", "della", "le", "la", "zu", "ten", "ter"}


@dataclass
class ParsedName:
    raw: str
    family: str
    given: str
    form: str  # "family-given" | "literal"
    initials_only: bool = False

    @property
    def display(self) -> str:
        return f"{self.given} {self.family}".strip()


@dataclass
class ParsedCitation:
    raw_text: str
    authors: list[ParsedName] = field(default_factory=list)
    et_al: bool = False
    editor_role: bool = False
    year: int | None = None
    title: str | None = None
    container: str | None = None
    publication_type: str = "Other"
    doi: str | None = None
    warnings: list[str] = field(default_factory=list)


def fold(s: str) -> str:
    """Lowercase, strip accents and punctuation — used for keys, never for display."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.replace("ß", "ss").lower()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def html_to_marked_text(fragment: str) -> str:
    s = re.sub(r'<span[^>]*font-style:\s*italic[^>]*>', ITALIC_OPEN, fragment)
    # close the italic marker at the first </span> after an opener; nested spans are not used by CSL here
    out, depth = [], 0
    for tok in re.split(r"(\u0001|</span>|<[^>]+>)", s):
        if tok == ITALIC_OPEN:
            depth += 1
            out.append(ITALIC_OPEN)
        elif tok == "</span>":
            if depth:
                depth -= 1
                out.append(ITALIC_CLOSE)
        elif tok.startswith("<") and tok.endswith(">"):
            continue
        else:
            out.append(tok)
    text = html.unescape("".join(out))
    text = text.replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip()


def strip_marks(s: str) -> str:
    return s.replace(ITALIC_OPEN, "").replace(ITALIC_CLOSE, "")


def clean_doi(urls: dict, text: str) -> tuple[str | None, list[str]]:
    warnings = []
    candidates = []
    if urls.get("DOI"):
        candidates.append(urls["DOI"])
    m = re.search(r"https?://doi\.org/(\S+)", text)
    if m:
        candidates.append(m.group(0))
    for cand in candidates:
        cand = html.unescape(cand).strip().rstrip(".")
        dm = DOI_RE.search(cand)
        if dm:
            doi = dm.group(1).rstrip(".,;)")
            return doi.lower(), warnings
        warnings.append(f"DOI field is not a DOI: {cand[:120]}")
    return None, warnings


def _parse_single(token: str) -> ParsedName:
    token = token.strip()
    parts = token.split()
    if len(parts) == 1:
        return ParsedName(token, family=token, given="", form="literal")
    # literal "Given Family" (possibly "Given van Family")
    i = len(parts) - 1
    while i > 1 and parts[i - 1].lower() in PARTICLES:
        i -= 1
    return ParsedName(token, family=" ".join(parts[i:]), given=" ".join(parts[:i]), form="literal")


def _looks_given(token: str) -> bool:
    """A 'given' slot: initials or 1–3 capitalised words, no digits."""
    t = token.strip()
    if not t or re.search(r"\d", t):
        return False
    words = t.split()
    return 1 <= len(words) <= 4 and all(w[0].isupper() or w.lower() in PARTICLES for w in words if w)


def parse_authors(segment: str) -> tuple[list[ParsedName], bool, bool, list[str]]:
    warnings: list[str] = []
    seg = segment.strip().rstrip(",")
    et_al = False
    if re.search(r"\bet al\.?$", seg):
        et_al = True
        seg = re.sub(r",?\s*\bet al\.?$", "", seg).strip()
    editor = False
    if ED_RE.search(seg):
        editor = True
        seg = ED_RE.sub("", seg).strip()
    if not seg:
        return [], et_al, editor, ["no author segment"]
    if " and " in seg:
        head, last = seg.rsplit(" and ", 1)
        last_tokens = [t.strip() for t in last.split(", ") if t.strip()]
    else:
        head, last_tokens = seg, []
    head_tokens = [t.strip() for t in head.split(", ") if t.strip()]

    names: list[ParsedName] = []

    def pair_up(tokens: list[str]) -> list[ParsedName] | None:
        """Pair tokens as (family, given). CSL renders a name either as "Family, Given"
        (two comma tokens) or as one literal token, so an odd token count means exactly
        one literal; it is assumed to be the first multi-word token. Returns None when
        no consistent segmentation exists."""
        res: list[ParsedName] = []
        i = 0
        while i < len(tokens):
            remaining = len(tokens) - i
            tok = tokens[i]
            if remaining % 2 == 1 and (len(tok.split()) >= 2 or remaining == 1):
                res.append(_parse_single(tok))
                i += 1
                continue
            if remaining < 2 or not _looks_given(tokens[i + 1]):
                return None
            given = tokens[i + 1]
            res.append(ParsedName(f"{tok}, {given}", family=tok, given=given, form="family-given",
                                  initials_only=bool(INITIALS_RE.match(given))))
            i += 2
        return res

    parsed_head = pair_up(head_tokens) if head_tokens else []
    if parsed_head is None:
        parsed_head = [_parse_single(t) for t in head_tokens]
        warnings.append("ambiguous author segmentation")
    names.extend(parsed_head)
    if last_tokens:
        if len(last_tokens) == 2 and _looks_given(last_tokens[1]):
            g = last_tokens[1]
            names.append(ParsedName(f"{last_tokens[0]}, {g}", family=last_tokens[0], given=g,
                                    form="family-given", initials_only=bool(INITIALS_RE.match(g))))
        elif len(last_tokens) == 1:
            names.append(_parse_single(last_tokens[0]))
        else:
            warnings.append("ambiguous final author")
            names.extend(_parse_single(t) for t in last_tokens)
    if any(n.form == "literal" and " " in n.raw for n in names):
        warnings.append("name order inferred for literal name(s)")
    if any(n.initials_only for n in names):
        warnings.append("initials-only given name(s)")
    return names, et_al, editor, warnings


def parse_citation(bibliography_html: str, urls: dict | None = None) -> ParsedCitation:
    urls = urls or {}
    marked = html_to_marked_text(bibliography_html)
    text = strip_marks(marked)
    pc = ParsedCitation(raw_text=text)
    pc.doi, w = clean_doi(urls, text)
    pc.warnings.extend(w)

    ym = YEAR_RE.search(marked)
    if not ym:
        pc.warnings.append("no year found")
        authors_seg, rest = "", marked
    else:
        if ym.group(1):
            pc.year = int(ym.group(1))
        else:
            pc.warnings.append("citation has no date")
        authors_seg, rest = marked[: ym.start()], marked[ym.end():].strip()

    if authors_seg.strip():
        names, et_al, editor, w = parse_authors(strip_marks(authors_seg))
        pc.authors, pc.et_al, pc.editor_role = names, et_al, editor
        pc.warnings.extend(w)
    else:
        pc.warnings.append("no authors parsed")

    rest_plain = strip_marks(rest)
    if rest.startswith("‘") or rest.startswith("'"):
        m = re.match(r"^[‘'](.+?)[’'](?=,|\.|\s*$|\s)", rest)
        if m:
            pc.title = strip_marks(m.group(1)).strip()
            after = rest[m.end():].lstrip(",. ")
            cm = re.search(ITALIC_OPEN + r"(.+?)" + ITALIC_CLOSE, after)
            pc.container = cm.group(1).strip() if cm else None
            is_in = after.startswith("in ")
            if THESIS_RE.search(after):
                pc.publication_type = "Thesis"
            elif is_in and pc.container and COMMENTARY_RE.search(pc.container + " " + (pc.title or "")):
                pc.publication_type = "Commentary contribution"
            elif is_in:
                pc.publication_type = "Book chapter"
            elif pc.container:
                pc.publication_type = "Journal article"
            else:
                pc.publication_type = "Other"
        else:
            pc.warnings.append("quoted title not closed")
    elif rest.startswith(ITALIC_OPEN):
        m = re.match(ITALIC_OPEN + r"(.+?)" + ITALIC_CLOSE, rest)
        if m:
            pc.title = m.group(1).strip().rstrip(".")
            after = rest_plain[len(strip_marks(m.group(0))):]
            if THESIS_RE.search(after):
                pc.publication_type = "Thesis"
            elif COMMENTARY_RE.search(pc.title):
                pc.publication_type = "Commentary contribution"
            else:
                pc.publication_type = "Book"
    if not pc.title:
        # fall back to the first sentence-like chunk so the record stays readable
        chunk = re.split(r"\.\s", rest_plain, maxsplit=1)[0].strip(" .‘’'")
        pc.title = chunk or None
        pc.warnings.append("title extracted by fallback")
    if pc.title:
        pc.title = re.sub(r"\s+", " ", pc.title).strip()
    return pc
