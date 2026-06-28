import './index.css'
import UI from '@alexgyver/ui';
import { EL } from '@alexgyver/component';
import { registerSW } from './registerSW';
import { clipWrite, download } from '@alexgyver/utils';

if (USE_SW) {
    registerSW();
}

const fonts = [
    'Arial',
    'Times New Roman',
    'Georgia',
    'Verdana',
    'Courier New',
    'Consolas',
    'Tahoma',
    'Trebuchet MS',
    'Comic Sans MS',
    'Impact',
    'Helvetica',
    'Calibri',
    'Monaco',
];

let ui;
let glyphs = [];
let container, sidebar;
const modes = ['Bitpack', 'Bitpack smooth', 'Bitmap'];
const pref = ['pack', 'packs', 'map'];

//#region entry
document.addEventListener("DOMContentLoaded", () => {
    EL.update(document.body, {
        child: [
            {
                class: 'sidebar',
                ref: el => sidebar = el,
            },
            {
                class: 'container',
                ref: el => container = el,
            },
        ]
    });

    ui = new UI({ parent: sidebar, theme: 'dark notab', width: '100%' })
        .addArea('alphabet', 'Alphabet', '', alphabet_h, 8)
        .addButtons({ nums: ['0-9', () => addAb('09')], az: ['a-z', () => addAb('az')], AZ: ['A-Z', () => addAb('AZ')] })
        .addButtons({ ascii: ['ascii', () => addAb('!~')], aya: ['а-я', () => addAb('ая')], AYA: ['А-Я', () => addAb('АЯ')] })
        .addSpace()
        .addFile('', 'Upload font', load_h)
        .addSelect('font', 'Select font', fonts, glyphs_h)
        .addNumber('size', 'Size', 32, 1, glyphs_h)
        .addSwitch('italic', 'Italic', false, glyphs_h)
        .addSwitch('bold', 'Bold', false, glyphs_h)
        .addSwitch('mono', 'Monospace', false, glyphs_h)
        .addSpace()
        .addSlider('height', 'Preview Height', 200, 0, 500, 1, render_h)
        .addSpace()
        .addSelect('mode', 'Mode', modes, mode_h)
        .addSlider('threshold', 'Threshold', 128, 1, 255, 1, glyphs_h)
        .addSlider('graygap', 'Gray gap', 20, 0, 64, 1, glyphs_h)
        .addSwitch('clearL', 'Clear gray lines', true, glyphs_h)
        .addSpace()
        .addSwitch('pgm', 'PROGMEM', true)
        .addButtons({ copyH: ['Copy .h', copy_h], copyArr: ['Copy arr', copyArr_h] })
        .addButtons({ saveH: ['Save .h', saveH_h], saveBin: ['Save .bin', saveBin_h] })
        .addSpace()
        .addHTML('log')

    mode_h();
});

//#region handlers
function mode_h() {
    const smooth = (ui.mode == 1);
    ui.widgets(['graygap', 'clearL']).forEach(w => w.display(smooth));
    glyphs_h();
}

function alphabet_h(ab) {
    ui.alphabet = [...ab]
        .filter(ch => ch.codePointAt(0) > 0x20)
        .filter(ch => ch.codePointAt(0) <= 0xFFFF)
        .filter((ch, i, arr) => arr.indexOf(ch) === i)
        .sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0))
        .slice(0, 255)
        .join('');

    glyphs_h();
}

function load_h(file) {
    let reader = new FileReader();

    reader.onload = async () => {
        const face = file.name.split('.')[0];
        const font = new FontFace(face, reader.result);
        await font.load();
        document.fonts.add(font);
        console.log(face + ' loaded');
        fonts.unshift(face);
        ui.widget('font').options = fonts;
        ui.font = 0;
        glyphs_h();
    };

    reader.onerror = () => console.log(reader.error);
    reader.readAsArrayBuffer(file);
}

function glyphs_h() {
    if (ui.size > 255) ui.size = 255;
    glyphs = makeGlyphs();
    render_h();
    makeBin();
}

//#region helpers
function addAb(val) {
    let from = val[0].charCodeAt(0);
    let to = val[1].charCodeAt(0);
    let ab = ui.alphabet;
    for (let i = from; i <= to; i++) {
        ab += String.fromCharCode(i);
    }

    alphabet_h(ab);
}

function fontCss(size) {
    return (
        `${ui.italic ? 'italic ' : ''}` +
        `${ui.bold ? 'bold ' : ''}` +
        `${size}px ${ui.fontText}`
    );
}

function fontName() {
    let name = ui.fontText.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^[0-9]/.test(name)) name = '_' + name;
    name += `_${ui.size}_${pref[ui.mode]}`;
    if (ui.mono) name += '_mono';
    return name;
}

//#region save
function copy_h() {
    let res = makeH();
    if (res) clipWrite(res);
}

