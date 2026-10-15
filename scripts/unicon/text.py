"""Transparent text normalisation for the TF-IDF baseline.

Steps (documented in docs/DATA_METHOD.md):
  1. fold accents/case (ß→ss, ü→u …)
  2. map multilingual legal phrases to shared concept tokens (CONCEPTS), so that
     e.g. "Datenschutz", "data protection" and "protection des données" meet
  3. tokenise, drop stopwords (DE/EN/FR function words + broad legal boilerplate
     such as "recht", "law", "art", "kommentar" that would otherwise link everything)
  4. light suffix stemming; the most frequent surface form is kept for display

This is keyword overlap, not semantic understanding. German compounds that are
not in the concept lexicon stay separate tokens.
"""
from __future__ import annotations

import re
from collections import Counter

from .citation import fold

# concept id -> (English display label, regex on folded text)
CONCEPTS: dict[str, tuple[str, str]] = {
    "c_ai": ("artificial intelligence", r"kunstliche[nr]? intelligenz|artificial intelligence|intelligence artificielle|intelligenza artificiale|\bki\b|\bai\b|\bki vo\b|ai act|machine learning|maschinelles lernen|algorithm\w*"),
    "c_dataprot": ("data protection", r"datenschutz\w*|data protection|protection des donnees|privacy|privatsphare|\bdsg\b|\bdsgvo\b|\bgdpr\b|personendaten|personal data"),
    "c_digital": ("digitalisation", r"digitali\w+|\bdigital\w*|numerique|e government|cyber\w*|plattform\w*|platform\w*|blockchain|krypto\w*|crypto\w*"),
    "c_humanrights": ("human rights", r"menschenrecht\w*|human rights?|droits? de l homme|droits humains|\bemrk\b|\bechr\b|\begmr\b|\becthr\b|grundrecht\w*|fundamental rights?|droits fondamentaux"),
    "c_criminal": ("criminal law", r"strafrecht\w*|criminal law|droit penal|\bstgb\b|strafbar\w*|\bstrafe\w*|criminal\w*|penal\w*"),
    "c_crimproc": ("criminal procedure", r"strafprozess\w*|strafverfahren\w*|criminal procedure|procedure penale|\bstpo\b|strafverteidig\w*|\bbeweis\w*|evidence"),
    "c_migration": ("migration law", r"migration\w*|\basyl\w*|asylum|auslander\w*|aliens|refugee\w*|fluchtling\w*|aufenthalt\w*|einburgerung\w*|citizenship|staatsangehorigkeit"),
    "c_labour": ("labour law", r"arbeitsrecht\w*|arbeitsvertrag\w*|arbeitnehm\w*|arbeitgeb\w*|employment|labou?r law|droit du travail|workers?"),
    "c_socialsec": ("social security", r"sozialversicherung\w*|sozialrecht\w*|social security|social insurance|assurances sociales|invalidenversicherung|\bahv\b|\bbvg\b|\buvg\b|krankenversicherung\w*|sozialhilfe"),
    "c_contract": ("contract law", r"vertragsrecht\w*|\bvertrag\w*|contract\w*|\bcontrat\w*|obligationenrecht"),
    "c_sales": ("international sales (CISG)", r"\bcisg\b|kaufrecht\w*|un kaufrecht|sale of goods|vente internationale"),
    "c_company": ("company law", r"gesellschaftsrecht\w*|aktienrecht\w*|aktiengesellschaft\w*|company law|corporate\w*|droit des societes|personengesellschaft\w*|verwaltungsrat\w*|board of directors|fusion\w*"),
    "c_tax": ("tax law", r"steuer\w*|\btax\w*|fiscal\w*|impot\w*|mehrwertsteuer"),
    "c_environment": ("environment & climate", r"umwelt\w*|environment\w*|klima\w*|climate|nachhaltig\w*|sustainab\w*|energie\w*|energy|raumplanung\w*|forever chemicals|pfas"),
    "c_health": ("health & medical law", r"gesundheit\w*|health\w*|medizin\w*|medical|patient\w*|spital\w*|hospital\w*|arzneimittel\w*|pharma\w*|suizid\w*|sterbe\w*|biomedi\w*|bioeth\w*|transplant\w*|genetic\w*"),
    "c_eu": ("EU law", r"europarecht\w*|europaische[nr]? union|european union|union europeenne|\beu\b|\beuropean law\b|\beugh\b|\bcjeu\b|bilateral\w*"),
    "c_intl": ("international law", r"volkerrecht\w*|international law|droit international|international public law|united nations|vereinte nationen|treaty|treaties|staatsvertrag\w*"),
    "c_const": ("constitutional law", r"verfassung\w*|constitution\w*|bundesverfassung|\bbv\b|demokrat\w*|democra\w*|foderalismus|federalism|volksinitiative|referendum"),
    "c_admin": ("administrative law", r"verwaltungsrecht\w*|verwaltungsverfahren\w*|administrative law|droit administratif|verwaltung\w*|administration|offentliche[ns]? recht\w*|public law"),
    "c_family": ("family law", r"familienrecht\w*|familie\w*|family|kindes\w*|\bkinder\w*|\bchild\w*|scheidung\w*|divorce|\behe\b|\behen\b|marriage|unterhalt\w*|erwachsenenschutz\w*|kesb"),
    "c_succession": ("succession law", r"erbrecht\w*|\berb\w+|succession|inheritance|nachlass\w*|testament\w*|willensvollstrecker"),
    "c_liability": ("liability & tort", r"haftpflicht\w*|haftung\w*|liability|\btorts?\b|schadenersatz\w*|damages|responsabilite civile"),
    "c_competition": ("competition law", r"wettbewerb\w*|competition|kartell\w*|antitrust|concurrence|\bkg\b|beihilfe\w*|state aid"),
    "c_ip": ("intellectual property", r"immaterialguter\w*|intellectual property|propriete intellectuelle|patent\w*|urheberrecht\w*|copyright|\bmarken\w*|trademark\w*|garantiemarke\w*"),
    "c_civproc": ("civil procedure", r"zivilprozess\w*|civil procedure|procedure civile|\bzpo\b|gerichtsverfahren\w*|litigation"),
    "c_arbitration": ("arbitration", r"schiedsgericht\w*|schiedsverfahren\w*|arbitration|arbitrage|arbitral"),
    "c_insolvency": ("debt enforcement & insolvency", r"insolvenz\w*|konkurs\w*|schkg|bankruptcy|insolvency|debt enforcement|schuldbetreibung"),
    "c_finance": ("financial markets & banking", r"finanzmarkt\w*|financial market\w*|\bbank\w*|kapitalmarkt\w*|capital market\w*|finma|geldwasch\w*|money laundering|retrozession\w*"),
    "c_corruption": ("corruption & compliance", r"korruption\w*|corruption|bestechung\w*|bribery|compliance"),
    "c_property": ("property law", r"sachenrecht\w*|eigentum\w*|property|grundbuch\w*|stockwerkeigentum|propriete|immobili\w*|\bmiete\w*|mietrecht\w*|tenancy"),
    "c_trade": ("international economic law", r"welthandel\w*|world trade|\bwto\b|investitionsschutz\w*|investment\w*|economic law|wirtschaftsvolkerrecht|trade law|freihandel\w*"),
    "c_legaltheory": ("legal theory & history", r"rechtsphilosoph\w*|rechtstheorie\w*|legal theory|jurisprudence|rechtsgeschichte\w*|legal history|rechtsvergleich\w*|comparative law|romisch\w*|roman law"),
    "c_ethics": ("ethics", r"ethik\w*|ethic\w*|ethique|moral\w*"),
    "c_animal": ("animal law", r"tierschutz\w*|tierrecht\w*|animal\w*|\btiere?n?\b"),
    "c_sanctions": ("sanctions & sentencing", r"sanktion\w*|sanction\w*|strafzumessung\w*|sentencing|massnahme\w*|strafvollzug\w*|prison\w*|gefangnis\w*"),
    "c_macro": ("macroeconomics", r"macroeconom\w*|makrookonom\w*|monetary polic\w*|geldpolitik\w*|inflation\w*|business cycle\w*|konjunktur\w*"),
    "c_micro": ("microeconomics", r"microeconom\w*|mikrookonom\w*|game theor\w*|spieltheor\w*|consumer choice|konsumentenverhalten"),
    "c_labourecon": ("labour economics", r"labou?r econom\w*|arbeitsmarkt\w*|wage\w*|lohne?\w*|unemployment|arbeitslos\w*|human capital"),
    "c_development": ("development economics", r"development econom\w*|entwicklungsokonom\w*|economic development|poverty|armut\w*|low income countr\w*"),
    "c_behavioral": ("behavioural economics", r"behavio\w+ econom\w*|verhaltensokonom\w*|decision making|entscheidungsverhalten|experiment\w* econom\w*"),
    "c_econometrics": ("econometrics & causal inference", r"econometric\w*|okonometr\w*|causal inference|kausale inferenz|difference in differences|instrumental variable\w*|regression discontinuity"),
    "c_publicecon": ("public economics", r"public econom\w*|finanzwissenschaft\w*|public finance|fiscal polic\w*|offentliche finanzen|taxation"),
    "c_innovation": ("innovation & entrepreneurship", r"innovation\w*|entrepreneur\w*|unternehmertum|startup\w*|start up\w*|technological change"),
    "c_management": ("management & organisations", r"management\w*|organization\w*|organisation\w*|leadership|fuhrung\w*|strategy|strategi\w*|governance"),
    "c_accounting": ("accounting & corporate finance", r"accounting|rechnungslegung\w*|corporate finance|unternehmensfinanzierung|audit\w*|financial reporting"),
    "c_tradeecon": ("international economics", r"international econom\w*|trade\w*|handel\w*|globali\w*|exchange rate\w*|wechselkurs\w*|foreign direct investment"),
}
_COMPILED = [(cid, re.compile(rx)) for cid, (_label, rx) in CONCEPTS.items()]

