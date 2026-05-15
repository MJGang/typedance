"""Create a minimal Windows 3.00 compatible 16-color ICO."""
import struct, os

w, h, bpp = 1, 1, 4

# Color palette (16 colors, 4 bytes each: B,G,R,reserved)
palette = b''
# color 0: blue
palette += b'\xf6\x82\x3b\x00'
# colors 1-15: black (unused for 1x1)
palette += b'\x00\x00\x00\x00' * 15

# XOR mask: 1 pixel at 4bpp = 4 bits = 1 byte, pad to 4 bytes
xor_row = b'\x00'  # color index 0
xor_pad = b'\x00' * (3)  # pad to 4 bytes
xor_data = xor_row + xor_pad

# AND mask: 1 pixel at 1bpp = 1 bit, pad to 4 bytes
and_row = b'\x00'  # transparent
and_pad = b'\x00' * 3  # pad to 4 bytes
and_data = and_row + and_pad

# BITMAPINFOHEADER
bmp = struct.pack('<IiiHHIIiiII',
    40, w, h*2, 1, bpp, 0, 0, 0, 0, 16, 0)

img_data = bmp + palette + xor_data + and_data

header = struct.pack('<HHH', 0, 1, 1)
entry = struct.pack('<BBBBHHII', 1, 1, 16, 0, 1, bpp, len(img_data), 22)

path = r'E:\workspaces\typedance\apps\desktop\src-tauri\icons\icon.ico'
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, 'wb') as f:
    f.write(header + entry + img_data)
print(f'Created 1x1 16-color ICO: {os.path.getsize(path)} bytes')
