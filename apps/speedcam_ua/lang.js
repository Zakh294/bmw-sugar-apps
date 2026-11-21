'use strict';
/**
 * lang.js - the app's languages: Ukrainian, English, German, Polish, French, Italian, Spanish, Czech.
 *
 *   const L = lang.make('de');  L('nearest')  L('in_dist', { d: '300 m', l: 50, label: 'A4' })
 *   lang.settings(schema, 'pl')                 the settings' labels and choices in that language (in place)
 *   lang.forCountry('at')                       'de': "automatic" picks the language of the country the car is in
 *
 * A missing text falls back to English, then to the key. {name} is replaced from the values. Plain Node 8.
 */
const LANGS = ['uk', 'en', 'de', 'pl', 'fr', 'it', 'es', 'cs'];
const NATIVE = { uk: 'Українська', en: 'English', de: 'Deutsch', pl: 'Polski', fr: 'Français', it: 'Italiano', es: 'Español', cs: 'Čeština' };

// [uk, en, de, pl, fr, it, es, cs]
const T = {
    // units
    m: ['м', 'm', 'm', 'm', 'm', 'm', 'm', 'm'],
    km: ['км', 'km', 'km', 'km', 'km', 'km', 'km', 'km'],
    kmh: ['км/год', 'km/h', 'km/h', 'km/h', 'km/h', 'km/h', 'km/h', 'km/h'],
    mph: ['миль/год', 'mph', 'mph', 'mph', 'mph', 'mph', 'mph', 'mph'],
    ft: ['фт', 'ft', 'ft', 'ft', 'ft', 'ft', 'ft', 'ft'],
    mi: ['миль', 'mi', 'mi', 'mi', 'mi', 'mi', 'mi', 'mi'],
    // the warning
    camera: ['КАМЕРА', 'CAMERA', 'BLITZER', 'FOTORADAR', 'RADAR', 'AUTOVELOX', 'RADAR', 'RADAR'],
    zone: ['ЗОНА КОНТРОЛЮ', 'CONTROL ZONE', 'KONTROLLZONE', 'STREFA KONTROLI', 'ZONE DE DANGER', 'ZONA DI CONTROLLO', 'ZONA DE CONTROL', 'ZÓNA KONTROLY'],
    zone_hint: ['контроль швидкості попереду', 'speed checks ahead', 'Geschwindigkeitskontrollen voraus', 'kontrola prędkości przed tobą', 'contrôles de vitesse', 'controlli di velocità', 'controles de velocidad', 'kontrola rychlosti vpředu'],
    test_label: ['Тест: Львів, вул. Городоцька, 120', 'Test: Lviv, Horodotska St 120', 'Test: Lwiw, Horodozka-Str. 120', 'Test: Lwów, ul. Horodocka 120', 'Test : Lviv, rue Horodotska 120', 'Test: Leopoli, via Horodotska 120', 'Prueba: Leópolis, c. Horodotska 120', 'Test: Lvov, ul. Horodocka 120'],
    // the page
    cams_info: ['{n} камер · {packs}', '{n} cameras · {packs}', '{n} Blitzer · {packs}', '{n} fotoradarów · {packs}', '{n} radars · {packs}', '{n} autovelox · {packs}', '{n} radares · {packs}', '{n} radarů · {packs}'],
    position: ['ПОЗИЦІЯ', 'POSITION', 'POSITION', 'POZYCJA', 'POSITION', 'POSIZIONE', 'POSICIÓN', 'POZICE'],
    speed: ['ШВИДКІСТЬ', 'SPEED', 'TEMPO', 'PRĘDKOŚĆ', 'VITESSE', 'VELOCITÀ', 'VELOCIDAD', 'RYCHLOST'],
    nearest: ['НАЙБЛИЖЧА', 'NEAREST', 'NÄCHSTER', 'NAJBLIŻSZY', 'LE PLUS PROCHE', 'PIÙ VICINO', 'MÁS CERCANO', 'NEJBLIŽŠÍ'],
    camera_row: ['КАМЕРА', 'CAMERA', 'BLITZER', 'FOTORADAR', 'RADAR', 'AUTOVELOX', 'RADAR', 'RADAR'],
    screens: ['ЕКРАНИ', 'SCREENS', 'ANZEIGEN', 'EKRANY', 'ÉCRANS', 'SCHERMI', 'PANTALLAS', 'DISPLEJE'],
    gps_sources: ['ДЖЕРЕЛА GPS НА БЛОЦІ', 'GPS SOURCES ON THE UNIT', 'GPS-QUELLEN IM GERÄT', 'ŹRÓDŁA GPS W JEDNOSTCE', 'SOURCES GPS DE L\'UNITÉ', 'SORGENTI GPS DELL\'UNITÀ', 'FUENTES GPS DE LA UNIDAD', 'ZDROJE GPS V JEDNOTCE'],
    found_on: ['знайдено {d}', 'found {d}', 'gefunden {d}', 'znaleziono {d}', 'trouvées le {d}', 'trovate il {d}', 'halladas el {d}', 'nalezeno {d}'],
    sound: ['ЗВУК', 'SOUND', 'TON', 'DŹWIĘK', 'SON', 'SUONO', 'SONIDO', 'ZVUK'],
    databases: ['БАЗИ', 'DATABASES', 'DATENBANKEN', 'BAZY', 'BASES', 'DATABASE', 'BASES', 'DATABÁZE'],
    from_src: ['з {src}', 'from {src}', 'aus {src}', 'z {src}', 'de {src}', 'da {src}', 'de {src}', 'z {src}'],
    heading: ['курс {deg}°', 'heading {deg}°', 'Kurs {deg}°', 'kurs {deg}°', 'cap {deg}°', 'rotta {deg}°', 'rumbo {deg}°', 'kurz {deg}°'],
    heading_wait: ['курс: проїдьте трохи', 'heading: drive a little', 'Kurs: ein Stück fahren', 'kurs: przejedź kawałek', 'cap : roulez un peu', 'rotta: guida un po\'', 'rumbo: avance un poco', 'kurz: popojeďte kousek'],
    no_gps: ['GPS-джерело не знайдено на цьому блоці', 'no GPS source found on this unit', 'keine GPS-Quelle in diesem Gerät', 'nie znaleziono źródła GPS', 'aucune source GPS trouvée', 'nessuna sorgente GPS trovata', 'no se encontró fuente GPS', 'zdroj GPS nenalezen'],
    see_docs: ['див. docs/speedcam_ua: find_position.js', 'see docs: find_position.js', 'siehe Doku: find_position.js', 'zob. dokumentację: find_position.js', 'voir la doc : find_position.js', 'vedi la documentazione: find_position.js', 'ver la documentación: find_position.js', 'viz dokumentaci: find_position.js'],
    waiting_nav: ['чекаю на навігацію (джерел: {n})', 'waiting for the navigation ({n} sources)', 'warte auf die Navigation ({n} Quellen)', 'czekam na nawigację (źródeł: {n})', 'attente de la navigation ({n} sources)', 'attendo la navigazione ({n} sorgenti)', 'esperando la navegación ({n} fuentes)', 'čekám na navigaci ({n} zdrojů)'],
    test_look: ['тест: дивіться на HUD і приладку', 'test: look at the HUD and the cluster', 'Test: auf HUD und Kombiinstrument schauen', 'test: spójrz na HUD i zegary', 'test : regardez le HUD et le combiné', 'test: guarda HUD e quadro strumenti', 'prueba: mire el HUD y el cuadro', 'test: podívejte se na HUD a přístroje'],
    in_dist: ['через {d}, ліміт {l} · {label}', 'in {d}, limit {l} · {label}', 'in {d}, Limit {l} · {label}', 'za {d}, limit {l} · {label}', 'dans {d}, limite {l} · {label}', 'tra {d}, limite {l} · {label}', 'a {d}, límite {l} · {label}', 'za {d}, limit {l} · {label}'],
    in_zone: ['зона контролю · {label}', 'control zone · {label}', 'Kontrollzone · {label}', 'strefa kontroli · {label}', 'zone de danger · {label}', 'zona di controllo · {label}', 'zona de control · {label}', 'zóna kontroly · {label}'],
    none_near: ['немає поруч (за поїздку: {n})', 'none nearby ({n} this drive)', 'keiner in der Nähe ({n} auf dieser Fahrt)', 'brak w pobliżu (w tej jeździe: {n})', 'aucun à proximité ({n} ce trajet)', 'nessuno vicino ({n} in questo viaggio)', 'ninguno cerca ({n} en este viaje)', 'žádný poblíž (za jízdu: {n})'],
    disabled: ['попередження вимкнені (Налаштування)', 'warnings are off (Settings)', 'Warnungen aus (Einstellungen)', 'ostrzeżenia wyłączone (Ustawienia)', 'alertes désactivées (Réglages)', 'avvisi disattivati (Impostazioni)', 'avisos desactivados (Ajustes)', 'varování vypnuta (Nastavení)'],
    banned_here: ['{country}: попередження вимкнені, бо там вони заборонені (Налаштування)', '{country}: warnings off, not allowed there (Settings)', '{country}: Warnungen aus, dort nicht erlaubt (Einstellungen)', '{country}: ostrzeżenia wyłączone, tam zabronione (Ustawienia)', '{country} : alertes désactivées, interdites là-bas (Réglages)', '{country}: avvisi disattivati, lì vietati (Impostazioni)', '{country}: avisos desactivados, allí prohibidos (Ajustes)', '{country}: varování vypnuta, tam zakázána (Nastavení)'],
    cr_ok: ['cluster-render підключено', 'cluster-render connected', 'cluster-render verbunden', 'cluster-render połączony', 'cluster-render connecté', 'cluster-render collegato', 'cluster-render conectado', 'cluster-render připojen'],
    cr_missing: ['cluster-render недоступний (встановіть зі Store)', 'cluster-render missing (install it from the Store)', 'cluster-render fehlt (aus dem Store installieren)', 'brak cluster-render (zainstaluj ze Store)', 'cluster-render absent (installez-le depuis le Store)', 'cluster-render mancante (installalo dallo Store)', 'falta cluster-render (instálelo desde la Store)', 'cluster-render chybí (nainstalujte ze Store)'],
    phone_map: ['мапа телефона на приладці', 'phone map on the cluster', 'Handykarte im Kombiinstrument', 'mapa telefonu na zegarach', 'carte du téléphone au combiné', 'mappa del telefono sul quadro', 'mapa del teléfono en el cuadro', 'mapa telefonu na přístrojích'],
    banner_in_map: [': банер у мапі', ': banner in the map', ': Banner in der Karte', ': baner w mapie', ' : bandeau dans la carte', ': banner nella mappa', ': banner en el mapa', ': banner v mapě'],
    no_phone_map: ['мапи телефона на приладці немає', 'no phone map on the cluster', 'keine Handykarte im Kombiinstrument', 'brak mapy telefonu na zegarach', 'pas de carte du téléphone au combiné', 'nessuna mappa del telefono sul quadro', 'sin mapa del teléfono en el cuadro', 'mapa telefonu na přístrojích není'],
    now: ['щойно', 'just now', 'gerade eben', 'przed chwilą', 'à l\'instant', 'adesso', 'ahora', 'právě teď'],
    s_ago: ['{n} с тому', '{n} s ago', 'vor {n} s', '{n} s temu', 'il y a {n} s', '{n} s fa', 'hace {n} s', 'před {n} s'],
    min_ago: ['{n} хв тому', '{n} min ago', 'vor {n} min', '{n} min temu', 'il y a {n} min', '{n} min fa', 'hace {n} min', 'před {n} min'],
    fixes: ['{n} фіксів, {scale}, {age}', '{n} fixes, {scale}, {age}', '{n} Fixe, {scale}, {age}', '{n} pozycji, {scale}, {age}', '{n} positions, {scale}, {age}', '{n} fix, {scale}, {age}', '{n} posiciones, {scale}, {age}', '{n} poloh, {scale}, {age}'],
    no_coords: ['{n} значень без координат', '{n} values without coordinates', '{n} Werte ohne Koordinaten', '{n} wartości bez współrzędnych', '{n} valeurs sans coordonnées', '{n} valori senza coordinate', '{n} valores sin coordenadas', '{n} hodnot bez souřadnic'],
    nothing_yet: ['ще нічого', 'nothing yet', 'noch nichts', 'jeszcze nic', 'rien encore', 'ancora niente', 'nada aún', 'zatím nic'],
    error: ['помилка: {e}', 'error: {e}', 'Fehler: {e}', 'błąd: {e}', 'erreur : {e}', 'errore: {e}', 'error: {e}', 'chyba: {e}'],
    chime_sent: ['сигнал надіслано', 'chime sent', 'Ton gesendet', 'sygnał wysłany', 'signal envoyé', 'segnale inviato', 'señal enviada', 'signál odeslán'],
    chime_failed: ['сигнал не пройшов', 'chime failed', 'Ton fehlgeschlagen', 'sygnał nie przeszedł', 'signal échoué', 'segnale non riuscito', 'la señal falló', 'signál selhal'],
    chime_playing: ['грає…', 'playing…', 'spielt…', 'gra…', 'lecture…', 'in riproduzione…', 'sonando…', 'hraje…'],
    details_audio: ['деталі: «Діагностика»', 'details: "Diagnostics"', 'Details: „Diagnose“', 'szczegóły: „Diagnostyka”', 'détails : « Diagnostic »', 'dettagli: «Diagnostica»', 'detalles: «Diagnóstico»', 'podrobnosti: „Diagnostika“'],
    audio_wait: ['чекаю на аудіосистему…', 'waiting for the audio system…', 'warte auf das Audiosystem…', 'czekam na system audio…', 'attente du système audio…', 'attendo il sistema audio…', 'esperando el sistema de audio…', 'čekám na audiosystém…'],
    audio_try: ['аудіосистема ще не готова, спроба {n}…', 'audio system not ready, try {n}…', 'Audiosystem nicht bereit, Versuch {n}…', 'system audio niegotowy, próba {n}…', 'système audio pas prêt, essai {n}…', 'sistema audio non pronto, tentativo {n}…', 'sistema de audio no listo, intento {n}…', 'audiosystém není připraven, pokus {n}…'],
    audio_none: ['немає відповіді: {e}', 'no answer: {e}', 'keine Antwort: {e}', 'brak odpowiedzi: {e}', 'pas de réponse : {e}', 'nessuna risposta: {e}', 'sin respuesta: {e}', 'bez odpovědi: {e}'],
    audio_count: ['{s} джерел, {k} виходів', '{s} sources, {k} sinks', '{s} Quellen, {k} Ausgänge', '{s} źródeł, {k} wyjść', '{s} sources, {k} sorties', '{s} sorgenti, {k} uscite', '{s} fuentes, {k} salidas', '{s} zdrojů, {k} výstupů'],
    // the diagnostics page
    diag: ['ДІАГНОСТИКА ЗВУКУ', 'SOUND DIAGNOSTICS', 'TON-DIAGNOSE', 'DIAGNOSTYKA DŹWIĘKU', 'DIAGNOSTIC DU SON', 'DIAGNOSTICA AUDIO', 'DIAGNÓSTICO DE SONIDO', 'DIAGNOSTIKA ZVUKU'],
    diag_hint: ['жовтим: можуть підійти для сигналу · ще раз «Діагностика» — назад', 'yellow: may carry a chime · "Diagnostics" again: back', 'gelb: für einen Ton geeignet · „Diagnose“ erneut: zurück', 'żółte: mogą nieść sygnał · ponownie „Diagnostyka”: wstecz', 'en jaune : pour un signal · « Diagnostic » à nouveau : retour', 'in giallo: adatte a un segnale · «Diagnostica» di nuovo: indietro', 'en amarillo: aptas para una señal · «Diagnóstico» otra vez: volver', 'žlutě: vhodné pro signál · znovu „Diagnostika“: zpět'],
    sinks: ['ВИХОДИ', 'SINKS', 'AUSGÄNGE', 'WYJŚCIA', 'SORTIES', 'USCITE', 'SALIDAS', 'VÝSTUPY'],
    sources: ['ДЖЕРЕЛА', 'SOURCES', 'QUELLEN', 'ŹRÓDŁA', 'SOURCES', 'SORGENTI', 'FUENTES', 'ZDROJE'],
    more_in_log: ['+ ще {n} (у лозі)', '+ {n} more (in the log)', '+ {n} weitere (im Log)', '+ {n} więcej (w logu)', '+ {n} de plus (dans le journal)', '+ altri {n} (nel log)', '+ {n} más (en el registro)', '+ dalších {n} (v logu)'],
    sound_test: ['ТЕСТ ЗВУКУ', 'SOUND TEST', 'TONTEST', 'TEST DŹWIĘKU', 'TEST DU SON', 'TEST AUDIO', 'PRUEBA DE SONIDO', 'TEST ZVUKU'],
    sound_test_none: ['ще не було · кнопка «Тест звуку» внизу', 'not yet · the "Sound test" button below', 'noch keiner · Taste „Tontest“ unten', 'jeszcze nie · przycisk „Test dźwięku” poniżej', 'pas encore · bouton « Test du son » en bas', 'non ancora · pulsante «Test audio» in basso', 'aún no · botón «Prueba de sonido» abajo', 'zatím ne · tlačítko „Test zvuku“ dole'],
    unit_lacks: ['немає на блоці: {x}', 'not on this unit: {x}', 'nicht in diesem Gerät: {x}', 'brak w jednostce: {x}', 'absent de l\'unité : {x}', 'assente nell\'unità: {x}', 'no está en la unidad: {x}', 'v jednotce chybí: {x}'],
    route_overlay: ['поверх музики', 'over the music', 'über der Musik', 'nad muzyką', 'par-dessus la musique', 'sopra la musica', 'sobre la música', 'přes hudbu'],
    route_interrupt: ['перериває музику', 'interrupts the music', 'unterbricht die Musik', 'przerywa muzykę', 'interrompt la musique', 'interrompe la musica', 'interrumpe la música', 'přeruší hudbu'],
    route_media: ['через медіаплеєр', 'through the media player', 'über den Mediaplayer', 'przez odtwarzacz', 'via le lecteur', 'tramite il lettore', 'por el reproductor', 'přes přehrávač'],
    // bar buttons
    btn_test: ['Тест попередження', 'Test warning', 'Testwarnung', 'Test ostrzeżenia', 'Tester l\'alerte', 'Prova avviso', 'Probar aviso', 'Test varování'],
    btn_sound: ['Тест звуку', 'Sound test', 'Tontest', 'Test dźwięku', 'Test du son', 'Test audio', 'Prueba de sonido', 'Test zvuku'],
    btn_audio: ['Діагностика', 'Diagnostics', 'Diagnose', 'Diagnostyka', 'Diagnostic', 'Diagnostica', 'Diagnóstico', 'Diagnostika'],
    btn_db: ['Бази камер', 'Camera databases', 'Blitzer-Datenbanken', 'Bazy fotoradarów', 'Bases de radars', 'Database autovelox', 'Bases de radares', 'Databáze radarů'],
    btn_settings: ['Налаштування', 'Settings', 'Einstellungen', 'Ustawienia', 'Réglages', 'Impostazioni', 'Ajustes', 'Nastavení'],
    // the databases screen
    db_title: ['Бази камер', 'Camera databases', 'Blitzer-Datenbanken', 'Bazy fotoradarów', 'Bases de radars', 'Database autovelox', 'Bases de radares', 'Databáze radarů'],
    db_active: ['Активні: {list}', 'Active: {list}', 'Aktiv: {list}', 'Aktywne: {list}', 'Actives : {list}', 'Attivi: {list}', 'Activas: {list}', 'Aktivní: {list}'],
    db_cams: ['{n} камер', '{n} cameras', '{n} Blitzer', '{n} fotoradarów', '{n} radars', '{n} autovelox', '{n} radares', '{n} radarů'],
    db_auto: ['Автоматично: база країни, де машина', 'Automatic: the country the car is in', 'Automatisch: das Land, in dem das Auto ist', 'Automatycznie: kraj, w którym jest auto', 'Automatique : le pays où est la voiture', 'Automatico: il paese dove si trova l\'auto', 'Automático: el país donde está el coche', 'Automaticky: země, kde je auto'],
    db_update: ['Перевірити оновлення зараз', 'Check for updates now', 'Jetzt nach Updates suchen', 'Sprawdź aktualizacje teraz', 'Rechercher des mises à jour', 'Cerca aggiornamenti ora', 'Buscar actualizaciones ahora', 'Zkontrolovat aktualizace'],
    db_checked: ['Перевірено {d} · наступна {n}', 'Checked {d} · next {n}', 'Geprüft {d} · nächste {n}', 'Sprawdzono {d} · następna {n}', 'Vérifié le {d} · prochaine {n}', 'Controllato {d} · prossimo {n}', 'Comprobado {d} · próxima {n}', 'Zkontrolováno {d} · další {n}'],
    db_never: ['Ще не перевірялось · бази з версії додатка', 'Not checked yet · databases of the app version', 'Noch nicht geprüft · Daten der App-Version', 'Jeszcze nie sprawdzano · bazy z wersji aplikacji', 'Pas encore vérifié · bases de la version', 'Non ancora controllato · dati della versione', 'Aún no comprobado · bases de la versión', 'Zatím nekontrolováno · data z verze aplikace'],
    db_checking: ['Перевіряю…', 'Checking…', 'Prüfe…', 'Sprawdzam…', 'Vérification…', 'Controllo…', 'Comprobando…', 'Kontroluji…'],
    db_result: ['Оновлено баз: {n}', 'Databases updated: {n}', 'Aktualisiert: {n}', 'Zaktualizowano: {n}', 'Mises à jour : {n}', 'Aggiornati: {n}', 'Actualizadas: {n}', 'Aktualizováno: {n}'],
    db_offline: ['Немає зв\'язку з GitHub: {e}', 'No connection to GitHub: {e}', 'Keine Verbindung zu GitHub: {e}', 'Brak połączenia z GitHub: {e}', 'Pas de connexion à GitHub : {e}', 'Nessuna connessione a GitHub: {e}', 'Sin conexión con GitHub: {e}', 'Žádné spojení s GitHub: {e}'],
    group_ua: ['Україна', 'Ukraine', 'Ukraine', 'Ukraina', 'Ukraine', 'Ucraina', 'Ucrania', 'Ukrajina'],
    group_eu: ['Європа', 'Europe', 'Europa', 'Europa', 'Europe', 'Europa', 'Europa', 'Evropa'],
    group_us: ['США (штати)', 'USA (states)', 'USA (Bundesstaaten)', 'USA (stany)', 'États-Unis (États)', 'USA (stati)', 'EE. UU. (estados)', 'USA (státy)'],
    db_back: ['◂ Назад', '◂ Back', '◂ Zurück', '◂ Wstecz', '◂ Retour', '◂ Indietro', '◂ Atrás', '◂ Zpět'],
    db_all: ['Усі', 'All', 'Alle', 'Wszystkie', 'Tous', 'Tutti', 'Todos', 'Vše'],
    db_none_sel: ['вибрано {k} з {n}', '{k} of {n} chosen', '{k} von {n} gewählt', 'wybrano {k} z {n}', '{k} sur {n} choisis', '{k} di {n} scelti', '{k} de {n} elegidos', 'vybráno {k} z {n}'],
    legal_banned: ['заборонено', 'not allowed', 'verboten', 'zabronione', 'interdit', 'vietato', 'prohibido', 'zakázáno'],
    legal_zones: ['лише зони', 'zones only', 'nur Zonen', 'tylko strefy', 'zones seulement', 'solo zone', 'solo zonas', 'jen zóny'],
};

