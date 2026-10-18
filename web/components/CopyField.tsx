"use client";
import { useRef, useState } from "react";
import s from "./copy.module.css";

export default function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState<"yes" | "select" | null>(null);
  const ref = useRef<HTMLElement>(null);
  const copy = () => {
    const done = (how: "yes" | "select") => {
      setCopied(how);
      setTimeout(() => setCopied(null), how === "yes" ? 1800 : 4000);
    };
    if (navigator.clipboard) return navigator.clipboard.writeText(value).then(() => done("yes"), () => select());
    select();
    function select() {
      const r = document.createRange();
      if (ref.current) r.selectNodeContents(ref.current);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(r);
      done("select");
    }
  };
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      <div className={s.row}>
        <code ref={ref} className={s.value}>
          {value.split(/(?<=[/.])/).map((part, i) => (
            <span key={i}>
              {part}
              <wbr />
            </span>
          ))}
        </code>
        <button type="button" onClick={copy} aria-label={`Copy ${label.toLowerCase()}`}>
          {copied === "yes" ? "Copied" : copied === "select" ? "Ctrl+C" : "Copy"}
        </button>
        <span className="srOnly" role="status">
          {copied === "yes" ? `${label} copied` : copied === "select" ? `${label} selected; press Control C to copy` : ""}
        </span>
      </div>
    </div>
  );
}
