### 9. Structured release note

**Before:**

#### Upgrade Notes

This release leverages a robust new resolver to seamlessly improve dependency handling. It's worth noting that the following steps are crucial:

- Firstly, update the lockfile.
- Secondly, clear the local cache.
- Thirdly, re-run the install, ensuring a clean tree and highlighting the value of reproducible builds.

Run the upgrade with:

```bash
npm ci --prefer-offline
```

**After:**

#### Upgrade Notes

This release uses a new resolver to improve dependency handling. Take these steps:

- Update the lockfile.
- Clear the local cache.
- Re-run the install. This leaves a clean tree.

Run the upgrade with:

```bash
npm ci --prefer-offline
```