const SETTINGS = {
    lang: {
        label: ['Мова / Language', 'Language / Мова', 'Sprache / Language', 'Język / Language', 'Langue / Language', 'Lingua / Language', 'Idioma / Language', 'Jazyk / Language'],
        auto: ['Автоматично (мова країни)', 'Automatic (the country\'s language)', 'Automatisch (Landessprache)', 'Automatycznie (język kraju)', 'Automatique (langue du pays)', 'Automatico (lingua del paese)', 'Automático (idioma del país)', 'Automaticky (jazyk země)'],
    },
    enabled: { label: ['Попередження про камери', 'Camera warnings', 'Blitzer-Warnungen', 'Ostrzeżenia o fotoradarach', 'Alertes radars', 'Avvisi autovelox', 'Avisos de radares', 'Varování před radary'] },
    showWhen: {
        label: ['Коли показувати', 'When to show', 'Wann anzeigen', 'Kiedy pokazywać', 'Quand afficher', 'Quando mostrare', 'Cuándo mostrar', 'Kdy zobrazit'],
        always: ['Біля кожної камери', 'At every camera', 'Bei jedem Blitzer', 'Przy każdym fotoradarze', 'À chaque radar', 'A ogni autovelox', 'En cada radar', 'U každého radaru'],
        over: ['Лише коли перевищую ліміт', 'Only when I am over the limit', 'Nur wenn ich zu schnell bin', 'Tylko gdy przekraczam limit', 'Seulement si je dépasse', 'Solo se supero il limite', 'Solo si supero el límite', 'Jen když překračuji limit'],
    },
    banned: {
        label: ['Країни, де попередження заборонені (DE, CH…)', 'Countries where warnings are not allowed (DE, CH…)', 'Länder, in denen Warnungen verboten sind (DE, CH…)', 'Kraje, gdzie ostrzeżenia są zabronione (DE, CH…)', 'Pays où les alertes sont interdites (DE, CH…)', 'Paesi dove gli avvisi sono vietati (DE, CH…)', 'Países donde los avisos están prohibidos (DE, CH…)', 'Země, kde jsou varování zakázána (DE, CH…)'],
        off: ['Вимкнено (за законом)', 'Off (as the law says)', 'Aus (wie vorgeschrieben)', 'Wyłączone (zgodnie z prawem)', 'Désactivées (selon la loi)', 'Disattivati (per legge)', 'Desactivados (según la ley)', 'Vypnuto (podle zákona)'],
        on: ['Увімкнено: відповідальність на мені', 'On: at my own responsibility', 'An: auf eigene Verantwortung', 'Włączone: na moją odpowiedzialność', 'Activées : sous ma responsabilité', 'Attivi: a mia responsabilità', 'Activados: bajo mi responsabilidad', 'Zapnuto: na mou odpovědnost'],
    },
    units: {
        label: ['Одиниці', 'Units', 'Einheiten', 'Jednostki', 'Unités', 'Unità', 'Unidades', 'Jednotky'],
        auto: ['Як у країні камери', 'As in the camera\'s country', 'Wie im Land des Blitzers', 'Jak w kraju fotoradaru', 'Comme dans le pays du radar', 'Come nel paese dell\'autovelox', 'Como en el país del radar', 'Jako v zemi radaru'],
        kmh: ['км/год', 'km/h', 'km/h', 'km/h', 'km/h', 'km/h', 'km/h', 'km/h'],
        mph: ['миль/год', 'mph', 'mph', 'mph', 'mph', 'mph', 'mph', 'mph'],
    },
    sound: {
        label: ['Звук попередження', 'Warning sound', 'Warnton', 'Dźwięk ostrzeżenia', 'Son d\'alerte', 'Suono di avviso', 'Sonido de aviso', 'Zvuk varování'],
        off: ['Вимкнено', 'Off', 'Aus', 'Wyłączony', 'Désactivé', 'Disattivato', 'Desactivado', 'Vypnuto'],
        overlay: ['Поверх музики (як підказка навігації)', 'Over the music (like a navigation prompt)', 'Über der Musik (wie eine Navi-Ansage)', 'Nad muzyką (jak komunikat nawigacji)', 'Par-dessus la musique (comme le GPS)', 'Sopra la musica (come il navigatore)', 'Sobre la música (como el navegador)', 'Přes hudbu (jako navigace)'],
        interrupt: ['Перериває музику на мить', 'Interrupts the music briefly', 'Unterbricht die Musik kurz', 'Na chwilę przerywa muzykę', 'Interrompt brièvement la musique', 'Interrompe brevemente la musica', 'Interrumpe la música un momento', 'Krátce přeruší hudbu'],
        media: ['Через медіаплеєр (музика стане на паузу)', 'Through the media player (pauses the music)', 'Über den Mediaplayer (pausiert die Musik)', 'Przez odtwarzacz (pauzuje muzykę)', 'Via le lecteur (met la musique en pause)', 'Tramite il lettore (mette in pausa)', 'Por el reproductor (pausa la música)', 'Přes přehrávač (pozastaví hudbu)'],
    },
    soundStyle: {
        label: ['Вид сигналу', 'Sound', 'Signalton', 'Rodzaj sygnału', 'Type de signal', 'Tipo di segnale', 'Tipo de señal', 'Druh signálu'],
        ding: ['Дзень: дві ноти вгору', 'Ding: two notes up', 'Ding: zwei Töne aufwärts', 'Ding: dwa tony w górę', 'Ding : deux notes montantes', 'Ding: due note in salita', 'Ding: dos notas ascendentes', 'Ding: dva tóny nahoru'],
        gong: ['Гонг: дві ноти вниз, як у BMW', 'Gong: two notes down, like BMW\'s', 'Gong: zwei Töne abwärts, wie bei BMW', 'Gong: dwa tony w dół, jak w BMW', 'Gong : deux notes descendantes, comme BMW', 'Gong: due note in discesa, come BMW', 'Gong: dos notas descendentes, como BMW', 'Gong: dva tóny dolů, jako BMW'],
        beep3: ['Три короткі біпи', 'Three short beeps', 'Drei kurze Pieptöne', 'Trzy krótkie piknięcia', 'Trois bips courts', 'Tre bip brevi', 'Tres pitidos cortos', 'Tři krátká pípnutí'],
        soft: ['М\'який: одна тиха нота', 'Soft: one quiet note', 'Sanft: ein leiser Ton', 'Delikatny: jeden cichy ton', 'Doux : une note discrète', 'Morbido: una nota leggera', 'Suave: una nota tenue', 'Jemný: jeden tichý tón'],
        radar: ['Радар: два свисти вгору', 'Radar: two rising sweeps', 'Radar: zwei steigende Pfiffe', 'Radar: dwa narastające gwizdy', 'Radar : deux sifflets montants', 'Radar: due fischi in salita', 'Radar: dos silbidos ascendentes', 'Radar: dvě stoupající hvízdnutí'],
    },
    soundOver: { label: ['Тривожний сигнал при перевищенні', 'Alarm when over the limit', 'Alarm bei Überschreitung', 'Alarm przy przekroczeniu', 'Alarme en cas de dépassement', 'Allarme se superi il limite', 'Alarma al superar el límite', 'Alarm při překročení'] },
    soundVol: { label: ['Гучність сигналу', 'Chime volume', 'Lautstärke des Tons', 'Głośność sygnału', 'Volume du signal', 'Volume del segnale', 'Volumen de la señal', 'Hlasitost signálu'] },
    showHud: { label: ['Показувати на HUD', 'Show on the HUD', 'Im HUD anzeigen', 'Pokazuj na HUD', 'Afficher sur le HUD', 'Mostra sull\'HUD', 'Mostrar en el HUD', 'Zobrazit na HUD'] },
    showCluster: { label: ['Показувати на приладці', 'Show on the cluster', 'Im Kombiinstrument anzeigen', 'Pokazuj na zegarach', 'Afficher au combiné', 'Mostra sul quadro', 'Mostrar en el cuadro', 'Zobrazit na přístrojích'] },
    inMap: { label: ['Всередині мапи Waze / Google', 'Inside the Waze / Google map', 'In der Waze-/Google-Karte', 'W mapie Waze / Google', 'Dans la carte Waze / Google', 'Nella mappa Waze / Google', 'Dentro del mapa Waze / Google', 'V mapě Waze / Google'] },
    mapPlace: {
        label: ['Місце в мапі', 'Place in the map', 'Position in der Karte', 'Miejsce w mapie', 'Place dans la carte', 'Posizione nella mappa', 'Posición en el mapa', 'Umístění v mapě'],
        left: ['Ліворуч', 'Left', 'Links', 'Po lewej', 'À gauche', 'A sinistra', 'Izquierda', 'Vlevo'],
        center: ['По центру', 'Centre', 'Mitte', 'Na środku', 'Au centre', 'Al centro', 'Centro', 'Uprostřed'],
        right: ['Праворуч', 'Right', 'Rechts', 'Po prawej', 'À droite', 'A destra', 'Derecha', 'Vpravo'],
    },
    clusterPlace: {
        label: ['Місце на приладці (без мапи)', 'Place on the cluster (no map)', 'Position im Kombi (ohne Karte)', 'Miejsce na zegarach (bez mapy)', 'Place au combiné (sans carte)', 'Posizione sul quadro (senza mappa)', 'Posición en el cuadro (sin mapa)', 'Umístění na přístrojích (bez mapy)'],
        left: ['Ліворуч', 'Left', 'Links', 'Po lewej', 'À gauche', 'A sinistra', 'Izquierda', 'Vlevo'],
        center: ['По центру', 'Centre', 'Mitte', 'Na środku', 'Au centre', 'Al centro', 'Centro', 'Uprostřed'],
        right: ['Праворуч', 'Right', 'Rechts', 'Po prawej', 'À droite', 'A destra', 'Derecha', 'Vpravo'],
    },
    lead: { label: ['Попереджати за', 'Warn ahead by', 'Warnen vorher', 'Ostrzegaj z wyprzedzeniem', 'Prévenir à l\'avance de', 'Avvisa in anticipo di', 'Avisar con antelación de', 'Varovat předem'] },
    minWarn: { label: ['Не ближче ніж за', 'Not closer than', 'Nicht näher als', 'Nie bliżej niż', 'Pas plus près que', 'Non più vicino di', 'No más cerca de', 'Ne blíže než'] },
    tolerance: { label: ['Жовта швидкість, якщо понад ліміт на', 'Amber speed when over the limit by', 'Gelbe Geschwindigkeit ab Überschreitung um', 'Żółta prędkość, gdy ponad limit o', 'Vitesse orange au-delà de la limite de', 'Velocità gialla oltre il limite di', 'Velocidad ámbar al superar el límite en', 'Žlutá rychlost při překročení o'] },
    size: { label: ['Розмір попередження', 'Warning size', 'Größe der Warnung', 'Rozmiar ostrzeżenia', 'Taille de l\'alerte', 'Dimensione dell\'avviso', 'Tamaño del aviso', 'Velikost varování'] },
    hudBright: { label: ['Яскравість на HUD', 'HUD brightness', 'HUD-Helligkeit', 'Jasność HUD', 'Luminosité du HUD', 'Luminosità HUD', 'Brillo del HUD', 'Jas HUD'] },
    nightDim: { label: ['Вночі тьмяніше (за сонцем)', 'Dimmer at night (by the sun)', 'Nachts dunkler (nach der Sonne)', 'W nocy ciemniej (wg słońca)', 'Plus sombre la nuit (selon le soleil)', 'Più tenue di notte (secondo il sole)', 'Más tenue de noche (según el sol)', 'V noci tlumeněji (podle slunce)'] },
    autoUpdate: { label: ['Оновлювати бази раз на місяць', 'Update the databases monthly', 'Datenbanken monatlich aktualisieren', 'Aktualizuj bazy co miesiąc', 'Mettre à jour les bases chaque mois', 'Aggiorna i database ogni mese', 'Actualizar las bases cada mes', 'Aktualizovat databáze měsíčně'] },
};

