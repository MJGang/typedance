try:
    from PIL import Image
    img = Image.new('RGBA', (32, 32), (59, 130, 246, 255))
    img.save(r'E:\workspaces\typedance\apps\desktop\src-tauri\icons\icon.ico', format='ICO', sizes=[(32, 32)])
    print('Pillow ICO success')
except ImportError:
    print('Pillow not installed')
except Exception as e:
    print(f'Error: {e}')
