// Shared am-I-the-CLI-entrypoint guard for every engine script (single-sourced so the subtle parts
// live in ONE tested place). The naive `import.meta.url === \`file://${argv[1]}\`` breaks two ways:
//   1. paths with spaces/special chars (import.meta.url is percent-encoded; the template is not);
//   2. SYMLINKS — import.meta.url is the module's REALPATH, argv[1] is the literal invocation path
//      (macOS /tmp and /var are symlinks, and the-foreman's project deployment is itself a
//      `.claude/skills/the-foreman -> ../../skills/the-foreman` symlink), so the guard silently
//      no-ops: the CLI "runs", does nothing, exits 0.
// Fix: realpath the argv side before URL-ifying, so both sides are canonical. Fail-closed: any
// resolution error means "not the entrypoint" (library import), never a crash.
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function isMain(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return metaUrl === pathToFileURL(realpathSync(argv1)).href;
  } catch {
    return false;
  }
}
