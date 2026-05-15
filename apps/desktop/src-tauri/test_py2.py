import os, sys
info = f'Python: {sys.executable}\nCWD: {os.getcwd()}\n'
info += f'Dir: {os.path.isdir(r"E:\\workspaces\\typedance\\apps\\desktop\\src-tauri")}\n'
out = r'E:\workspaces\typedance\apps\desktop\src-tauri\python_test.txt'
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w') as f:
    f.write(info)
