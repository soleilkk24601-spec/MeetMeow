const root = typeof globalThis !== 'undefined'
    ? globalThis
    : typeof global !== 'undefined'
        ? global
        : typeof wx !== 'undefined'
            ? wx
            : {};

if (typeof root.TextEncoder === 'undefined') {
    function TextEncoder() {}
    TextEncoder.prototype.encode = function (string) {
        var octets = [];
        var length = string.length;
        var i = 0;
        while (i < length) {
            var codePoint = string.codePointAt(i);
            var c = 0;
            var bits = 0;
            if (codePoint <= 0x0000007F) {
                c = 0;
                bits = 0x00;
            } else if (codePoint <= 0x000007FF) {
                c = 6;
                bits = 0xC0;
            } else if (codePoint <= 0x0000FFFF) {
                c = 12;
                bits = 0xE0;
            } else if (codePoint <= 0x001FFFFF) {
                c = 18;
                bits = 0xF0;
            }
            octets.push(bits | (codePoint >> c));
            c -= 6;
            while (c >= 0) {
                octets.push(0x80 | ((codePoint >> c) & 0x3F));
                c -= 6;
            }
            i += codePoint >= 0x10000 ? 2 : 1;
        }
        return new Uint8Array(octets);
    };
    root.TextEncoder = TextEncoder;
}

if (typeof root.TextDecoder === 'undefined') {
    function TextDecoder() {}
    TextDecoder.prototype.decode = function (bytes) {
        var string = '';
        var i = 0;
        while (i < bytes.length) {
            var b = bytes[i];
            if (b <= 0x7F) {
                string += String.fromCharCode(b);
                i++;
                continue;
            }
            var c = 0;
            var min = 0;
            if (b <= 0xDF) {
                c = 1;
                min = 0x80;
            } else if (b <= 0xEF) {
                c = 2;
                min = 0x800;
            } else if (b <= 0xF7) {
                c = 3;
                min = 0x10000;
            }
            var codePoint = 0;
            if (c > 0) {
                codePoint = b & (0xFF >> (c + 1));
                for (var j = 0; j < c; j++) {
                    var b2 = bytes[i + 1 + j];
                    codePoint = (codePoint << 6) | (b2 & 0x3F);
                }
            }
            if (codePoint >= min) {
                if (codePoint < 0x10000) {
                    string += String.fromCharCode(codePoint);
                } else {
                    codePoint -= 0x10000;
                    string += String.fromCharCode(0xD800 + (codePoint >> 10));
                    string += String.fromCharCode(0xDC00 + (codePoint & 0x3FF));
                }
            }
            i += c + 1;
        }
        return string;
    };
    root.TextDecoder = TextDecoder;
}

module.exports = {
    TextEncoder: root.TextEncoder,
    TextDecoder: root.TextDecoder
};