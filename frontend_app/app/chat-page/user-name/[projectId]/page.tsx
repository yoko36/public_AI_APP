"use client";

import { useParams } from "next/navigation";
import ChatPage from "@/components/custom_ui/chat-page";

export default function ChatProjectPage() {
  const { projectId } = useParams();

  return <ChatPage projectId={projectId as string} />;
}