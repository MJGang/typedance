import os, sys
info = f'Python: {sys.executable}\nCWD: {os.getcwd()}\n'
d = r'E:\workspaces\typedance\apps\desktop\src-tauri\icons'
info += f'icons dir exists: {os.path.isdir(d)}\n'
with open(r'E:\workspaces\typedance\apps\desktop\src-tauri\python_test.txt', 'w') as f:
    f.write(info)
print(info)
