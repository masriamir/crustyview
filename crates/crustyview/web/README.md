# crustyview web spike

Build: `wasm-pack build --target web --out-dir web/pkg` (run from the crate dir).
Serve: `python3 -m http.server -d web 8080`, then open http://localhost:8080/ and load a WAD.

The WAD is parsed entirely client-side; it never leaves your machine.
