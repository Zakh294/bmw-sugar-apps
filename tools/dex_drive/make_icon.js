'use strict';
/**
 * make_icon.js [out.png] - DeX Drive's 140x140 tile icon in the HMI's style (white line art on transparent, one
 * accent): a desktop screen with a taskbar and two windows, a phone beside it, the link between them in BMW blue.
 *   node tools/dex_drive/make_icon.js apps/dex_drive/icon.png
 */
const fs = require('fs');
const path = require('path');
const { Canvas } = require(path.join(__dirname, '..', '..', 'kit', 'runtime', 'canvas'));

const W = '#ffffff', B = '#2a8cff';
const out = process.argv[2] || path.join(__dirname, '..', '..', 'apps', 'dex_drive', 'icon.png');
const c = new Canvas(140, 140);
// the desktop (the car's screen): frame, taskbar, two windows
c.strokeRoundRect(10, 26, 92, 62, 6, 5, W);
c.fillRect(16, 76, 80, 5, W);
c.strokeRoundRect(20, 34, 34, 24, 3, 3, W);
c.strokeRoundRect(48, 44, 40, 26, 3, 3, W);
// the phone
c.strokeRoundRect(104, 46, 28, 50, 6, 5, W);
c.fillRect(113, 88, 10, 3, W);
// the link: phone -> screen
c.line(104, 104, 56, 104, 5, B);
c.line(56, 104, 56, 92, 5, B);
c.line(118, 96, 118, 104, 5, B);
c.line(104, 104, 118, 104, 5, B);
fs.writeFileSync(out, c.png(9));
console.log('wrote ' + out);
