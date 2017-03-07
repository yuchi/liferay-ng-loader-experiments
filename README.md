Peer-Dependencies-aware Loader
------------------------------

This is a toy implementation of a module loader which honors Peer Dependencies graphs between packages.

```js
const loader = require('path/to/lib/loader')([ /* list of packages */ ]);

loader.execute('package-name@10.0.0', 'lib/something.js');
```

The APIs are extremely bad. This is just a proof of concept to prove that it is indeed possible to have a flat repository of packages and still honor the packages’ peer dependencies—something that is simply impossible in SystemJS or the EcmaScript Loader Specification.
