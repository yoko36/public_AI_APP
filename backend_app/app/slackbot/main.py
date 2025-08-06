import os
import requests
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler


SLACK_API_KEY = os.environ["SLACK_API_KEY"]
SLACK_SIGNING_SECRET = os.environ["SLACK_SIGNING_SECRET"]
SLACK_APP_TOKEN = os.environ["SLACK_APP_TOKEN"]
CUSTOM_API_URL = "http://localhost:8000/api/agent"

# Slack Bolt 初期化
app = App(token=SLACK_API_KEY)


# メッセージを受け取った際の処理
@app.event("message")
def handle_message(body, say):
    event = body.get("event", {})
    user_id = event.get("user")
    text = event.get("text", "")

    # Bot自身のメッセージは無視
    if user_id is None or event.get("bot_id"):
        return

    # 会話方式で通信
    req_format = {"messages": [{"role": "user", "content": text}]}

    # 自作APIに問い合わせ
    try:
        res = requests.post(CUSTOM_API_URL, json=req_format)
        reply_text = res.json().get("reply", "エラーが発生しました!!!!!")
    except Exception as e:
        reply_text = f"API呼び出しエラー: {e}"

    # Slackに返信
    say(reply_text)


if __name__ == "__main__":
    handler = SocketModeHandler(app, SLACK_APP_TOKEN)
    handler.start()
