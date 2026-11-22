# Narrow-width formatting policy

Width-aware review formats both versions of a file to the reader's screen width
before computing the diff. See [width-aware review](../ARCHITECTURE.md#width-aware-review)
for how comparisons are captured and rendered.

## All languages

The requested character width is a target, not a hard limit. Long identifiers,
strings, macros and deeply nested code can still overflow; never truncate code
or split string literals merely to fit a phone screen.

## C and C++

C/C++ uses an explicit LLVM-based display profile with two-space block and
continuation indentation, no tabs or operand alignment, and no packing of
wrapped arguments/parameters. Bracket block indentation avoids aligning
continuations under long function names. Include order is preserved and the
existing comment reflow pass handles prose rather than clang-format.

## Rust

Rust uses stable rustfmt on stdin with two-space indentation and `max_width`
set to the requested width. Its default block layout and wrapping heuristics
handle calls, chains and signatures; no nightly-only options are required.
Imports and modules are not reordered. Ambient rustfmt configuration is ignored
so both historical and current snapshots use the same display profile.

Reviews use best-effort output: exit 0 or 1 is accepted only with nonblank
stdout (opaque macros retaining whitespace can trigger exit 1). Empty input
bypasses rustfmt; empty or whitespace-only output never replaces a nonempty
snapshot, even on exit 0. Stderr is not parsed. This may also accept output
from other internal formatting errors; it is a display policy, not proof of
formatting correctness. Other exit codes, signal termination, launch failures
and timeouts fall back to the original snapshot. String contents are never
trimmed to suppress whitespace errors.

Rust snapshots are parsed as Rust 2024 without Cargo manifest/edition lookup.
Edition-incompatible or malformed code normally produces no output and falls
back to the original text. No filename is passed to rustfmt, so external module
files are not followed or modified. Rust comments (including rustdoc) are left
intact: the generic reflow pass does not understand Rust raw strings or nested
block comments.
