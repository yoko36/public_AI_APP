import os
from typing import AsyncGenerator, List

import torch
import torch.nn as nn
import torch.optim as optim

# LangChainのインポート
from langchain_core.documents import Document
from langchain_core.output_parsers import StrOutputParser
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.runnables import RunnableParallel
from langchain_openai import ChatOpenAI

# RAGの検索に使用するドキュメント保存やベクトルデータにするためのパッケージ
from langchain_chroma import Chroma
from langchain_openai import OpenAIEmbeddings

# from langchain_community.document_loaders import TextLoader
# from langchain_community.document_loaders import WebBaseLoader

# 別ファイルからのメソッド読み出し
from create_documents.search_gitlab import (
    load_gitlab_wiki,
)  # 引数(target: str, repository_name: str, token: str): ドキュメントのリストを出力

# プロンプト読み込み
# with open("./prompt.txt", "r") as f:
#     text = f.read()

# 埋め込みベクトルの復元に使用するモジュール
EMBEDDINGS = OpenAIEmbeddings(model="text-embedding-3-small")
# DBから取得
DB = Chroma(persist_directory="./chroma_db", embedding_function=EMBEDDINGS)
# 類似ベクトル上位3件を取得
RETRIEVER = DB.as_retriever(search_kwargs={"k": 3})

# モデルの設定
GPT4_1_nano = ChatOpenAI(model="gpt-4.1-nano", temperature=0)
GPT4o_mini = ChatOpenAI(model="gpt-4o-mini", temperature=0)
GPT4o = ChatOpenAI(model="gpt-4o", temperature=0)
GPT5 = ChatOpenAI(model="gpt-5", temperature=0)
GPT5_mini = ChatOpenAI(model="gpt-5-mini", temperature=0)
GPT5_nano = ChatOpenAI(model="gpt-5-nano", temperature=0)

MODEL = GPT4_1_nano

# HyDEの実装
# 検索に使用するRAG機能なしの回答を出力
HYPOTHETICAL_PROMPT = ChatPromptTemplate.from_template(
    """\
     次の質問に回答する一文を書いてください。

     質問: {question}
     """
)

PROMPT = ChatPromptTemplate.from_template(
    '''\
     以下の文脈だけを踏まえて質問に回答してください。

     文脈: """
     {context}
     """

     質問: {question}
     '''
)


# def _format_docs(docs: List[Document]) -> str:
#     return "\n\n".join(d.page_content for d in docs)


# -------------------------------------------------
# chainの作成
# -------------------------------------------------

# HYDEのチェーン
HYPO_CHAIN = (
    {"question": RunnablePassthrough()}
    | HYPOTHETICAL_PROMPT
    | MODEL
    | StrOutputParser()
    | RETRIEVER
    # |_format_docs
)
# 最終的なチェーン
CHAIN = (
    RunnableParallel(
        {
            "question": RunnablePassthrough(),
            "context": HYPO_CHAIN,
        }
    )
    | PROMPT
    | MODEL
    | StrOutputParser()
)


async def chat_to_chatbot(input_prompt: str) -> AsyncGenerator[str, None]:
    async for chunk in CHAIN.astream(input_prompt):
        if chunk:
            yield chunk  # 断片的(連続的)に出力する


# invoke版
# def chat_to_chatbot(input_prompt: str) -> str:
#     return CHAIN.invoke(input_prompt)
