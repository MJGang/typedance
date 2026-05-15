const fs = require('fs');
const path = require('path');

// Manually construct a valid 32x32 32bpp ICO with BITMAPINFOHEADER
const w = 32, h = 32, bpp = 32;

// XOR mask: BGRA pixels
const xorRowSize = Math.ceil((w * bpp) / 32) * 4;
const xorRows = [];
for (let y = 0; y < h; y++) {
    let row = Buffer.alloc(xorRowSize);
    for (let x = 0; x < w; x++) {
        row.writeUInt32LE(0xff0000ff, x * 4); // Blue, opaque (BGRA)
    }
    xorRows.unshift(row); // bottom-up
}
const xorData = Buffer.concat(xorRows);

// AND mask
const andRowSize = Math.ceil(w / 32) * 4;
const andData = Buffer.alloc(andRowSize * h);

// BITMAPINFOHEADER
const bmp = Buffer.alloc(40);
bmp.writeUInt32LE(40, 0);  // biSize
bmp.writeInt32LE(w, 4);    // biWidth
bmp.writeInt32LE(h * 2, 8); // biHeight
bmp.writeUInt16LE(1, 12);  // biPlanes
bmp.writeUInt16LE(bpp, 14); // biBitCount
bmp.writeUInt32LE(0, 16);  // biCompression
bmp.writeUInt32LE(0, 20);  // biSizeImage
bmp.writeInt32LE(0, 24);   // biXPelsPerMeter
bmp.writeInt32LE(0, 28);   // biYPelsPerMeter
bmp.writeUInt32LE(0, 32);  // biClrUsed
bmp.writeUInt32LE(0, 36);  // biClrImportant

const imgData = Buffer.concat([bmp, xorData, andData]);

// ICO header
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);  // reserved
header.writeUInt16LE(1, 2);  // type (ICO)
header.writeUInt16LE(1, 4);  // count

// Directory entry
const entry = Buffer.alloc(16);
entry.writeUInt8(w, 0);
entry.writeUInt8(h, 1);
entry.writeUInt8(0, 2);  // colors
entry.writeUInt8(0, 3);  // reserved
entry.writeUInt16LE(1, 4);  // planes
entry.writeUInt16LE(bpp, 6); // bpp
entry.writeUInt32LE(imgData.length, 8); // size
entry.writeUInt32LE(22, 12); // offset (6+16)

const ico = Buffer.concat([header, entry, imgData]);
const outPath = path.join(__dirname, 'icons', 'icon.ico');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, ico);
console.log('ICO created:', ico.length, 'bytes');
