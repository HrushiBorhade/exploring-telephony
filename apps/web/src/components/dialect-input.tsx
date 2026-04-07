"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface DialectInputProps {
  value: string[];
  onChange: (dialects: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function DialectInput({
  value,
  onChange,
  disabled,
  placeholder = "Type a dialect and press Enter",
}: DialectInputProps) {
  const [input, setInput] = useState("");

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed]);
        setInput("");
      }
    }
    if (e.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function remove(dialect: string) {
    onChange(value.filter((d) => d !== dialect));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((d) => (
          <Badge key={d} variant="secondary" className="gap-1 pr-1">
            {d}
            <button
              type="button"
              onClick={() => remove(d)}
              disabled={disabled}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
              aria-label={`Remove ${d}`}
            >
              <X className="size-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : "Add another..."}
        maxLength={30}
      />
    </div>
  );
}