function copyArr_h() {
    let res = makeH(false);
    if (res) clipWrite(res);
}

function saveH_h() {
    let res = makeH();
    if (res) download(res, fontName() + '.h', 'text/plain');
}

function saveBin_h() {
    let res = makeBin();
    if (res.length) download(Uint8Array.from(res), fontName() + '.bitf');
}

//#region makeBin
function makeBin() {
    const le_16 = v => [v & 0xff, (v >> 8) & 0xff];
    const conv = [makeRLE, makeRLES, makeBitmapVCol][ui.mode];

    const ranges = [];
    for (const g of glyphs) {
        const range = ranges[ranges.length - 1];

        if (range && g.code === range.from + range.length && range.length < 255) {
            range.length++;
        } else {
            ranges.push({ from: g.code, length: 1 });
        }
    }

    if (ranges.length > 255) {
        ui.log = 'Error! 8-bit range amount overflow';
        return [];
    }

    const fontmap = glyphs.map(g => [
        g.width,
        g.height,
        g.interval,
        g.offset,
        ...conv(g.bitmap, g.width, g.height),
    ]);

    const headerLen = 1 + 1 + 1 + 1 + 1 + ranges.length * 3;    // mode + spaceWidth + lineHeight + glyphs.length + ranges.length + ranges
    const res = [ui.mode + 1, glyphs.spaceWidth, glyphs.lineHeight, glyphs.length, ranges.length];

    ranges.forEach(range => res.push(...le_16(range.from), range.length));

    let idx = 0;
    fontmap.forEach(m => {
        res.push(...le_16(idx));
        idx += m.length;
    });

    res.push(...le_16(idx));

    if (idx > 65535) {
        ui.log = 'Error! 16-bit index overflow';
        return [];
    }

    fontmap.forEach(m => res.push(...m));
    ui.log = `Done! ${glyphs.length} glyphs, ${res.length} bytes`;
    return res;
}

//#region makeH
function makeH(header = true) {
    const bin = makeBin();
    const bytelen = bin.length;
    if (!bytelen) return '';

    let res = '';

    let pgminc = !ui.pgm ? '' : `#if defined(__AVR__)
#include <avr/pgmspace.h>
#elif defined(ESP8266) || defined(ESP32)
#include <pgmspace.h>
#endif
`;

    if (header) res += `#pragma once
#include <stdint.h>
${pgminc}
// ${ui.fontText} ${ui.size}px${ui.bold ? ' bold' : ''}${ui.italic ? ' italic' : ''}
// ${modes[ui.mode]} ${bytelen} bytes
// ${ui.alphabet}
`;

    res += `static const uint8_t ${fontName()}[] ${ui.pgm ? 'PROGMEM' : ''} = {`;

    for (let i = 0; i < bytelen; i++) {
        if (i % 24 == 0) res += '\r\n\t';
        res += '0x' + bin[i].toString(16).padStart(2, '0');
        if (i != bytelen - 1) res += ', ';
    }

    res += '\r\n};';
    return res;
}

