# Subsystem vision-doc trigger

A subsystem earns its own vision doc when both hold:

1. **Persona contact.** One or more personas from the Project `personas`
   catalog interact with it directly — it is a surface someone uses, not
   machinery sitting under one.
2. **Substantial and durable.** It is a lasting concept carrying governing
   decisions that recur across planning, not a one-off.

Size is not the trigger. Machinery no persona touches is an implementation
detail and gets no doc however broad its blast radius; it only has to be built
idiomatically. What that machinery does to the people above it gets documented
under whichever persona-facing surface exposes it, so the index stays organized
by surface rather than by module.

For how many docs when two personas meet the same machinery through different
surfaces, and for the silence-versus-gap escalation test when a subsystem has
no governing vision, see [SPEC.md § Project supporting docs](../../../SPEC.md#project-supporting-docs).

A candidate that fails the trigger still has a home: name the persona-facing
surface whose doc should absorb it.
