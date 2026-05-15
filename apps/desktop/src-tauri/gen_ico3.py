"""Windows 3.00-compatible 24bpp ICO using BMP encoding."""
import struct, os

w, h = 32, 32
bpp = 24

# XOR mask: BGR pixels, bottom-up, aligned to 4 bytes per row
xor_row_size = ((w * bpp + 31) // 32) * 4
xor_rows = []
for y in range(h):
    row = b''
    for x in range(w):
        row += b'\xf6\x82\x3b'  # BGR blue
    # pad to 4-byte boundary
    row += b'\x00' * (xor_row_size - len(row))
    xor_rows.insert(0, row)  # bottom-up
xor_data = b''.join(xor_rows)

# AND mask: 1bpp, all zeros (transparent), padded to 4 bytes per row
and_row_size = ((w + 31) // 32) * 4
and_data = b'\x00' * (and_row_size * h)

# BITMAPINFOHEADER (40 bytes)
bmp_info = struct.pack('<IiiHHIIiiII',
    40,       # biSize
    w,        # biWidth
    h * 2,    # biHeight (double for ICO)
    1,        # biPlanes
    bpp,      # biBitCount
    0,        # biCompression (BI_RGB)
    0,        # biSizeImage
    0, 0,     # biXPelsPerMeter, biYPelsPerMeter
    0, 0)     # biClrUsed, biClrImportant

img_data = bmp_info + xor_data + and_data

# ICO header
header = struct.pack('<HHH', 0, 1, 1)
entry = struct.pack('<BBBBHHII', w, h, 0, 0, 1, bpp, len(img_data), 22)

path = r'E:\workspaces\typedance\apps\desktop\src-tauri\icons\icon.ico'
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'wb') as f:
    f.write(header + entry + img_data)
sz = os.path.getsize(path)
print(f'icon.ico: {sz} bytes')
print('Format: BMP-encoded 24bpp ICO (3.00 compatible)')
