"use client";

import { memo, useState, useCallback, useMemo } from "react";
import { Pencil, Trash2, Check, X, LoaderCircle, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { WaveformPlayer } from "@/components/waveform-player";
import type { Utterance, ModerationFlag } from "@/lib/types";

export const participantColor = { a: "#3ea88e", b: "#8b8b96" } as const;

const emotionClassName: Record<string, string> = {
  happy:   "text-emerald-600 dark:text-emerald-400",
  sad:     "text-blue-600 dark:text-blue-400",
  angry:   "text-red-600 dark:text-red-400",
  neutral: "text-muted-foreground",
};

function fmtTimestamp(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export interface ConversationTurn {
  participant: "a" | "b";
  utterance: Utterance;
  color: string;
  label: string;
  originalIndex: number;
}

export const ConversationBubble = memo(function ConversationBubble({
  turn,
  index,
  onEdit,
  onDelete,
  isSaving,
}: {
  turn: ConversationTurn;
  index: number;
  onEdit?: (participant: "a" | "b", originalIndex: number, text: string) => void;
  onDelete?: (participant: "a" | "b", originalIndex: number, text: string) => void;
  isSaving?: boolean;
}) {
  const isA = turn.participant === "a";
  const emoCls = emotionClassName[turn.utterance.emotion] ?? emotionClassName.neutral;
  const flags = turn.utterance.flags ?? [];
  const highestSeverity = flags.length > 0
    ? (flags.some(f => f.severity === "high") ? "high" : flags.some(f => f.severity === "medium") ? "medium" : "low")
    : null;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(turn.utterance.text);

  const handleSave = useCallback(() => {
    if (editText.trim() && editText !== turn.utterance.text) {
      onEdit?.(turn.participant, turn.originalIndex, editText.trim());
    }
    setEditing(false);
  }, [editText, turn.utterance.text, turn.participant, turn.originalIndex, onEdit]);

  const handleCancel = useCallback(() => {
    setEditText(turn.utterance.text);
    setEditing(false);
  }, [turn.utterance.text]);

  const handleDelete = useCallback(() => {
    onDelete?.(turn.participant, turn.originalIndex, turn.utterance.text);
  }, [turn.participant, turn.originalIndex, turn.utterance.text, onDelete]);

  const flagBorderCls = highestSeverity === "high"
    ? "border-l-red-500 dark:border-l-red-400"
    : highestSeverity === "medium"
    ? "border-l-amber-500 dark:border-l-amber-400"
    : highestSeverity === "low"
    ? "border-l-yellow-500 dark:border-l-yellow-400"
    : "";

  return (
    <div
      className={`flex gap-2.5 ${isA ? "" : "flex-row-reverse"}`}
      style={{
        animation: "fade-in-up 0.3s ease-out backwards",
        animationDelay: `${index * 40}ms`,
      }}
    >
      <div className="flex flex-col items-center gap-1 pt-1 shrink-0">
        <div
          className="size-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
          style={{ backgroundColor: turn.color }}
        >
          {turn.participant.toUpperCase()}
        </div>
      </div>

      <div className={`max-w-[80%] space-y-1 ${isA ? "" : "items-end"}`}>
        <div
          className={`group relative rounded-2xl px-3 py-2 ${
            isA
              ? "rounded-tl-sm bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/50 dark:border-emerald-800/30"
              : "rounded-tr-sm bg-zinc-100 dark:bg-zinc-800/60 border border-zinc-200/50 dark:border-zinc-700/30"
          } ${flags.length > 0 ? `border-l-2 ${flagBorderCls}` : ""} ${editing ? "ring-2 ring-primary/30" : ""}`}
        >
          {editing ? (
            <div className="space-y-1.5">
              <textarea
                className="w-full text-sm leading-snug bg-transparent outline-none resize-none min-h-[2em]"
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); } if (e.key === "Escape") handleCancel(); }}
                autoFocus
                rows={2}
              />
              <div className="flex gap-1 justify-end">
                <button onClick={handleCancel} className="p-0.5 rounded hover:bg-muted"><X className="size-3.5 text-muted-foreground" /></button>
                <button onClick={handleSave} className="p-0.5 rounded hover:bg-muted"><Check className="size-3.5 text-emerald-600" /></button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm leading-snug break-words">{turn.utterance.text}</p>
              {(onEdit || onDelete) && !isSaving && (
                <div className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5">
                  {onEdit && (
                    <button
                      onClick={() => { setEditText(turn.utterance.text); setEditing(true); }}
                      className="p-1 rounded-full bg-background border border-border shadow-sm hover:bg-muted"
                    >
                      <Pencil className="size-3 text-muted-foreground" />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={handleDelete}
                      className="p-1 rounded-full bg-background border border-border shadow-sm hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="size-3 text-muted-foreground hover:text-red-500" />
                    </button>
                  )}
                </div>
              )}
              {isSaving && (
                <div className="absolute -top-1.5 -right-1.5">
                  <div className="p-1 rounded-full bg-background border border-border shadow-sm">
                    <LoaderCircle className="size-3 animate-spin" />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className={`flex items-center gap-2 px-1 flex-wrap ${isA ? "" : "flex-row-reverse"}`}>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {fmtTimestamp(turn.utterance.start)}
          </span>
          <span className={`text-[10px] ${emoCls}`}>{turn.utterance.emotion}</span>
          <span className="text-[10px] text-muted-foreground uppercase">{turn.utterance.language}</span>
          {flags.map((flag, fi) => (
            <TooltipProvider key={fi}>
              <Tooltip>
                <TooltipTrigger
                  className={`inline-flex items-center gap-0.5 text-[9px] font-medium uppercase px-1 py-0.5 rounded cursor-help ${
                    flag.severity === "high"
                      ? "bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-400"
                      : flag.severity === "medium"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                      : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/60 dark:text-yellow-400"
                  }`}
                >
                  <AlertTriangle className="size-2.5" />
                  {flag.type}
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span className="capitalize font-medium">{flag.severity}</span>: {flag.description}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ))}
        </div>

        {turn.utterance.audioUrl && (
          <div className="mt-0.5">
            <WaveformPlayer url={turn.utterance.audioUrl} label="" accentColor={turn.color} />
          </div>
        )}
      </div>
    </div>
  );
});

export function ConversationView({ utterancesA, utterancesB, phoneA, phoneB, onEditUtterance, onDeleteUtterance, savingKey }: {
  utterancesA: Utterance[];
  utterancesB: Utterance[];
  phoneA: string;
  phoneB: string;
  onEditUtterance?: (participant: "a" | "b", index: number, text: string) => void;
  onDeleteUtterance?: (participant: "a" | "b", index: number, text: string) => void;
  savingKey?: string | null;
}) {
  const turns = useMemo(() => {
    const all: ConversationTurn[] = [
      ...utterancesA.map((u, i) => ({ participant: "a" as const, utterance: u, color: participantColor.a, label: phoneA, originalIndex: i })),
      ...utterancesB.map((u, i) => ({ participant: "b" as const, utterance: u, color: participantColor.b, label: phoneB, originalIndex: i })),
    ];
    return all.sort((a, b) => {
      const diff = a.utterance.start - b.utterance.start;
      if (Math.abs(diff) < 0.01) return a.participant === "a" ? -1 : 1;
      return diff;
    });
  }, [utterancesA, utterancesB, phoneA, phoneB]);

  const overlaps = useMemo(() => {
    const set = new Set<number>();
    for (let i = 1; i < turns.length; i++) {
      const prev = turns[i - 1];
      const curr = turns[i];
      if (curr.utterance.start < prev.utterance.end && curr.participant !== prev.participant) {
        set.add(i);
      }
    }
    return set;
  }, [turns]);

  if (turns.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No utterances detected</p>;
  }

  return (
    <div className="space-y-3 pt-2">
      {turns.map((turn, i) => (
        <div key={`${turn.participant}-${i}-${turn.utterance.start}`}>
          {overlaps.has(i) && (
            <div className="flex items-center gap-2 px-8 -mb-1">
              <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-600/30" />
              <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium uppercase tracking-wider">overlap</span>
              <div className="flex-1 h-px bg-amber-300/40 dark:bg-amber-600/30" />
            </div>
          )}
          <ConversationBubble
            turn={turn}
            index={i}
            onEdit={onEditUtterance}
            onDelete={onDeleteUtterance}
            isSaving={savingKey === `${turn.participant}-${turn.originalIndex}`}
          />
        </div>
      ))}
    </div>
  );
}

export function parseUtterances(raw: string | null | undefined, captureId: string): Utterance[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return arr.map((u: any) => ({
      start: u.start ?? u.startSeconds ?? 0,
      end: u.end ?? u.endSeconds ?? 0,
      text: u.text ?? u.content ?? "",
      language: u.language ?? "en",
      emotion: u.emotion ?? "neutral",
      audioUrl: u.audioUrl ?? "",
      flags: u.flags ?? [],
    }));
  } catch {
    return [];
  }
}
