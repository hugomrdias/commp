//! Records the compiler version and RUSTFLAGS for `commp-rust info`

use std::process::Command;

fn main() {
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".into());
    let version = Command::new(rustc)
        .arg("--version")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let flags = std::env::var("CARGO_ENCODED_RUSTFLAGS").unwrap_or_default();
    println!("cargo:rustc-env=RUSTC_VERSION={version}");
    println!("cargo:rustc-env=COMMP_RUSTFLAGS={}", flags.replace('\x1f', " ").replace('"', "'"));
    println!("cargo:rerun-if-env-changed=CARGO_ENCODED_RUSTFLAGS");

    // Versions of the crates that do the hashing, from Cargo.lock
    let lock = std::fs::read_to_string("Cargo.lock").unwrap_or_default();
    let deps: Vec<String> = lock
        .split("[[package]]")
        .filter_map(|pkg| {
            let field = |key: &str| {
                pkg.lines()
                    .find_map(|l| l.strip_prefix(key)?.strip_prefix(" = \"")?.strip_suffix('"'))
            };
            let name = field("name")?;
            ["commp-wasm", "sha2", "cpufeatures"]
                .contains(&name)
                .then(|| format!(r#""{name}":"{}""#, field("version").unwrap_or("?")))
        })
        .collect();
    println!("cargo:rustc-env=COMMP_DEPS={}", deps.join(","));
    println!("cargo:rerun-if-changed=Cargo.lock");
}
