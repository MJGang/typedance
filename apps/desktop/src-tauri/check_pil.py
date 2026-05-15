import subprocess, sys
result = subprocess.run([sys.executable, '-m', 'pip', 'show', 'Pillow'], capture_output=True, text=True)
print(result.stdout + result.stderr)
