"""Generate a Windows 3.00-compatible icon.ico"""
import struct, os

size, bpp = 32, 24
xor_row = ((size * bpp + 31) // 32) * 4

# XOR mask: blue pixels, bottom-up
xor_data = b''
for y in range(size):
    row = b'\xf6\x82\x3b' * size  # BGR blue
    row += b'\x00' * (xor_row - len(row))
    xor_data = row + xor_data  # bottom-up

# AND mask: transparent
and_row = ((size + 31) // 32) * 4
and_data = b'\x00' * (and_row * size)

# BITMAPINFOHEADER
bmp = struct.pack('<IiiHHIIiiII', 40, size, size*2, 1, bpp, 0, 0, 0, 0, 0, 0)
img = bmp + xor_data + and_data

# ICO container
ico = struct.pack('<HHH', 0, 1, 1)
ico += struct.pack('<BBBBHHII', size, size, 0, 0, 1, bpp, len(img), 22)
ico += img

path = os.path.join(os.path.dirname(__file__), 'icons', 'icon.ico')
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'wb') as f:
    f.write(ico)
print(f'OK: {os.path.getsize(path)} bytes -> {path}')