//#region makeGlyphs
function makeGlyphs() {
    const alphabet = Array.from(ui.alphabet);
    const measureChars = alphabet.length ? alphabet : ['H']; // fallback
    const targetHeight = ui.size;
    const byte = v => v < 0 ? 0 : (v > 255 ? 255 : v);

    function measureAlphabet(font, chars = alphabet) {
        const probe = document.createElement('canvas');
        const cx = probe.getContext('2d', { willReadFrequently: true });

        cx.font = font;
        cx.textBaseline = 'alphabetic';

        const metrics = chars.map(ch => {
            const m = cx.measureText(ch);

            const left = Math.floor(-m.actualBoundingBoxLeft);
            const right = Math.ceil(m.actualBoundingBoxRight);
            const top = Math.ceil(m.actualBoundingBoxAscent);
            const bottom = Math.ceil(m.actualBoundingBoxDescent);

            return { ch, m, left, right, top, bottom };
        });

        const maxGlyphHeight = Math.max(
            1,
            ...metrics.map(g => g.top + g.bottom)
        );

        const asc = Math.max(0, ...metrics.map(g => g.top));
        const desc = Math.max(0, ...metrics.map(g => g.bottom));

        return { metrics, maxGlyphHeight, asc, desc };
    }

    const initialFont = fontCss(targetHeight);
    const initial = measureAlphabet(initialFont, measureChars);
    const correctedSize = targetHeight * targetHeight / initial.maxGlyphHeight;
    const font = fontCss(correctedSize);
    const measured = measureAlphabet(font, measureChars);
    const glyphMetrics = measureAlphabet(font, alphabet);
    let spaceWidth = Math.ceil(measureAlphabet(font, [' ']).metrics[0].m.width);
    const metrics = glyphMetrics.metrics;
    const globalAsc = measured.asc;
    const globalDesc = measured.desc;

    const graygap = ui.graygap;
    const threshold = ui.threshold;
    const smooth = ui.mode == 1;

    const result = [];

    for (const g of metrics) {
        const width = byte(g.right - g.left);
        const height = byte(g.top + g.bottom);
        const offset = byte(globalAsc - g.top);
        const advance = Math.ceil(g.m.width);
        const interval = byte(advance - width);

        const glyph = {
            char: g.ch,
            code: g.ch.codePointAt(0),

            width,
            height,
            offset,
            interval,

            bitmap: new Uint8Array(width * height),
        };

        if (width === 0 || height === 0) {
            result.push(glyph);
            continue;
        }

        const cv = document.createElement('canvas');
        cv.width = width;
        cv.height = height;

        const cx = cv.getContext('2d', { willReadFrequently: true });

        cx.font = font;
        cx.textBaseline = 'alphabetic';
        cx.fillStyle = 'white';

        cx.fillText(g.ch, -g.left, g.top);

        const img = cx.getImageData(0, 0, width, height).data;

        for (let i = 0, p = 0; i < img.length; i += 4, p++) {
            let a = img[i + 3];

            if (smooth) {
                if (a < threshold - graygap) a = 0;
                else if (a > threshold + graygap) a = 255;
                else a = 128;
            } else {
                a = (a < threshold) ? 0 : 255;
            }

            glyph.bitmap[p] = a;
        }

        if (smooth && ui.clearL) {
            glyph.bitmap = clearGray(glyph.bitmap, glyph.width, glyph.height);
        }

        result.push(glyph);
    }

    if (ui.mono && result.length) {
        const maxWidth = byte(Math.max(...result.map(g => g.width)));

        for (const g of result) {
            if (g.width !== maxWidth) {
                const padLeft = Math.floor((maxWidth - g.width) / 2);
                const bitmap = new Uint8Array(maxWidth * g.height);

                for (let y = 0; y < g.height; y++) {
                    const src = y * g.width;
                    const dst = y * maxWidth + padLeft;
                    bitmap.set(g.bitmap.subarray(src, src + g.width), dst);
                }

                g.bitmap = bitmap;
                g.width = maxWidth;
            }

            g.interval = 0;
        }

        spaceWidth = maxWidth;
    }

    result.lineHeight = byte(globalAsc + globalDesc);
    result.spaceWidth = byte(spaceWidth);
    result.font = font;
    result.cssFontSize = correctedSize;
    result.targetHeight = targetHeight;
    result.actualMaxHeight = Math.max(0, ...result.map(g => g.height));

    return result;
}

//#region clearGray
function clearGray(bitmap, width, height) {
    const out = new Uint8Array(bitmap);
    const idx = (x, y) => y * width + x;

    function inside(x, y) {
        return x >= 0 && y >= 0 && x < width && y < height;
    }

    function get(x, y) {
        return inside(x, y) ? bitmap[idx(x, y)] : 0;
    }

    function is255(x, y) {
        return get(x, y) === 255;
    }

    function isCorner128(x, y) {
        const left = is255(x - 1, y);
        const right = is255(x + 1, y);
        const up = is255(x, y - 1);
        const down = is255(x, y + 1);

        return (
            (left && up) ||
            (up && right) ||
            (right && down) ||
            (down && left)
        );
    }

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = idx(x, y);

            if (bitmap[i] === 128 && !isCorner128(x, y)) {
                out[i] = 0;
            }
        }
    }

    return out;
}

