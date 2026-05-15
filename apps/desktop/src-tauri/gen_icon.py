import struct

# Create a valid 32x32 32bpp ICO file with BITMAPINFOHEADER
width, height = 32, 32
bpp = 32

# BITMAPINFOHEADER (40 bytes)
bmp_header = struct.pack('<IiiHHIIiiII',
    40,              # biSize
    width,           # biWidth
    height * 2,      # biHeight (double for ICO: XOR + AND mask)
    1,               # biPlanes
    bpp,             # biBitCount
    0,               # biCompression (BI_RGB)
    0,               # biSizeImage
    0, 0,            # biXPelsPerMeter, biYPelsPerMeter
    0,               # biClrUsed
    0,               # biClrImportant
)

# XOR mask (BGRA pixels, bottom-up)
xor_data = b''
for y in range(height):
    row = b''
    for x in range(width):
        row += b'\x00\x00\xff\xff'  # Blue opaque pixel (BGRA)
    # Align to 4 bytes
    row += b'\x00' * ((4 - len(row) % 4) % 4)
    xor_data = row + xor_data  # bottom-up

# AND mask (1bpp, 0 = transparent, aligned to 4 bytes)
and_row_size = ((width + 31) // 32) * 4
and_data = b'\x00' * (and_row_size * height)  # all transparent

image_data = bmp_header + xor_data + and_data

# ICO header
header = struct.pack('<HHH', 0, 1, 1)

# Directory entry
offset = 6 + 16
entry = struct.pack('<BBBBHHII', width, height, 0, 0, 1, bpp, len(image_data), offset)

with open(r'E:\workspaces\typedance\apps\desktop\src-tauri\icons\icon.ico', 'wb') as f:
    f.write(header)
    f.write(entry)
    f.write(image_data)

print('ICO 3.00 created successfully')
