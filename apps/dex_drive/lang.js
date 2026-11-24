'use strict';
/**
 * lang.js - DeX Drive's texts: Українська (uk) and English (en). t(lang, key, args): {name} in a text is args.name.
 */
const T = {
    btn_open: ['Відкрити DeX на екрані', 'Open DeX on the screen'],
    btn_stop: ['Зупинити DeX', 'Stop DeX'],
    btn_phone: ['Вимкнути екран телефона', 'Turn the phone\'s screen off'],
    btn_forget: ['Забути ключ ADB цього авто', 'Forget this car\'s ADB key'],
    nosvc: ['Сервіс dex-drive-d не запущено. Встанови «DeX Drive service» у Store і перезапусти головний блок.',
        'The dex-drive-d service is not running. Install "DeX Drive service" from the Store and restart the head unit.'],
    idle: ['Готово. Під\'єднай Samsung з One UI 8 кабелем USB (налагодження по USB увімкнене) і натисни «Відкрити DeX».',
        'Ready. Plug in a Samsung with One UI 8 by USB (USB debugging on) and press "Open DeX".'],
    searching_usb: ['Шукаю телефон на USB… Увімкни «Налагодження по USB» у параметрах розробника.',
        'Looking for the phone on USB… Turn on "USB debugging" in Developer options.'],
    searching_wifi: ['Шукаю телефон на USB або по Wi‑Fi (ADB на порту 5555)…',
        'Looking for the phone on USB or over Wi‑Fi (ADB on port 5555)…'],
    connecting: ['Підключаюсь… {msg}', 'Connecting… {msg}'],
    wifi_setup: ['Вмикаю на телефоні ADB по Wi‑Fi (порт 5555), щоб далі працювало без кабелю. USB на мить перепідключиться…',
        'Turning on ADB over Wi‑Fi (port 5555) on the phone, so it works without the cable later. USB reconnects for a moment…'],
    auth: ['На телефоні натисни «Дозволити» налагодження (і «Завжди дозволяти з цього комп\'ютера»).',
        'On the phone, press "Allow" USB debugging (and "Always allow from this computer").'],
    streaming: ['DeX працює: {device} · {size} · {fps} · {via}', 'DeX is running: {device} · {size} · {fps} · {via}'],
    streaming_wait: ['DeX запускається на {device}…', 'DeX is starting on {device}…'],
    error: ['Помилка: {msg}', 'Error: {msg}'],
    hidden_hmi: [' · Картинку закрито дотиком до меню iDrive', ' · The picture was closed by a touch on the iDrive menu'],
    hidden_yield: [' · Картинку сховав рендерер (камера чи відео iDrive на екрані)', ' · The renderer hid the picture (an iDrive camera or video on screen)'],
    hidden_renderer: [' · mgu-render перезапустився', ' · mgu-render restarted'],
    no_controller: [' · Контролер iDrive недоступний: встанови «Controller gate» (Системні утиліти в Store) і перезапусти блок',
        ' · The iDrive controller is not reachable: install "Controller gate" (Head-unit tools in the Store) and restart the unit'],
    ccu_signals: [' · Коліщатко через сигнали авто (без Controller gate): меню iDrive під картинкою теж його чує',
        ' · Knob through the car\'s signals (no controller gate): the iDrive menu under the picture hears it too'],
    wifi_where: [' · Wi‑Fi: телефон {phone}, авто {car}', ' · Wi‑Fi: phone {phone}, car {car}'],
    no_pad: [' · Від тачпада контролера сигналу немає', ' · No signal from the controller\'s touchpad'],
    render_error: [' · mgu-render: {msg}', ' · mgu-render: {msg}'],
    last_error: [' · Остання помилка {msg}', ' · Last error {msg}'],
    moving: [' · Під час руху DeX сховано (лише на стоянці)', ' · DeX is hidden while driving (parked only)'],
    no_renderer: [' · Немає mgu-render: встанови його в Store', ' · No mgu-render: install it from the Store'],
    no_video: [' · Цей mgu-render не показує відео: онови його (0.6.11+)', ' · This mgu-render cannot show video: update it (0.6.11+)'],
    fps: ['{n} к/с', '{n} fps'],
    via_usb: ['USB', 'USB'],
    via_tcp: ['Wi‑Fi', 'Wi‑Fi'],
    key_forgotten: ['Ключ забуто: телефон спитає дозвіл знову.', 'Key forgotten: the phone will ask again.'],
};
const LANGS = ['uk', 'en'];

function t(lang, key, args) {
    const row = T[key];
    if (!row) return key;
    let s = row[Math.max(0, LANGS.indexOf(lang))] || row[0];
    if (args) Object.keys(args).forEach((k) => { s = s.split('{' + k + '}').join(String(args[k])); });
    return s;
}

module.exports = { t, T, LANGS };
