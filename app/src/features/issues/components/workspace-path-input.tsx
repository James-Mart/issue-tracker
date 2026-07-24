import { Input } from "@/components/ui/input";

const PLACEHOLDER = "absolute path to git checkout";

export function WorkspacePathInput({
  id,
  value,
  onChange,
  optional,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
}) {
  return (
    <Input
      id={id}
      value={value}
      className="font-mono"
      placeholder={optional ? `${PLACEHOLDER} (optional)` : PLACEHOLDER}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
