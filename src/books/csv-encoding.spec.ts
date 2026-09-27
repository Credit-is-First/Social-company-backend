import * as iconv from 'iconv-lite';
import { decodeCsvBuffer, detectCsvEncoding, UTF8_BOM } from './csv-encoding';

const HEADER = 'Title,Author,ISBN,Category,Total Copies';

const SIMPLIFIED = [
  HEADER,
  '三体,刘慈欣,9787536692930,科幻,3',
  '活着,余华,9787506365437,小说,2',
  '红楼梦,曹雪芹,9787020002207,古典文学,1',
].join('\r\n');

const TRADITIONAL = [
  HEADER,
  '三體,劉慈欣,9789863594215,科幻,3',
  '活著,余華,9789573318669,小說,2',
  '紅樓夢,曹雪芹,9789571458466,古典文學,1',
].join('\r\n');

describe('decodeCsvBuffer', () => {
  it('reads UTF-8', () => {
    const result = decodeCsvBuffer(Buffer.from(SIMPLIFIED, 'utf8'));

    expect(result.encoding).toBe('utf-8');
    expect(result.text).toBe(SIMPLIFIED);
  });

  it('reads UTF-8 with a BOM (Excel "CSV UTF-8") and drops the BOM', () => {
    const result = decodeCsvBuffer(Buffer.from(UTF8_BOM + SIMPLIFIED, 'utf8'));

    expect(result.encoding).toBe('utf-8');
    expect(result.text).toBe(SIMPLIFIED);
  });

  it('reads plain ASCII as UTF-8', () => {
    const text = `${HEADER}\r\nDune,Herbert,111,SciFi,2`;

    expect(decodeCsvBuffer(Buffer.from(text, 'ascii'))).toEqual({ text, encoding: 'utf-8' });
  });

  it('reads GBK (Excel "CSV" on Simplified Chinese Windows)', () => {
    // 三体 in GBK, written out so the test does not depend on the encoder.
    const bytes = Buffer.concat([Buffer.from('Title\r\n'), Buffer.from([0xc8, 0xfd, 0xcc, 0xe5])]);

    expect(decodeCsvBuffer(bytes)).toEqual({ text: 'Title\r\n三体', encoding: 'gb18030' });
  });

  it('reads a whole GBK file', () => {
    const result = decodeCsvBuffer(iconv.encode(SIMPLIFIED, 'gbk'));

    expect(result.encoding).toBe('gb18030');
    expect(result.text).toBe(SIMPLIFIED);
  });

  it('reads Big5 (Excel "CSV" on Traditional Chinese Windows)', () => {
    // 三體 in Big5.
    const bytes = Buffer.concat([Buffer.from('Title\r\n'), Buffer.from([0xa4, 0x54, 0xc5, 0xe9])]);

    expect(decodeCsvBuffer(bytes)).toEqual({ text: 'Title\r\n三體', encoding: 'big5' });
  });

  it('reads a whole Big5 file', () => {
    const result = decodeCsvBuffer(iconv.encode(TRADITIONAL, 'big5'));

    expect(result.encoding).toBe('big5');
    expect(result.text).toBe(TRADITIONAL);
  });

  it('reads Traditional characters saved as GBK as GBK, not Big5', () => {
    const result = decodeCsvBuffer(iconv.encode(TRADITIONAL, 'gbk'));

    expect(result.encoding).toBe('gb18030');
    expect(result.text).toBe(TRADITIONAL);
  });

  it('reads UTF-16 with a BOM (Excel "Unicode Text")', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(SIMPLIFIED, 'utf-16le')]);
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(SIMPLIFIED, 'utf-16be')]);

    expect(decodeCsvBuffer(le)).toEqual({ text: SIMPLIFIED, encoding: 'utf-16le' });
    expect(decodeCsvBuffer(be)).toEqual({ text: SIMPLIFIED, encoding: 'utf-16be' });
  });
});

describe('detectCsvEncoding', () => {
  it('treats an empty file as UTF-8', () => {
    expect(detectCsvEncoding(Buffer.alloc(0))).toBe('utf-8');
  });

  it('does not take truncated UTF-8 for UTF-8', () => {
    // The first two of the three bytes of 三.
    expect(detectCsvEncoding(Buffer.from([0x41, 0xe4, 0xb8]))).not.toBe('utf-8');
  });
});
