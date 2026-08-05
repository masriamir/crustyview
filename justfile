# crustyview
set shell := ["bash", "-uc"]

# Build the workspace
build:
    cargo build --workspace

# Run tests (the WAD sweep skips unless CRUSTYVIEW_WAD_DIR is set)
test:
    cargo test --workspace --all-features

# Lint: fmt check + clippy (native and wasm)
lint:
    cargo fmt --all --check
    cargo clippy --workspace --all-targets --all-features -- -D warnings
    cargo clippy -p crustyview --target wasm32-unknown-unknown -- -D warnings

# Auto-format
fmt:
    cargo fmt --all

# Build the browser wasm bundle
wasm-build:
    cd crates/crustyview && wasm-pack build --target web --out-dir web/pkg

# Build + serve the spike page at http://localhost:8080/
serve: wasm-build
    python3 -m http.server -d crates/crustyview/web 8080

# Native sweep over a local WAD directory: just sweep dir=/abs/path
sweep dir:
    CRUSTYVIEW_WAD_DIR={{dir}} cargo test -p crustyview --test wad_sweep -- --nocapture

# Headless wasm sweep (drives analyze/first_texture_rgba): just sweep-wasm dir=/abs/path
sweep-wasm dir:
    cd crates/crustyview && wasm-pack build --target nodejs --out-dir web/pkg-node && node ../../scripts/wasm-sweep.cjs {{dir}}

# Fetch Freedoom (GPL) WADs into a directory
fetch-freedoom dir=".freedoom" version="0.13.0":
    ./scripts/fetch-freedoom.sh {{dir}} {{version}}
