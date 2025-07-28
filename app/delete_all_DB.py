import shutil
import os

persist_dir = "./chroma_db"

if os.path.exists(persist_dir):
    shutil.rmtree(persist_dir)
    print(f"ディレクトリ '{persist_dir}' を削除しました。")
else:
    print(f"ディレクトリ '{persist_dir}' は存在しません。")