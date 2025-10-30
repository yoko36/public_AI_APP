# public_AI_APP(開発リポジトリの公開用クローン)

研究支援のための **生成AI + RAG** チャットアプリ。  
フロント（Next.js）／バックエンド（FastAPI）／DB（Supabase + pgvector）を **Docker** で動かす構成です。

---

## 1. 各アプリケーションの簡単な説明

### `frontend_app/`（フロントエンド）
- **役割**: チャットUI、プロジェクト/スレッド管理、ログイン画面、簡易ファイル操作
- **構成**
  - App Router 構成 `app/agent/...`
    - `agent/chat/[threadId]/` : スレッド別のチャット画面
    - `agent/admin/` `agent/history/` `agent/files/` などの補助ページ(未実装を含む)
  - `app/api/...` : Next.js 側のAPIエンドポイント（チャット送信、ファイルアップロード等）
  - `middleware.ts` : 認証クッキーの判定など軽量ガード
  - `components/` `lib/` `store/` : UIコンポーネント、ユーティリティ、状態管理の分離

### `backend_app/`（バックエンド）
- **役割**: 認証・RAG検索・生成応答・SSEストリーミング・埋め込み/検索のサーバ処理
- **構成**
  - `app/chat_system/` : チャット中核（RAGchat・エージェント・対話制御）
  - `app/services/` : OpenAIクライアント／ベクトル検索（Supabase RPC/pgvector）
  - `app/workers/` : ドキュメントの抽出→分割→埋め込み→ベクトル格納のバッチ処理
  - `app/utils/` : 文脈構築・SSEユーティリティ
  - `crud.py` : PostgREST 経由のAPI呼び出し（Accept-Profile/Content-Profile ヘッダ等を統一）

### `supabase/`（データベース / インフラ）
- **役割**: PostgreSQL + pgvector によるデータ/ベクトル管理、認証（GoTrue）、REST（PostgREST）
- **構成**
  - `docker-compose.yml` : ローカル開発用のセルフホスト一式
  - `dev/` `volumes/` : 開発・永続化用のディレクトリ
  - `supabase/volumes/db/app_data.sql` : アプリケーションに使用する開発時のSQL
- **引用元（Supabase GitHub）**: https://github.com/supabase/supabase

---

## 2. 使用技術（言語 / フレームワーク など）

### 言語
- **TypeScript**（フロントエンド）
- **Python**（バックエンド／ワーカー）

### フロントエンド
- **Next.js (App Router)**
- **React**
- **Tailwind CSS**
- **shadcn/ui（Radixベース）**
- **zustand**（状態管理）
- **react-markdown + remark/rehype + KaTeX**（Markdown/数式表示）
- **lucide-react / sonner**（アイコン／トースト）

### バックエンド
- **FastAPI**
- **OpenAI Python SDK**
- **LangChain**（テキスト分割・埋め込みなどRAG補助）

### データベース / ベクトル検索
- **Supabase（PostgreSQL + pgvector）**  
  引用: https://github.com/supabase/supabase

### インフラ
- **Docker / Docker Compose**

---

> **メモ**  
> APIキー等の機密情報は `.env` で管理し、リポジトリには含めません（`.env.example` のみ同梱）。
