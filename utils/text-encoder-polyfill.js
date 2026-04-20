// text-encoder-polyfill.js - 适配微信小程序真机环境的编码兼容层
const root = (() => {
  if (typeof globalThis !== 'undefined') return globalThis;
  if (typeof global !== 'undefined') return global;
  if (typeof wx !== 'undefined') return wx;
  if (typeof window !== 'undefined') return window;
  return {};
})();

// 修复1: 更健壮的 TextEncoder 实现（适配微信小程序真机）
if (typeof root.TextEncoder === 'undefined') {
  root.TextEncoder = class TextEncoder {
    constructor(encoding = 'utf-8') {
      if (encoding.toLowerCase() !== 'utf-8') {
        throw new Error('TextEncoder only supports UTF-8 encoding');
      }
      this.encoding = 'utf-8';
    }

    /**
     * 字符串转UTF-8 Uint8Array（修复真机兼容问题）
     * @param {string} string - 要编码的字符串
     * @returns {Uint8Array} UTF-8编码的字节数组
     */
    encode(string) {
      // 空值处理
      if (typeof string !== 'string' || string.length === 0) {
        return new Uint8Array(0);
      }

      let bytes = [];
      const str = String(string); // 确保是字符串类型
      const len = str.length;
      let i = 0;

      while (i < len) {
        let codePoint = str.codePointAt(i);
        
        // 处理无效的 codePoint
        if (isNaN(codePoint)) {
          codePoint = 0xFFFD; // 替换为替换字符
        }

        // 单字节 (0x00-0x7F)
        if (codePoint <= 0x7F) {
          bytes.push(codePoint);
        } 
        // 双字节 (0x80-0x7FF)
        else if (codePoint <= 0x7FF) {
          bytes.push(0xC0 | (codePoint >> 6));
          bytes.push(0x80 | (codePoint & 0x3F));
        } 
        // 三字节 (0x800-0xFFFF)
        else if (codePoint <= 0xFFFF) {
          bytes.push(0xE0 | (codePoint >> 12));
          bytes.push(0x80 | ((codePoint >> 6) & 0x3F));
          bytes.push(0x80 | (codePoint & 0x3F));
        } 
        // 四字节 (0x10000-0x10FFFF)
        else if (codePoint <= 0x10FFFF) {
          bytes.push(0xF0 | (codePoint >> 18));
          bytes.push(0x80 | ((codePoint >> 12) & 0x3F));
          bytes.push(0x80 | ((codePoint >> 6) & 0x3F));
          bytes.push(0x80 | (codePoint & 0x3F));
        } 
        // 超出范围的字符
        else {
          bytes.push(0xEF, 0xBF, 0xBD); // UTF-8 替换字符 �
        }

        // 处理代理对 (U+10000 及以上)
        i += codePoint >= 0x10000 ? 2 : 1;
      }

      // 修复2: 兼容微信小程序真机的 Uint8Array 处理
      try {
        return new Uint8Array(bytes);
      } catch (e) {
        // 降级处理：如果创建 Uint8Array 失败，返回普通数组（由调用方兼容）
        console.warn('Uint8Array 创建失败，降级为普通数组', e);
        return bytes;
      }
    }

    encodeInto(string, dest) {
      // 基础实现，满足Dify SDK的最小需求
      const src = this.encode(string);
      const written = Math.min(src.length, dest.length);
      for (let i = 0; i < written; i++) {
        dest[i] = src[i];
      }
      return { read: string.length, written };
    }
  };
}

// 修复3: 更健壮的 TextDecoder 实现（适配微信小程序真机）
if (typeof root.TextDecoder === 'undefined') {
  root.TextDecoder = class TextDecoder {
    constructor(encoding = 'utf-8') {
      if (encoding.toLowerCase() !== 'utf-8') {
        throw new Error('TextDecoder only supports UTF-8 encoding');
      }
      this.encoding = 'utf-8';
      this.fatal = false;
      this.ignoreBOM = false;
    }

    /**
     * UTF-8 Uint8Array 转字符串（修复真机兼容问题）
     * @param {Uint8Array|number[]} bytes - 要解码的字节数组
     * @returns {string} 解码后的字符串
     */
    decode(bytes) {
      // 空值处理
      if (!bytes || bytes.length === 0) {
        return '';
      }

      // 统一格式：兼容 Uint8Array 和普通数组
      const arr = Array.isArray(bytes) ? bytes : Array.from(bytes);
      let str = '';
      let i = 0;
      const len = arr.length;

      while (i < len) {
        const byte = arr[i] & 0xFF; // 确保是无符号字节
        
        // 单字节
        if ((byte & 0x80) === 0) {
          str += String.fromCharCode(byte);
          i++;
        }
        // 双字节
        else if ((byte & 0xE0) === 0xC0 && i + 1 < len) {
          const byte2 = arr[i + 1] & 0xFF;
          if ((byte2 & 0xC0) === 0x80) {
            const code = ((byte & 0x1F) << 6) | (byte2 & 0x3F);
            str += String.fromCharCode(code);
            i += 2;
          } else {
            // 无效的UTF-8序列
            str += '\ufffd';
            i++;
          }
        }
        // 三字节
        else if ((byte & 0xF0) === 0xE0 && i + 2 < len) {
          const byte2 = arr[i + 1] & 0xFF;
          const byte3 = arr[i + 2] & 0xFF;
          if ((byte2 & 0xC0) === 0x80 && (byte3 & 0xC0) === 0x80) {
            const code = ((byte & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F);
            str += String.fromCharCode(code);
            i += 3;
          } else {
            str += '\ufffd';
            i++;
          }
        }
        // 四字节
        else if ((byte & 0xF8) === 0xF0 && i + 3 < len) {
          const byte2 = arr[i + 1] & 0xFF;
          const byte3 = arr[i + 2] & 0xFF;
          const byte4 = arr[i + 3] & 0xFF;
          if ((byte2 & 0xC0) === 0x80 && (byte3 & 0xC0) === 0x80 && (byte4 & 0xC0) === 0x80) {
            const codePoint = ((byte & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
            // 转换为代理对
            if (codePoint > 0xFFFF) {
              const offset = codePoint - 0x10000;
              const high = 0xD800 + (offset >> 10);
              const low = 0xDC00 + (offset & 0x3FF);
              str += String.fromCharCode(high, low);
            } else {
              str += String.fromCharCode(codePoint);
            }
            i += 4;
          } else {
            str += '\ufffd';
            i++;
          }
        }
        // 无效字节
        else {
          str += '\ufffd';
          i++;
        }
      }

      return str;
    }
  };
}

// 修复4: 导出适配微信小程序的版本
module.exports = {
  TextEncoder: root.TextEncoder,
  TextDecoder: root.TextDecoder,
  // 额外导出工具方法，方便chat.js中兼容使用
  encodeUTF8: (str) => new root.TextEncoder().encode(str),
  decodeUTF8: (bytes) => new root.TextDecoder().decode(bytes)
};