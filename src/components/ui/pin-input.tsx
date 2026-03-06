"use client";

import { Eye, EyeOff } from "lucide-react";
import { type CSSProperties, useState } from "react";

import { cn, normalizePin } from "@/lib/utils";

interface PinInputProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  autoComplete?: string;
  className?: string;
  placeholder?: string;
}

export function PinInput({
  value,
  onChange,
  required,
  disabled,
  id,
  name,
  autoComplete,
  className,
  placeholder,
}: PinInputProps) {
  const [showPin, setShowPin] = useState(false);
  const maskedPinStyle = showPin
    ? undefined
    : ({ WebkitTextSecurity: "disc" } as CSSProperties);

  return (
    <div className="relative">
      <input
        required={required}
        disabled={disabled}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete ?? "off"}
        autoCorrect="off"
        spellCheck={false}
        style={maskedPinStyle}
        onChange={(event) => onChange(normalizePin(event.target.value))}
        className={cn(
          "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 pr-11 text-slate-900 outline-none transition focus:border-cyan-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100",
          className,
        )}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => setShowPin((current) => !current)}
        aria-label={showPin ? "Hide PIN" : "Show PIN"}
        title={showPin ? "Hide PIN" : "Show PIN"}
        className="absolute inset-y-0 right-2 flex items-center rounded-md px-1.5 text-slate-500 transition hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {showPin ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
      </button>
    </div>
  );
}