const idx = (lang) => Math.max(0, LANGS.indexOf(lang));

// "automatic": the language of the country the car is in (its pack); English where none of the eight is spoken
const BY_COUNTRY = { ua: 'uk', de: 'de', at: 'de', ch: 'de', li: 'de', lu: 'de', pl: 'pl', fr: 'fr', mc: 'fr', be: 'fr', it: 'it', sm: 'it',
    es: 'es', ad: 'es', cz: 'cs', sk: 'cs' };
function forCountry(code, fallback) { return code ? BY_COUNTRY[code] || 'en' : fallback || 'uk'; }

function fill(s, v) {
    return v ? String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] !== undefined && v[k] !== null ? String(v[k]) : m)) : s;
}

/** A translator for one language: tr(key, values). */
function make(lang) {
    const i = idx(lang);
    const tr = (key, v) => {
        const row = T[key];
        return fill(row ? (row[i] !== undefined ? row[i] : row[1]) : key, v);
    };
    tr.lang = LANGS[i];
    return tr;
}

/** The settings' labels and choice texts in `lang`, written into the kit's schema (what its screens show). */
function settings(schema, lang) {
    const i = idx(lang);
    schema.forEach((s) => {
        const tr = SETTINGS[s.key];
        if (!tr) return;
        s.label = tr.label[i] || tr.label[1];
        if (s.options) s.options.forEach((o) => { if (tr[o[0]]) o[1] = tr[o[0]][i] || tr[o[0]][1]; });
    });
    return schema;
}

module.exports = { LANGS, NATIVE, T, SETTINGS, make, settings, fill, forCountry, BY_COUNTRY };
