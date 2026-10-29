# Shared ESLint configuration

Flat ESLint 10 configuration with TypeScript recommended rules. The workspace root runs lint once across application and package source.

```js
import base from "@panas/eslint-config";
export default [...base];
```

Uses syntax-aware checks without requiring a TypeScript project service, so configuration scripts and source packages share one entry point. Application-specific rules can extend this array.
