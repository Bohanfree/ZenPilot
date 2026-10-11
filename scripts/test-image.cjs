const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const width = 240, height = 160;
const raw = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const color = x > 35 && x < 205 && y > 35 && y < 125 ? [53, 107, 85] : [224, 238, 219];
  const offset = y * (width * 3 + 1) + 1 + x * 3;
  color.forEach((value, i) => { raw[offset + i] = value; });
}
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const name = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, crc]); }
const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
const output = path.resolve(__dirname, '..', 'tests', 'fixtures'); fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'test-image.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
