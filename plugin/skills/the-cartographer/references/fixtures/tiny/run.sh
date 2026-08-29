#!/usr/bin/env bash
# tiny — a fixture script used by the-cartographer's own tests. Not wired into anything.
set -euo pipefail

# TINY_DEBUG=1 prints each mode as it starts.
tiny_core() {
  [ "${TINY_DEBUG:-0}" = "1" ] && printf 'core: %s\n' "$1" >&2
  printf 'core ran for %s\n' "$1"
}

mode_check() {
  tiny_core check
  emit_pass
}

# emits PASS on stdout
emit_pass() {
  printf 'PASS\n' >&2
}
# emit_pass: announces PASS on stdout for the caller
case "${1:-}" in
  check) mode_check ;;
  *) printf 'unknown mode; exit 1\n' >&2; exit 2 ;;
esac
