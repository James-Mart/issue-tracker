import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { SETTINGS_HEADING_CLASS } from "@/features/issues/components/detail-section";
import type {
  CatalogContract,
  CatalogEntry,
  CatalogInjectRow,
} from "@server/services/capability-catalog";

const EMPTY_SETTING_SOURCES =
  "None. Host rules, project rules, and plugin skills do not load.";

function injectLabel(kind: CatalogInjectRow["kind"]): string {
  if (kind === "skill") return "SKILL";
  if (kind === "rule") return "RULE";
  return "ROLE BODY";
}

function ContractSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="border-t border-border px-4 py-3">
      <h3 className={SETTINGS_HEADING_CLASS}>
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function None() {
  return <p className="text-sm text-muted-foreground">None</p>;
}

function NameList({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <None />;
  return (
    <ul className="space-y-1">
      {names.map((name) => (
        <li key={name} className="font-mono text-sm text-foreground">
          {name}
        </li>
      ))}
    </ul>
  );
}

function InjectList({ rows }: { rows: readonly CatalogInjectRow[] }) {
  if (rows.length === 0) return <None />;
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={`${row.kind}:${row.path}`} className="flex items-start gap-2">
          <Badge variant="secondary" className="shrink-0 font-mono">
            {injectLabel(row.kind)}
          </Badge>
          <span className="min-w-0 break-all font-mono text-xs text-foreground">
            {row.path}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SettingSources({ sources }: { sources: readonly string[] }) {
  if (sources.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{EMPTY_SETTING_SOURCES}</p>
    );
  }
  return <NameList names={sources} />;
}

function BuiltinList({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <None />;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <li key={name}>
          <Badge variant="secondary" className="font-mono font-normal">
            {name}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

function ContractFields({ contract }: { contract: CatalogContract }) {
  return (
    <>
      <ContractSection title="Setting sources">
        <SettingSources sources={contract.settingSources} />
      </ContractSection>
      <ContractSection title="Inject">
        <InjectList rows={contract.inject} />
      </ContractSection>
      <ContractSection title="Custom tools">
        <NameList names={contract.customTools} />
      </ContractSection>
      <ContractSection title="Builtins">
        <BuiltinList names={contract.builtins} />
      </ContractSection>
      <ContractSection title="MCP">
        <NameList names={contract.mcp} />
      </ContractSection>
    </>
  );
}

export function CapabilityCatalogContract({ entry }: { entry: CatalogEntry }) {
  return (
    <div data-testid="capability-catalog-contract">
      <header className="px-4 py-3">
        {entry.kind === "role" ? (
          <>
            <h2 className="break-all font-mono text-sm font-medium text-foreground">
              {entry.roleId}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Profile{" "}
              <span className="text-foreground">{entry.profileTitle}</span>
            </p>
          </>
        ) : (
          <h2 className="text-sm font-medium text-foreground">{entry.title}</h2>
        )}
        {entry.description ? (
          <p className="mt-2 text-sm text-muted-foreground">{entry.description}</p>
        ) : null}
      </header>
      <ContractFields contract={entry.contract} />
    </div>
  );
}
