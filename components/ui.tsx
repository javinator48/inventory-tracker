"use client";

import { X } from "lucide-react";
import { useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

export function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

export function Button({ variant = "secondary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
        size === "md" ? "h-11 px-4 text-sm" : "h-9 px-3 text-sm",
        variant === "primary" && "bg-accent text-accent-fg hover:brightness-110",
        variant === "secondary" && "bg-surface-2 text-foreground hover:bg-border",
        variant === "ghost" && "text-foreground hover:bg-surface-2",
        variant === "danger" && "bg-surface-2 text-bad hover:bg-border",
        className,
      )}
    />
  );
}

const fieldClass =
  "w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-muted/70 outline-none focus:border-accent focus:ring-2 focus:ring-accent/25";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldClass, className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldClass, "min-h-20 resize-y", className)} />;
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/** Bottom sheet on phones, centered dialog on wider screens. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl bg-surface shadow-xl sm:max-w-lg sm:rounded-3xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 className="min-w-0 truncate text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="-mr-2 rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="border-t border-border px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL = { owned: "Owned", for_sale: "For sale", sold: "Sold", considering: "Wishlist" } as const;

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        status === "owned" && "bg-surface-2 text-muted",
        status === "for_sale" && "bg-accent/15 text-accent",
        status === "sold" && "bg-good/15 text-good",
        status === "considering" && "bg-warn/15 text-warn",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)}
      aria-hidden
    />
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{children}</p>;
}
