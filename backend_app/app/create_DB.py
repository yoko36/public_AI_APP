import os
import torch
import torch.nn as nn
import torch.optim as optim


# LangChainのインポート
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.runnables import RunnableParallel
from langchain_openai import ChatOpenAI

# RAGの検索に使用するドキュメント保存やベクトルデータにするためのパッケージ
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings
from langchain_community.document_loaders import TextLoader
from langchain_community.document_loaders import WebBaseLoader

# 別ファイルからのメソッド読み出し
from create_documents.search_gitlab import load_gitlab_wiki # 引数(target: str, repository_name: str, token: str): ドキュメントのリストを出力
from create_documents.search_gitlab import load_gitlab_issue # 引数(target: str, repository_name: str, token: str): ドキュメントのリストを出力

create_target = input("wiki or issue: ")

# sourceからドキュメントを読み込む
#loader = WebBaseLoader(
#    web_path="https://sites.google.com/view/hppcs-lab/",
#)
#documents = loader.load()

"""
定数
"""
GITLAB_TOKEN = os.getenv("GITLAB_TOKEN")
GITLAB_BASE_URL = os.getenv("GITLAB_BASE_URL")
project_ID = 41
if create_target == "wiki":
    documents = load_gitlab_wiki(GITLAB_BASE_URL, f"api/v4/projects/{project_ID}", GITLAB_TOKEN)
elif create_target == "issue":
    documents = load_gitlab_issue(GITLAB_BASE_URL, f"api/v4/projects/{project_ID}", GITLAB_TOKEN)
else :
    raise ValueError("wikiかissueを選択してください") # 対象が不正or未記入ならエラー出力
print("length: ", len(documents))

# ベクトルデータにする
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
# ドキュメントをベクトルデータにする
db = Chroma.from_documents(documents, embeddings, persist_directory="./chroma_db")
# ベクトルデータから検索する関数を作成
retrive_context = db.as_retriever()

print("データベース内のテキスト数: ", len(db.get()["documents"]))
