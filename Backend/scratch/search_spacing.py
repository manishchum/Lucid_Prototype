import os

def search_text(root_dir, search_str):
    exclude_dirs = {'.venv', 'venv', '.git', 'node_modules', '.next', 'dist', '.expo', '__pycache__'}
    found_any = False
    for root, dirs, files in os.walk(root_dir):
        # Modify dirs in-place to prune excluded directories
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            if file.endswith(('.py', '.js', '.ts', '.tsx', '.jsx', '.json', '.css', '.html', '.md')):
                filepath = os.path.join(root, file)
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        for line_num, line in enumerate(f, 1):
                            if search_str in line:
                                print(f"Found in {filepath} at line {line_num}: {line.strip()}")
                                found_any = True
                except Exception as e:
                    pass
    if not found_any:
        print(f"No occurrences of '{search_str}' found.")

if __name__ == "__main__":
    search_text("D:\\workfloww.ai", "spacing(8)")
