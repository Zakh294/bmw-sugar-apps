"""The countries SpeedCam offers camera packs for: code, ISO 3166-1, names, group, units, legal mode.

legal (what the app does there by default; the owner may still switch warnings on where they are off):
    ok      warnings as everywhere
    banned  a warning system for fixed cameras is not allowed while driving: off by default
            DE: StVO § 23 (1c), fine EUR 75 and a point, also when a passenger's phone warns (OLG Karlsruhe 2023)
            CH, LI: the use of any warning device is prohibited; CY, MK: TomTom does not offer warnings there
    zones   only a "danger zone" may be announced, never the camera's place (FR)
This is a summary for defaults, not legal advice: the owner checks the law of the country he drives in.
See docs/LEGAL.md.
"""

# code: (ISO, native name, English name, Ukrainian name, group, units, legal)
EUROPE = [
    ('at', 'AT', 'Österreich', 'Austria', 'Австрія', 'kmh', 'ok'),
    ('be', 'BE', 'België / Belgique', 'Belgium', 'Бельгія', 'kmh', 'ok'),
    ('bg', 'BG', 'България', 'Bulgaria', 'Болгарія', 'kmh', 'ok'),
    ('hr', 'HR', 'Hrvatska', 'Croatia', 'Хорватія', 'kmh', 'ok'),
    ('cy', 'CY', 'Κύπρος', 'Cyprus', 'Кіпр', 'kmh', 'banned'),
    ('cz', 'CZ', 'Česko', 'Czechia', 'Чехія', 'kmh', 'ok'),
    ('dk', 'DK', 'Danmark', 'Denmark', 'Данія', 'kmh', 'ok'),
    ('ee', 'EE', 'Eesti', 'Estonia', 'Естонія', 'kmh', 'ok'),
    ('fi', 'FI', 'Suomi', 'Finland', 'Фінляндія', 'kmh', 'ok'),
    ('fr', 'FR', 'France', 'France', 'Франція', 'kmh', 'zones'),
    ('de', 'DE', 'Deutschland', 'Germany', 'Німеччина', 'kmh', 'banned'),
    ('gr', 'GR', 'Ελλάδα', 'Greece', 'Греція', 'kmh', 'ok'),
    ('hu', 'HU', 'Magyarország', 'Hungary', 'Угорщина', 'kmh', 'ok'),
    ('ie', 'IE', 'Éire / Ireland', 'Ireland', 'Ірландія', 'kmh', 'ok'),
    ('it', 'IT', 'Italia', 'Italy', 'Італія', 'kmh', 'ok'),
    ('lv', 'LV', 'Latvija', 'Latvia', 'Латвія', 'kmh', 'ok'),
    ('lt', 'LT', 'Lietuva', 'Lithuania', 'Литва', 'kmh', 'ok'),
    ('lu', 'LU', 'Lëtzebuerg', 'Luxembourg', 'Люксембург', 'kmh', 'ok'),
    ('mt', 'MT', 'Malta', 'Malta', 'Мальта', 'kmh', 'ok'),
    ('nl', 'NL', 'Nederland', 'Netherlands', 'Нідерланди', 'kmh', 'ok'),
    ('pl', 'PL', 'Polska', 'Poland', 'Польща', 'kmh', 'ok'),
    ('pt', 'PT', 'Portugal', 'Portugal', 'Португалія', 'kmh', 'ok'),
    ('ro', 'RO', 'România', 'Romania', 'Румунія', 'kmh', 'ok'),
    ('sk', 'SK', 'Slovensko', 'Slovakia', 'Словаччина', 'kmh', 'ok'),
    ('si', 'SI', 'Slovenija', 'Slovenia', 'Словенія', 'kmh', 'ok'),
    ('es', 'ES', 'España', 'Spain', 'Іспанія', 'kmh', 'ok'),
    ('se', 'SE', 'Sverige', 'Sweden', 'Швеція', 'kmh', 'ok'),
    ('gb', 'GB', 'United Kingdom', 'United Kingdom', 'Велика Британія', 'mph', 'ok'),
    ('no', 'NO', 'Norge', 'Norway', 'Норвегія', 'kmh', 'ok'),
    ('is', 'IS', 'Ísland', 'Iceland', 'Ісландія', 'kmh', 'ok'),
    ('ch', 'CH', 'Schweiz / Suisse', 'Switzerland', 'Швейцарія', 'kmh', 'banned'),
    ('li', 'LI', 'Liechtenstein', 'Liechtenstein', 'Ліхтенштейн', 'kmh', 'banned'),
    ('ad', 'AD', 'Andorra', 'Andorra', 'Андорра', 'kmh', 'ok'),
    ('mc', 'MC', 'Monaco', 'Monaco', 'Монако', 'kmh', 'ok'),
    ('sm', 'SM', 'San Marino', 'San Marino', 'Сан-Марино', 'kmh', 'ok'),
    ('md', 'MD', 'Moldova', 'Moldova', 'Молдова', 'kmh', 'ok'),
    ('rs', 'RS', 'Srbija', 'Serbia', 'Сербія', 'kmh', 'ok'),
    ('ba', 'BA', 'Bosna i Hercegovina', 'Bosnia and Herzegovina', 'Боснія і Герцеговина', 'kmh', 'ok'),
    ('me', 'ME', 'Crna Gora', 'Montenegro', 'Чорногорія', 'kmh', 'ok'),
    ('mk', 'MK', 'Северна Македонија', 'North Macedonia', 'Північна Македонія', 'kmh', 'banned'),
    ('al', 'AL', 'Shqipëria', 'Albania', 'Албанія', 'kmh', 'ok'),
    ('xk', 'XK', 'Kosova', 'Kosovo', 'Косово', 'kmh', 'ok'),
]

