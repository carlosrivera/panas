# Commit metadata maintenance — 2026-10-30

Published branches and release tags were rewritten to remove automated co-author attribution. Human authorship, commit timestamps, file contents and release source trees were preserved. Release assets, embedded build-source identifiers, installer pins and checksums were not rebuilt or replaced.

An existing artifact reports the original build-source commit below. Its release tag now resolves to the corresponding rewritten commit with the identical Git tree. This table records that correspondence; it does not claim a new build or new validation.

| Release        | Original build-source commit               | Current tag commit                         |
| -------------- | ------------------------------------------ | ------------------------------------------ |
| v0.1.0-alpha.6 | `1c5a8308ae7ce50a2de89d4e9c54ea6c2969bcd4` | `557b7084ce546bdf4109dec395d8e92759a341d7` |
| v0.1.0-alpha.5 | `971c37e26fbd937d72adb386c68fefe6c8548d79` | `5265db213b1d30125597921bc278788110f8b53d` |
| v0.1.0-alpha.4 | `d822bcd1ed63709cbb6f5cd04dfd58afb6658aff` | `6357460f1dffb2148ee61dfa00e7c2aa3d3a982d` |
| v0.1.0-alpha.2 | `07f517b4757a9e62018ca549c83e9e5b97ab6c9a` | `7a7922b08ce1574e9ae21139141e6666b8b4cee6` |
| v0.1.0-alpha.1 | `4c7fc623d78c923132252f4a2fcb2304bb6b348e` | `4b011f28ec366a34575e796daa46e57fc813bd5e` |

## Existing clones

Start from a fresh clone, or preserve uncommitted work and rebase only unpublished work onto the rewritten remote branch. Do not merge the old history or force-push an old clone: that restores the removed metadata. Branches and release tags on the remote are authoritative. A metadata backup is retained privately outside the repository.

Application tests, release smoke checks and deployments remain deferred. Only repository metadata, release source-tree equivalence and published asset metadata were inspected for this maintenance.
