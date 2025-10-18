import os, uuid, time
from storage3.utils import StorageException
from fastapi import (
    APIRouter,
    UploadFile,
    File,
    HTTPException,
    Depends,
    Form,
    BackgroundTasks,
    Request,
)
from workers.ingest_RAG_document import ingest_from_storage
from supabase import create_client, Client
from deps import bearer_token
from crud import SupaRest

router = APIRouter(tags=["attachments"])

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]  # server-only
STORAGE_BUCKET = os.getenv("STORAGE_PRIVATE_BUCKET", "private")


# supabaseにアクセスできるクライアントの作成
def sb_admin() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# 指定したストレージ（バケット）が存在しない場合、プライベートバケットを新規に作成する
def ensure_bucket(sb: Client, bucket: str, public: bool = False):
    try:
        sb.storage.get_bucket(bucket)  # あれば何もしない
        return
    except Exception:
        pass
    # SDKのバージョン差異に対応（新: keyword、旧: dict）
    try:
        sb.storage.create_bucket(bucket, public=public)
    except TypeError:
        sb.storage.create_bucket(bucket, {"public": str(public).lower()})
    except Exception as e:
        if "already exists" not in str(e).lower():
            raise


@router.post("/attachments")
async def upload_attachment(
    bg: BackgroundTasks,
    request: Request,
    file: UploadFile = File(...),
    thread_id: str = Form(...),
    token: str = Depends(bearer_token),
):
    """
    1) Storage(private) へ保存（物理キーは attachment_id 基点 / thread_id 非依存）
    2) app.attachments へメタ登録
    3) 署名URLを返却（閲覧期限つき）
    """
    phase = "start"
    try:
        # ===== 1) Storage アップロード =====
        phase = "init_supabase_admin_client"
        sb = sb_admin()
        ensure_bucket(sb, STORAGE_BUCKET, public=False)

        # === ファイル読み込み ===
        phase = "read_file"
        data = await file.read()
        if not data or len(data) == 0:
            raise HTTPException(status_code=400, detail="phase=read_file: empty file")

        # === ファイルパス（保存先）を作成 ===
        phase = "build_paths"
        att_id = str(uuid.uuid4())
        ext = os.path.splitext(file.filename or "")[1].lower()
        object_path = f"attachments/{att_id}{ext}"  # attachements/<ランダムID>.<拡張子>
        storage_path = f"{STORAGE_BUCKET}/{object_path}"

        # === ファイルをDBストレージに保尊 ===
        phase = "storage_upload_try_upsert"
        try:
            sb.storage.from_(STORAGE_BUCKET).upload(
                object_path,
                data,
                {
                    "content-type": file.content_type or "application/octet-stream",
                    "upsert": "false",  # 文字列で指定が必要なSDK向け
                },
            )
        except StorageException as e1:
            # 400系は "x-upsert" でもう一度試す
            status1 = e1.args[0] if e1.args else {}
            code1 = status1.get("statusCode") if isinstance(status1, dict) else None
            msg1 = status1.get("message") if isinstance(status1, dict) else None
            print("[attachments] upload first failed:", repr(e1))
            if code1 and 400 <= int(code1) < 500:
                phase = "storage_upload_retry_x_upsert"
                try:
                    sb.storage.from_(STORAGE_BUCKET).upload(
                        object_path,
                        data,
                        {
                            "content-type": file.content_type
                            or "application/octet-stream",
                            "x-upsert": "false",
                        },
                    )
                except StorageException as e2:
                    status2 = e2.args[0] if e2.args else {}
                    code2 = (
                        status2.get("statusCode") if isinstance(status2, dict) else None
                    )
                    msg2 = status2.get("message") if isinstance(status2, dict) else None
                    print(
                        "[attachments] upload retry failed:",
                        repr(e2),
                        "mime=",
                        file.content_type,
                        "size=",
                        len(data),
                        "path=",
                        object_path,
                    )
                    raise HTTPException(
                        status_code=code2 or 500,
                        detail=f"phase={phase}: storage upload failed: {msg2 or 'unknown'}",
                    ) from e2
            else:
                raise HTTPException(
                    status_code=code1 or 500,
                    detail=f"phase={phase}: storage upload failed: {msg1 or 'unknown'}",
                ) from e1

        # ===== 2) DB 紐づけ =====
        phase = "fetch_thread_project"
        client = SupaRest(token)  # データベース操作（CRUD）を行うクライアントを取得
        try:
            trow = await client.get_one(
                "threads",
                select="project_id",
                id=thread_id,
                accept_profile="app",
            )  # 指定したスレッドIDのスレッドを取得
        except Exception as e:
            print("[attachments] get_one(threads) error:", repr(e))
            raise HTTPException(
                status_code=400, detail=f"phase={phase}: failed to fetch thread"
            ) from e
        if not trow:
            raise HTTPException(
                status_code=404, detail=f"phase={phase}: thread not found"
            )
        project_id = trow["project_id"]

        phase = "insert_attachment_row"
        try:
            # 物理キーは att_id 基点で確定済みなので、そのまま格納
            att = await client.rpc(
                "add_attachment",
                {
                    "in_storage_path": storage_path,  # 物理キー（主キー）
                    "in_mime": file.content_type or "application/octet-stream",
                    "in_size": len(data),
                    "in_title": file.filename or "ファイル",
                    "in_project_id": project_id,  # 任意（null可）
                    "in_thread_id": thread_id,  # 任意（null可）
                },
                accept_profile="app",
            )
            att_id = (
                att["id"] if isinstance(att, dict) else att[0]["id"]
            )  # テーブル定義に合わせて取得
        except Exception as e:
            print("[attachments] insert attachment error:", repr(e))
            raise HTTPException(
                status_code=400, detail=f"phase={phase}: failed to insert attachment"
            ) from e

        # ===== 3) 署名URL =====
        phase = "create_signed_url"
        try:
            signed = sb.storage.from_(STORAGE_BUCKET).create_signed_url(
                object_path, 600
            )
            if isinstance(signed, dict):
                if signed.get("error"):
                    msg = (
                        signed["error"].get("message")
                        if isinstance(signed["error"], dict)
                        else str(signed["error"])
                    )
                    raise RuntimeError(msg or "signed url failed")
                signed_url = (
                    signed.get("signedURL")
                    or signed.get("signedUrl")
                    or signed.get("url")
                )
            else:
                signed_url = (
                    getattr(signed, "signedURL", None)
                    or getattr(signed, "signedUrl", None)
                    or getattr(signed, "url", None)
                )
            if not signed_url:
                raise RuntimeError("signed url empty")
        except Exception as e:
            print("[attachments] create_signed_url error:", repr(e))
            raise HTTPException(
                status_code=500, detail=f"phase={phase}: failed to create signed url"
            ) from e

        # ===== 4) レスポンスを返した後のタスク処理 =====
        # ここでは、ingest_from_storageを使用して、RAG用のベクトルデータベースを作成する
        phase = "enqueue_ingest_task"
        bg.add_task(
            ingest_from_storage,
            storage_bucket=STORAGE_BUCKET,
            object_path=object_path,
            project_id=project_id,
            attachment_id=att_id,
            title=(file.filename or "Untitled"),
            mime=(file.content_type or "application/octet-stream"),
        )

        # ===== OK =====
        phase = "complete"
        return {
            "id": att_id,
            "threadId": thread_id,
            "projectId": project_id,
            "path": storage_path,
            "url": signed_url,
            "mime": file.content_type or "application/octet-stream",
            "size": len(data),
        }

    except HTTPException:
        raise
    except Exception as e:
        import traceback

        tb = traceback.format_exc()
        print(
            "[attachments] unexpected error at phase:", phase, "err=", repr(e), "\n", tb
        )
        raise HTTPException(status_code=500, detail=f"phase={phase}: unexpected error")