STOPWORDS = set("""
a ab aber about across after against all allem allen aller alles als also am an and andere anderen ans any are as at auch auf aus aux avec bei beim between bis both but by can da dans das dass de dem den der des di die dies diese diesem diesen dieser dieses do does du durch e ein eine einem einen einer eines el en entre es et for from fur gegen hat i ihr ihre im in into is ist it its kann la le les mit nach neue neuen new nicht no not o ob oder of on or ou par pour sein seine sich sind so sous such sur than that the their them there these this those to uber um un und une unter vom von vor was we welche were what when which while who will with zu zum zur zwischen la los las del il dei della per che
recht rechts rechte rechtliche rechtlichen rechtlicher law laws legal droit diritto juristische juristischen
rezension rezensionen besprechung besprechungen anmerkung anmerkungen review reviews buchbesprechung note notes case cases
artt supreme court courts gericht gerichts federal hauptteil werden wird wurde fall falle report rapport bger bvger
kammer abteilung kantons kanton kantonsgericht kantonsgerichts artikel jahrbuch umfeld decision decisions comment comments private
januar februar marz april mai juni juli august september oktober november dezember january february march june july october december
under within towards allgemeine allgemeinen schweizerisches global article articles provision provisions zivil blick jahre jahr jahren keine kein grenzen munchen zurich bern geneve stadt tubingen berlin wien
rechtsprechung jurisprudenz praxis practice zeitschrift journal beitrag beitrage contribution
art arts abs ziff lit kommentar kommentierung kommentare commentaire commentary commentario einleitung vorbemerkungen vorbemerkung bemerkungen introduction
schweiz schweizer schweizerische schweizerischen schweizerischer swiss suisse svizzera switzerland
bund bundes bundesgesetz bundesgesetzes gesetz gesetzes act bundesgericht bundesgerichts bundesgerichtes entscheid entscheide urteil urteils urteile bge
basel basler band bd vol aufl auflage edition edn ed eds hrsg festschrift fur liber amicorum
teil part chapter kapitel ii iii iv vi vii viii ix x xi xii
aktuelle aktuellen current issues fragen frage question questions perspektive perspektiven perspective perspectives
neue neuen neues recent reform reformen developments entwicklung entwicklungen overview uberblick
im sinne sowie insbesondere bzw ua etc vgl siehe
""".split())

