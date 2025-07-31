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
from langchain_core.runnables import RunnableLambda

# プロンプト読み込み
with open("./prompt.txt", "r") as f:
    text = f.read()
# sourceからドキュメントを読み込む
loader = TextLoader("./source/sample_date.txt", encoding="utf-8")
context = loader.load()

raw_context = "\n\n".join([doc.page_content for doc in context])

# モデルの設定
model = ChatOpenAI(model="gpt-4.1-nano", temperature=0)

# プロンプトの作成
prompt = ChatPromptTemplate.from_template('''\
 以下の文脈だけを踏まえて質問に回答してください。

 文脈: """
 {context}
 """

 質問: {question}
 ''')

chain = RunnableParallel({
    "question": RunnablePassthrough(),
    "context": RunnableLambda(lambda _: raw_context)
}) | prompt | model | StrOutputParser()

response = chain.invoke(text)
print("response: ", response)