import requests
from langchain_core.documents import Document

def load_gitlab_wiki(base_url: str, repository_name: str, token: str) -> list[Document]:
    url = f"{base_url}/{repository_name}/wikis/" # エンドポイント(wikiのhomeページ)
    headers = {"PRIVATE-TOKEN": token} # アクセストークン
    params = {"with_content": 1} # wikiのテキスト(MarkDown)
    res = requests.get(url, headers=headers, params=params) # gitlabにアクセス
    res.raise_for_status() # エラーハンドリング

    count = 0
    docs = [] # 取得したドキュメントを保存する配列
    for page in res.json():
        title = page.get("title", "Untitled") # タイトルの取得
        content = page.get("content", "") # ページの本文の取得
        slug = page.get("slug", "") # URLの識別子の取得
        full_url = f"{base_url}/{page.get('url', '')}".replace("//", "/").replace(":/", "://")
        print("タイトル", title)
        # 取得したwikiのデータをdocsに保存
        docs.append(Document(
            page_content=f"# {title}\n\n{content}",
            metadata={
                "source": "gitlab_wiki",
                "title": title,
                "slug": slug,
                "url": full_url
            }
        ))
        print(f"{count} / {len(res.json())}")
        count += 1
    print(f"{count} / {count}")
    print(f"読み込んだwikiの数: {len(docs)}")
    return docs

    
def load_gitlab_issue(base_url: str, repository_name: str, token: str) -> list[Document]:
    url = f"{base_url}/{repository_name}/issues/" # エンドポイント(wikiのhomeページ)
    headers = {"PRIVATE-TOKEN": token} # アクセストークン
#    params = {"with_content": 1} # wikiのテキスト(MarkDown)
    res = requests.get(url, headers=headers) # gitlabにアクセス
    res.raise_for_status() # エラーハンドリング
    count = 0
    docs = [] # 取得したドキュメントを保存する配列
    for issue in res.json():
        print(f"タイトル: {issue['title']}")
        # 取得したwikiのデータをdocsに保存
        docs.append(Document(
            page_content=f"# {issue['title']}\n\n{issue.get('description', '')}",
            metadata={
            "id": f"issue_{issue['iid']}",
            "url": issue.get("web_url"),
            "created_at": issue.get("created_at"),
            "updated_at": issue.get("updated_at"),
            "author": issue['author']['username'],
            "source": "gitlab_issue"
            }
        ))
        print(f"{count} / {len(res.json())}")
        count += 1
    print(f"{count} / {count}")
    print(f"読み込んだissueの数: {len(docs)}")
    return docs