//#region render_h
function render_h() {
    function drawGlyphCanvas(cx, g, cv) {
        cx.clearRect(0, 0, cv.width, cv.height);

        for (let y = 0; y < g.height; y++) {
            for (let x = 0; x < g.width; x++) {
                let a = g.bitmap[y * g.width + x];
                if (a === 0) continue;

                cx.fillStyle = `rgba(${color.r}, ${color.g}, ${color.b}, ${a / 255})`;

                cx.fillRect(
                    x * (pixelSize + gap),
                    (y + g.offset) * (pixelSize + gap),
                    pixelSize,
                    pixelSize
                );
            }
        }
    }

    container.clear();

    const gap = 1;
    const childs = [];
    const color = { r: 0x47, g: 0x8b, b: 0xe6 };
    const lineH = glyphs.lineHeight;
    const targetH = Math.max(1, Number(ui.height) || lineH);
    const smooth = ui.mode == 1;

    const pixelSize = Math.max(
        1,
        Math.floor((targetH - (lineH - 1) * gap) / lineH)
    );

    for (const g of glyphs) {
        const w = Math.max(1, g.width);
        const h = Math.max(1, lineH);

        const cv = EL.make('canvas');
        const cx = cv.getContext('2d');

        cv.width = w * pixelSize + Math.max(0, w - 1) * gap;
        cv.height = h * pixelSize + Math.max(0, h - 1) * gap;

        drawGlyphCanvas(cx, g, cv);

        cv.addEventListener('click', (ev) => {
            const rect = cv.getBoundingClientRect();
            const mx = ev.clientX - rect.left;
            const my = ev.clientY - rect.top;
            const sx = cv.width / rect.width;
            const sy = cv.height / rect.height;
            const px = mx * sx;
            const py = my * sy;
            const step = pixelSize + gap;
            const cellX = Math.floor(px / step);
            const cellY = Math.floor(py / step);
            // const inGapX = (px % step) >= pixelSize;
            // const inGapY = (py % step) >= pixelSize;
            // if (inGapX || inGapY) return;

            const x = cellX;
            const y = cellY - g.offset;

            if (x < 0 || x >= g.width) return;
            if (y < 0 || y >= g.height) return;

            const idx = y * g.width + x;
            const v = g.bitmap[idx];

            if (smooth) {
                g.bitmap[idx] = (v == 0) ? 128 : (v == 128 ? 255 : 0);
            } else {
                g.bitmap[idx] = v == 0 ? 255 : 0;
            }

            drawGlyphCanvas(cx, g, cv);
        });

        const wrap = EL.make('div', {
            class: 'letter',
            children: cv,
        });

        wrap._glyph = g;
        childs.push(wrap);
    }

    EL.update(container, { children_r: childs });
}

//#region makers
function makeBitmapVCol(buf, w, h) {
    let data = [];
    let chunk = Math.ceil(h / 8);

    for (let x = 0; x < w; x++) {
        for (let yy = 0; yy < chunk; yy++) {
            let byte = 0;
            for (let b = 0; b < 8; b++) {
                byte >>= 1;
                let y = yy * 8 + b;
                if (y < h && buf[y * w + x]) {
                    byte |= 1 << 7;
                }
            }
            data.push(byte);
        }
    }

    return data;
}

function makeBitmapVRow(buf, w, h) {
    let data = [];
    let chunk = Math.ceil(h / 8);

    for (let yy = 0; yy < chunk; yy++) {
        for (let x = 0; x < w; x++) {
            let byte = 0;
            for (let b = 0; b < 8; b++) {
                byte >>= 1;
                let y = yy * 8 + b;
                if (y < h && buf[y * w + x]) {
                    byte |= 1 << 7;
                }
            }
            data.push(byte);
        }
    }

    return data;
}

function makeRLE(buf, w, h) {
    let data = [];
    let i = 0, value = 0, shift = 0;
    const get = (x, y) => buf[y * w + x];

    let push = () => {
        // 0b00vlllll
        let chunk = (value << 5) | (i - 1);
        switch ((shift++) & 0b11) {
            case 0:
                data.push(chunk << 2);
                break;
            case 1:
                data[data.length - 1] |= chunk >> 4;
                data.push((chunk << 4) & 0b11110000);
                break;
            case 2:
                data[data.length - 1] |= chunk >> 2;
                data.push((chunk << 6) & 0b11000000);
                break;
            case 3:
                data[data.length - 1] |= chunk;
                break;
        }
    }

    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let v = get(x, y) ? 1 : 0;
            if (!i) {
                i = 1;
                value = v;
            } else {
                if (value == v) {
                    i++;
                    if (i == 32) {
                        push();
                        i = 0;
                    }
                } else {
                    push();
                    value = v;
                    i = 1;
                }
            }
        }
    }
    if (i) push();

    return data;
}

function makeRLES(buf, w, h) {
    let data = [];
    let i = 0, value = 0, sub = 0, shift = 0;
    const get = (x, y) => buf[y * w + x];

    const push = () => {
        // 0b00vsllll
        let chunk = (value << 5) | (sub << 4) | (i - 1);

        switch ((shift++) & 0b11) {
            case 0:
                data.push(chunk << 2);
                break;
            case 1:
                data[data.length - 1] |= chunk >> 4;
                data.push((chunk << 4) & 0b11110000);
                break;
            case 2:
                data[data.length - 1] |= chunk >> 2;
                data.push((chunk << 6) & 0b11000000);
                break;
            case 3:
                data[data.length - 1] |= chunk;
                break;
        }
    };

    const start = (v, s = 0) => {
        i = 1;
        value = v;
        sub = s;
    };

    const put = (v) => {
        if (!i) {
            start(v);
        } else if (sub && i == 1) {
            value = v;
            i++;
        } else if (value == v && i < 16) {
            i++;
        } else {
            push();
            start(v);
        }
    };

    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let raw = get(x, y);

            if (raw == 128) {
                if (i) push();
                start(0, 1);
            } else {
                put(raw ? 1 : 0);
            }
        }
    }

    if (i) push();

    return data;
}
