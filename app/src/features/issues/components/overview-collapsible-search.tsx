import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

/** Compact search icon that expands into an input; `/` focuses, Esc collapses when empty. */
export function OverviewCollapsibleSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    inputRef.current?.focus();
  }, [expanded]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setExpanded(true);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const collapse = () => {
    setExpanded(false);
    inputRef.current?.blur();
  };

  if (!expanded) {
    return (
      <Button
        type="button"
        variant={value.length > 0 ? "secondary" : "outline"}
        size="sm"
        className="shrink-0"
        aria-label="Search overview"
        title="Search (/)"
        onClick={() => setExpanded(true)}
      >
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="relative min-w-[12rem] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          if (value === "") setExpanded(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            collapse();
          }
        }}
        placeholder="Search by title or id"
        className="pl-9"
        aria-label="Search overview"
      />
    </div>
  );
}
