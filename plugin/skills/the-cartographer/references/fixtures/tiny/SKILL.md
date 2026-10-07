# tiny

A fixture skill used by the-cartographer's own tests.

## Modes

- `build` — compiles the project before running.
- `check` — runs the core routine and prints `check ran`.

## Outcomes

`PASS` is emitted when the core routine succeeds.

## Internals

`tiny_core` is the shared routine every mode calls.

A dispatch table maps each mode to its function.
