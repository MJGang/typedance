"""Create all required Tauri icon files (PNG + ICO)."""
import struct, zlib, os

def make_png(w, h):
    """Build a minimal RGBA PNG."""
    def png_chunk(ctype, data):
        body = ctype + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            raw += b'\x3b\x82\xf6\xff'
    idat = png_chunk(b'IDAT', zlib.compress(raw))
    iend = png_chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

icons_dir = r'E:\workspaces\typedance\apps\desktop\src-tauri\icons'
os.makedirs(icons_dir, exist_ok=True)

# Create PNG icons
for size in [32, 128, 256]:
    png = make_png(size, size)
    with open(os.path.join(icons_dir, f'{size}x{size}.png'), 'wb') as f:
        f.write(png)
    print(f'{size}x{size}.png: {len(png)} bytes')

# Create ICO (PNG-in-ICO format)
png32 = make_png(32, 32)
header = struct.pack('<HHH', 0, 1, 1)
entry = struct.pack('<BBBBHHII', 32, 32, 0, 0, 1, 32, len(png32), 22)
with open(os.path.join(icons_dir, 'icon.ico'), 'wb') as f:
    f.write(header + entry + png32)
print(f'icon.ico: {6 + 16 + len(png32)} bytes')
print('All icons created.')
