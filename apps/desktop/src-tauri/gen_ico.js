// Helper: generate a minimal valid ICO file (BMP-encoded, compatible with Windows 3.00 RC compiler)
const fs = require("fs");
const path = require("path");

const SIZE = 32;
const BPP = 32;

// XOR mask (BGRA pixels per row, padded to 4-byte boundary)
const xorRowSize = Math.ceil((SIZE * BPP) / 32) * 4;
const xorRows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(xorRowSize);
  for (let x = 0; x < SIZE; x++) {
    row.writeUInt32LE(0xffff0000, x * 4); // BGRA: Blue
  }
  xorRows.unshift(row); // bottom-up
}
const xorData = Buffer.concat(xorRows);

// AND mask (1 bit per pixel, padded to 4 bytes per row)
const andRowSize = Math.ceil(SIZE / 32) * 4;
const andData = Buffer.alloc(andRowSize * SIZE);

// BITMAPINFOHEADER (40 bytes)
const bmp = Buffer.alloc(40);
bmp.writeUInt32LE(40, 0);
bmp.writeInt32LE(SIZE, 4);
bmp.writeInt32LE(SIZE * 2, 8);
bmp.writeUInt16LE(1, 12);
bmp.writeUInt16LE(BPP, 14);
bmp.writeUInt32LE(0, 16);
bmp.writeUInt32LE(0, 20);
bmp.writeInt32LE(0, 24);
bmp.writeInt32LE(0, 28);
bmp.writeUInt32LE(0, 32);
bmp.writeUInt32LE(0, 36);

const imgData = Buffer.concat([bmp, xorData, andData]);

// ICO header
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);

// Directory entry
const entry = Buffer.alloc(16);
entry.writeUInt8(SIZE, 0);
entry.writeUInt8(SIZE, 1);
entry.writeUInt8(0, 2); // colors
entry.writeUInt8(0, 3); // reserved
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(BPP, 6);
entry.writeUInt32LE(imgData.length, 8); // size
entry.writeUInt32LE(22, 12); // offset

const ico = Buffer.concat([header, entry, imgData]);
const outPath = path.join(__dirname, "icons", "icon.ico");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, ico);
console.log("ICO generated:", ico.length, "bytes");
