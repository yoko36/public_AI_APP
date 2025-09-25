"use client";

import { useParams } from "next/navigation";
import ChatPage from "@/components/custom_ui/chat-page";

export default function ChatProjectPage() {
  const params = useParams();
  const threadId = params.threadId as string;

  return <ChatPage threadId={threadId} />;
}