US_STATES = [
    ('AL', 'Alabama'), ('AK', 'Alaska'), ('AZ', 'Arizona'), ('AR', 'Arkansas'), ('CA', 'California'),
    ('CO', 'Colorado'), ('CT', 'Connecticut'), ('DE', 'Delaware'), ('DC', 'District of Columbia'), ('FL', 'Florida'),
    ('GA', 'Georgia'), ('HI', 'Hawaii'), ('ID', 'Idaho'), ('IL', 'Illinois'), ('IN', 'Indiana'), ('IA', 'Iowa'),
    ('KS', 'Kansas'), ('KY', 'Kentucky'), ('LA', 'Louisiana'), ('ME', 'Maine'), ('MD', 'Maryland'),
    ('MA', 'Massachusetts'), ('MI', 'Michigan'), ('MN', 'Minnesota'), ('MS', 'Mississippi'), ('MO', 'Missouri'),
    ('MT', 'Montana'), ('NE', 'Nebraska'), ('NV', 'Nevada'), ('NH', 'New Hampshire'), ('NJ', 'New Jersey'),
    ('NM', 'New Mexico'), ('NY', 'New York'), ('NC', 'North Carolina'), ('ND', 'North Dakota'), ('OH', 'Ohio'),
    ('OK', 'Oklahoma'), ('OR', 'Oregon'), ('PA', 'Pennsylvania'), ('RI', 'Rhode Island'), ('SC', 'South Carolina'),
    ('SD', 'South Dakota'), ('TN', 'Tennessee'), ('TX', 'Texas'), ('UT', 'Utah'), ('VT', 'Vermont'),
    ('VA', 'Virginia'), ('WA', 'Washington'), ('WV', 'West Virginia'), ('WI', 'Wisconsin'), ('WY', 'Wyoming'),
]


def all_packs():
    """[{code, iso, name, en, uk, group, units, legal}] in the order the app lists them."""
    out = [{'code': 'ua', 'iso': 'UA', 'name': 'Україна', 'en': 'Ukraine', 'uk': 'Україна', 'group': 'ua',
            'units': 'kmh', 'legal': 'ok'}]
    for code, iso, native, en, uk, units, legal in sorted(EUROPE, key=lambda r: r[3]):
        out.append({'code': code, 'iso': iso, 'name': native, 'en': en, 'uk': uk, 'group': 'eu', 'units': units, 'legal': legal})
    for st, name in US_STATES:
        out.append({'code': 'us-' + st.lower(), 'iso': 'US-' + st, 'name': name, 'en': name, 'uk': name, 'group': 'us',
                    'units': 'mph', 'legal': 'ok'})
    return out