TOKEN_RE = re.compile(r"[a-z][a-z0-9]{2,}")


def stem(tok: str) -> str:
    if tok.startswith("c_"):
        return tok
    for suf in ("ungen", "ischen", "ischer", "lichen", "licher", "ations", "en", "er", "es", "e", "s"):
        if tok.endswith(suf) and len(tok) - len(suf) >= 4:
            return tok[: -len(suf)]
    return tok


def concept_label(cid: str) -> str:
    return CONCEPTS[cid][0]


def analyse(text: str) -> tuple[list[str], dict[str, Counter]]:
    """Return stemmed tokens (concepts included) and stem -> surface-form counts.

    Raw words that a matched concept already covers (e.g. "datenschutz" when the
    data-protection concept fired) are dropped so one idea is not counted twice."""
    f = fold(text)
    tokens: list[str] = []
    surfaces: dict[str, Counter] = {}
    hit_rx = []
    for cid, rx in _COMPILED:
        hits = rx.findall(f)
        if hits:
            tokens.extend([cid] * min(len(hits), 2))
            hit_rx.append(rx)
    for t in TOKEN_RE.findall(f):
        if t in STOPWORDS or t.isdigit() or re.fullmatch(r"\d+\w?", t):
            continue
        # a word already represented by a concept found in this text is not counted twice
        if any(rx.fullmatch(t) for rx in hit_rx):
            continue
        s = stem(t)
        if s in STOPWORDS or len(s) < 4:
            continue
        tokens.append(s)
        surfaces.setdefault(s, Counter())[t] += 1
    return tokens, surfaces


def detect_language(text: str) -> str | None:
    """Tiny function-word vote; returns ISO 639-1 or None when unclear (labelled heuristic)."""
    words = re.findall(r"[a-zäöüéèàß]+", text.lower())
    if len(words) < 4:
        return None
    votes = {
        "de": sum(w in {"der", "die", "das", "und", "im", "zur", "zum", "des", "von", "mit", "für", "bei", "einer", "eine", "ein", "auf", "über"} for w in words),
        "en": sum(w in {"the", "of", "and", "in", "for", "on", "to", "a", "an", "with", "between", "towards"} for w in words),
        "fr": sum(w in {"le", "la", "les", "des", "du", "et", "en", "pour", "dans", "sur", "une", "un", "au", "aux"} for w in words),
        "it": sum(w in {"il", "della", "delle", "dei", "e", "per", "nel", "nella", "una", "sul"} for w in words),
    }
    best = max(votes, key=votes.get)
    ranked = sorted(votes.values(), reverse=True)
    if ranked[0] == 0 or ranked[0] == ranked[1]:
        return None
    return best
