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

# プロンプト読み込み
with open("./prompt.txt", "r") as f:
    text = f.read()

# 埋め込みベクトルの復元に使用するモジュール
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
# DBから取得
db = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)
# 類似ベクトル上位3件を取得
retrieve_context = db.as_retriever(search_kwargs={"k": 3})

# モデルの設定
GPT4_1_nano = ChatOpenAI(model="gpt-4.1-nano", temperature=0)
GPT4o_mini = ChatOpenAI(model="gpt-4o-mini", temperature=0)
GPT4o = ChatOpenAI(model="gpt-4o", temperature=0)

model = GPT4o

# HyDEの実装
# 検索に使用するRAG機能なしの回答を出力
hypothetical_prompt = ChatPromptTemplate.from_template("""\
 次の質問に回答する一文を書いてください。

 質問: {question}
 """)
# chainの作成
hypothetical_chain = hypothetical_prompt | model | StrOutputParser()

prompt = ChatPromptTemplate.from_template('''\
 以下の文脈だけを踏まえて質問に回答してください。

 文脈: """
 {context}
 """

 質問: {question}
 ''')

chain = RunnableParallel({
    "question": RunnablePassthrough(),
    "context": hypothetical_chain | retrieve_context,
}) | prompt | model | StrOutputParser()

response = chain.invoke(text)
print("response: ", response)
print("使用モデル: ", model.model_name)