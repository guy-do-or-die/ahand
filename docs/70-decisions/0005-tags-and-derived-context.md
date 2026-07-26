# ADR-0005: Use one tag namespace and derive context

Status: accepted

## Context

A Hand already has a globally unambiguous `HandRef`. Adding one minted `contextRef` per Hand would duplicate identity, and maintaining separate "context" and "tag" vocabularies would create overlapping namespaces without an enforceable semantic distinction.

## Decision

There is one tag namespace and no minted context object. Core treats tag ids as opaque `bytes32` values: a Public or Preview Hand may carry up to `MAX_PUBLIC_TAGS = 8` tags, strictly ascending, unique, and non-zero, emitted via `HandTagged`. Core never requires a tag to resolve to anything.

A context is not minted. Applications derive it by joining:

```text
HandRef + Core facts + metadata/schema + tags + route actors + Signals
```

Tags are attributed classifications, not protocol facts or owned meanings. A shared human-readable tag registry (for example under an ENS namespace such as `tag.ahand.eth`) is future work; nothing deployed depends on one, and no declaration grants exclusive semantic ownership of a tag.

## Consequences

### Positive

- One interaction identifier and one reusable vocabulary remain understandable.
- The same tag can classify a Hand or explain a Signal, with event position supplying meaning.
- Competing applications can derive different contexts without changing Core.
- No resolver failure can censor Raise or settlement.

### Negative

- Spam, synonyms, conflicting definitions, and curator choice remain application problems.
- A tag alone cannot prove that its classification is true.
- Permanent public tags can leak sensitive context.

## Alternatives rejected

- **One context token per Hand:** duplicates `HandRef` and implies ownership of an interaction.
- **Separate context and tag namespaces:** creates ambiguous overlap.
- **Canonical protocol ontology:** gives Core semantic governance it does not need.
- **Transferable tag NFTs:** turns common meanings into property.

## References

- [Tags, context, and Signals](../10-model/tags-context-and-signals.md)
- [Events and indexing](../20-protocol/events-and-indexing.md)

## Revisit when

If two semantic object classes acquire demonstrably different lifecycle, authority, and verification rules that event position and publisher provenance cannot express.
