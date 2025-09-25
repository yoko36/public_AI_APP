import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useState, type ReactNode } from "react"
import { Plus } from "lucide-react";

export function NewModal({
  className,
  onCreate,
  buttonName,
  isOverviewNeeded,
  icon,
}: {
  className?: string
  onCreate: (name: string, overview?: string) => void
  buttonName: string
  isOverviewNeeded: boolean
  icon?: ReactNode
}) {    
    const [projectName, setProjectName] = useState("")
    const [overview, setOverview] = useState("")
    const [open, setOpen] = useState(false) // ← モーダル開閉状態

    const handleCreate = () => {
        if (projectName.trim()) {   // trimで空判定 
            onCreate(projectName, overview)   // プロジェクト、チャットを新規追加(onCreateは親コンポーネントで決定)
            setProjectName("")      // モーダル内の名前の入力をリセット
            setOverview("")         // モーダル内の概要の入力をリセット
            setOpen(false)          // モーダルを閉じる
        }
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button
                    variant="secondary"
                    className={`w-full justify-start gap-2 ${className ?? "text-xl"}`}
                >
                    {icon ?? <Plus className="w-5 h-5" />}
                    {buttonName}
                </Button>
            </DialogTrigger>
            <DialogContent className="bg-white p-6 shadow-lg sm:rounded-lg z-[9999]" >
                <DialogHeader>
                    <DialogTitle>{buttonName}</DialogTitle>
                    <DialogDescription>
                        {buttonName}名{isOverviewNeeded && "と概要"}を入力してください。
                    </DialogDescription>
                </DialogHeader>
                <Input
                    placeholder="名前を入力"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                />
                {/* isOverviewNeededの値によって概要用のテキストボックスを表示するか設定する */}
                {isOverviewNeeded && (
                    <textarea
                        placeholder="プロジェクト概要を入力"
                        value={overview}
                        onChange={(e) => setOverview(e.target.value)}
                        className="w-full min-h-[100px] p-2 border rounded-md mt-2"
                    />
                )}
                <div className="flex justify-end gap-2 mt-4">
                    <Button
                        variant="outline"
                        className="px-4 py-2 rounded-md"
                        onClick={() => {
                            handleCreate()
                        }}
                    >
                        作成
                    </Button>
                    <Button
                        variant="outline"
                        className="px-4 py-2 rounded-md"
                        onClick={() => {
                            setOpen(false)
                        }}
                    >
                        キャンセル
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
