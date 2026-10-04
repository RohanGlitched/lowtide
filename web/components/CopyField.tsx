"use client";
import { useState } from "react";
import s from "./copy.module.css";

export default function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      <div className={s.row}>
        <code className={s.value}>{value}</code>
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            })
          }
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
