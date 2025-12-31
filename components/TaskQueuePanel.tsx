import React from "react";

type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

type TaskItem = {
  id: string;
  kind: string;
  status: TaskStatus;
  prompt: string;
  boardName?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: string;
  error?: string;
};

const statusMeta: Record<
  TaskStatus,
  { label: string; cls: string }
> = {
  queued: { label: "排队中", cls: "bg-white/10 text-white/80 border-white/10" },
  running: { label: "进行中", cls: "bg-blue-500/20 text-blue-100 border-blue-400/20" },
  succeeded: { label: "已完成", cls: "bg-emerald-500/20 text-emerald-100 border-emerald-400/20" },
  failed: { label: "失败", cls: "bg-red-500/20 text-red-100 border-red-400/20" },
  canceled: { label: "已取消", cls: "bg-white/10 text-white/60 border-white/10" },
};

const kindLabel = (kind: string): string => {
  if (kind === "image.generate") return "图片生成";
  if (kind === "image.edit") return "图片编辑";
  if (kind === "video.generate") return "视频生成";
  return kind;
};

const formatClock = (ts: number): string => {
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
};

const previewText = (value: string, maxLen = 72): string => {
  const s = String(value ?? "").trim().replace(/\s+/g, " ");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1))}…`;
};

export const TaskQueuePanel: React.FC<{
  tasks: TaskItem[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onCancelQueued: (taskId: string) => void;
  onRemoveTask: (taskId: string) => void;
  onClearFinished: () => void;
  onFocusBoard?: (boardId: string) => void;
  getBoardId?: (taskId: string) => string | null;
}> = ({
  tasks,
  collapsed,
  onToggleCollapsed,
  onCancelQueued,
  onRemoveTask,
  onClearFinished,
  onFocusBoard,
  getBoardId,
}) => {
  const runningCount = tasks.filter((t) => t.status === "running").length;
  const queuedCount = tasks.filter((t) => t.status === "queued").length;
  const hasFinished = tasks.some((t) => ["succeeded", "failed", "canceled"].includes(t.status));

  const visible = tasks.length > 0 || runningCount > 0 || queuedCount > 0;
  if (!visible) return null;

  const sorted = [...tasks].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  return (
    <div className="absolute top-16 right-4 z-50 w-[420px] max-w-[calc(100vw-2rem)]">
      <div className="backdrop-blur-xl bg-neutral-900/70 border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-white">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="text-sm font-medium">任务队列</div>
          <div className="flex items-center gap-2 text-xs text-white/70">
            <span>运行 {runningCount} · 排队 {queuedCount}</span>
            <button
              onClick={onToggleCollapsed}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 border border-white/10"
            >
              {collapsed ? "展开" : "收起"}
            </button>
            <button
              onClick={onClearFinished}
              disabled={!hasFinished}
              className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 border border-white/10 disabled:opacity-40 disabled:hover:bg-white/10"
            >
              清理完成
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="max-h-[60vh] overflow-auto bp-scrollbar">
            {sorted.map((task) => {
              const meta = statusMeta[task.status];
              const canCancel = task.status === "queued";
              const canRemove = task.status !== "running" && task.status !== "queued";
              const boardId = getBoardId ? getBoardId(task.id) : null;
              const canFocusBoard = Boolean(onFocusBoard && boardId);

              return (
                <div key={task.id} className="px-4 py-3 border-b border-white/10 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${meta.cls}`}>
                        {meta.label}
                      </span>
                      <span className="text-xs text-white/80">{kindLabel(task.kind)}</span>
                      <span className="text-xs text-white/40">{formatClock(task.createdAt)}</span>
                      {task.boardName && (
                        <button
                          type="button"
                          disabled={!canFocusBoard}
                          onClick={() => boardId && onFocusBoard?.(boardId)}
                          className="text-xs text-white/50 hover:text-white/80 disabled:hover:text-white/50 truncate max-w-[120px]"
                          title={task.boardName}
                        >
                          · {task.boardName}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {canCancel && (
                        <button
                          onClick={() => onCancelQueued(task.id)}
                          className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/15 border border-white/10"
                        >
                          取消
                        </button>
                      )}
                      {canRemove && (
                        <button
                          onClick={() => onRemoveTask(task.id)}
                          className="text-xs px-2 py-1 rounded bg-white/10 hover:bg-white/15 border border-white/10"
                        >
                          移除
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 text-sm text-white/90 break-words">
                    {previewText(task.prompt)}
                  </div>

                  {task.progress && task.status === "running" && (
                    <div className="mt-1 text-xs text-white/60">{task.progress}</div>
                  )}
                  {task.error && task.status === "failed" && (
                    <div className="mt-1 text-xs text-red-200/90">{task.error}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
