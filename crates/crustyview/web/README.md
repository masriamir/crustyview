# crustyview web spike

Easiest: from the repo root, `just serve` builds the bundle and serves it, then
open http://localhost:8080/ and load a WAD.

Manual equivalent — run both commands from the crate directory
(`crates/crustyview`), so that `-d web` resolves to this folder:

    wasm-pack build --target web --out-dir web/pkg
    python3 -m http.server -d web 8080

The WAD is parsed entirely client-side; it never leaves your machine.
