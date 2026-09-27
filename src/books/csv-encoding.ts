import * as iconv from 'iconv-lite';

/** Byte order mark that tells Excel a CSV file is UTF-8. */
export const UTF8_BOM = '\uFEFF';

/** Replacement character left wherever bytes could not be decoded. */
export const UNREADABLE_CHAR = '\uFFFD';

export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030' | 'big5';

/**
 * Decode an uploaded CSV file into text.
 *
 * Excel saves "CSV" in the system's legacy code page, not UTF-8: GBK on
 * Simplified Chinese Windows and Big5 on Traditional Chinese Windows. Reading
 * those bytes as UTF-8 turns every Chinese character into U+FFFD, so the
 * encoding is detected rather than assumed:
 *
 * 1. a byte order mark wins (UTF-8, UTF-16 LE/BE);
 * 2. bytes that are valid UTF-8 are UTF-8 (this includes plain ASCII);
 * 3. otherwise the file is Big5 when its double-byte characters look like
 *    Big5, and GB18030 (a superset of GBK and GB2312) in every other case.
 *
 * Node 12 cannot do this itself: its TextDecoder has no GBK or Big5 without
 * full ICU, so iconv-lite (already installed via Express) does the decoding.
 */
export function decodeCsvBuffer(buffer: Buffer): { text: string; encoding: CsvEncoding } {
  const encoding = detectCsvEncoding(buffer);
  let text = encoding === 'utf-8' ? buffer.toString('utf8') : iconv.decode(buffer, encoding);
  if (text.charAt(0) === UTF8_BOM) {
    text = text.slice(1);
  }
  return { text, encoding };
}

export function detectCsvEncoding(buffer: Buffer): CsvEncoding {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf-8';
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'utf-16le';
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return 'utf-16be';
  }
  if (isValidUtf8(buffer)) {
    return 'utf-8';
  }
  return looksLikeBig5(buffer) ? 'big5' : 'gb18030';
}

/**
 * Valid UTF-8 survives a decode/encode round trip unchanged; anything invalid
 * (stray bytes, truncated or overlong sequences) comes back as U+FFFD and so
 * differs from the original.
 */
function isValidUtf8(buffer: Buffer): boolean {
  return Buffer.from(buffer.toString('utf8'), 'utf8').equals(buffer);
}

/**
 * GBK and Big5 share most of their byte ranges, so either decodes the other
 * without errors, into the wrong characters. What tells them apart is the
 * second byte of each character: everyday Simplified Chinese sits in the
 * GB2312 block, where it is always 0xA1-0xFE, while a quarter or more of the
 * characters in typical Big5 text use 0x40-0x7E. A file is taken as Big5 when
 * at least a tenth of its characters do and it decodes as Big5 without errors.
 */
function looksLikeBig5(buffer: Buffer): boolean {
  let pairs = 0;
  let lowTrail = 0;
  for (let i = 0; i < buffer.length - 1; i++) {
    const lead = buffer[i];
    if (lead < 0x81 || lead === 0xff) {
      continue;
    }
    const trail = buffer[i + 1];
    pairs++;
    if (trail >= 0x40 && trail <= 0x7e) {
      lowTrail++;
    }
    i++; // skip the trail byte
  }
  if (pairs === 0 || lowTrail / pairs < 0.1) {
    return false;
  }
  return iconv.decode(buffer, 'big5').indexOf(UNREADABLE_CHAR) === -1;
}
