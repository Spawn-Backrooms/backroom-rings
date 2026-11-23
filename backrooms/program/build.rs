use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{env, fs, path::Path};

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn string<'a>(value: &'a Value, name: &str) -> &'a str {
    value[name]
        .as_str()
        .unwrap_or_else(|| panic!("missing {name}"))
}

fn read(path: &Path) -> Vec<u8> {
    println!("cargo:rerun-if-changed={}", path.display());
    fs::read(path).unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn main() {
    for key in [
        "BACKROOM_RINGS_RELEASE_DIRECTORY",
        "BACKROOM_RINGS_BUILD_APPROVAL_SHA256",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    let production = env::var_os("CARGO_FEATURE_PRODUCTION").is_some();
    let compile_profile = env::var_os("CARGO_FEATURE_RELEASE_CIRCUITS").is_some();
    assert!(
        !production || !compile_profile,
        "release-circuits cannot build a production executable"
    );
    let release_profile = production || compile_profile;
    assert!(
        !production || env::var_os("CARGO_FEATURE_INSECURE_TEST_SETUP").is_none(),
        "production cannot enable insecure-test-setup"
    );
    let root = env::var("CARGO_MANIFEST_DIR").unwrap();
    let root = Path::new(&root);
    let release = env::var("BACKROOM_RINGS_RELEASE_DIRECTORY").ok();
    assert!(
        release_profile || release.is_none(),
        "release inputs require a release profile"
    );
    let release = release_profile.then(|| {
        Path::new(
            release
                .as_deref()
                .expect("release profile requires BACKROOM_RINGS_RELEASE_DIRECTORY"),
        )
    });
    let identity_path = release.map_or_else(
        || root.join("identity/development.json"),
        |directory| directory.join("deployment/identity.json"),
    );
    let identity_bytes = read(&identity_path);
    let identity: Value =
        serde_json::from_slice(&identity_bytes).expect("invalid deployment identity");
    assert_eq!(identity["identityVersion"], 1);
    assert_eq!(
        identity["mode"],
        if release_profile {
            "production"
        } else {
            "synthetic_localnet"
        }
    );
    assert_eq!(identity["schema"], 0);
    assert_eq!(identity["policy"], 1);
    assert_eq!(identity["lessonCapacity"], 96);
    let deployment: u64 = string(&identity, "deployment")
        .parse()
        .expect("invalid deployment number");
    assert!(deployment > 0 && deployment.to_string() == string(&identity, "deployment"));
    let authority_seed = string(&identity, "authoritySeed");
    assert!(
        !authority_seed.is_empty()
            && authority_seed.len() <= 32
            && authority_seed
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    );
    let domain = string(&identity, "programDomain");
    assert_eq!(domain.len(), 64);
    let bytes: Vec<u8> = (0..64)
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&domain[index..index + 2], 16).expect("invalid program domain")
        })
        .collect();
    let version = string(&identity, "artifactVersion");
    if release_profile {
        assert!(
            version.split('.').count() == 3
                && version
                    .split('.')
                    .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit())),
            "production needs a release version"
        );
        assert_ne!(
            identity["programId"], "7nA1Dh53c8eUZudEj7vDSvoT9rHapHHuF9NvHRLqjNmi",
            "production cannot reuse the local program identity"
        );
        assert_ne!(
            deployment, 0x42524c4f43414c30,
            "production cannot reuse the local deployment domain"
        );
        assert_ne!(
            domain, "64b77045c482ffa2cd163792ef15b63c7615510e3890e31f3a8310e56c183b85",
            "production cannot reuse the local program domain"
        );
    } else {
        assert_eq!(version, "backrooms.localnet.v0");
    }
    let output = env::var("OUT_DIR").unwrap();
    let output = Path::new(&output);
    fs::write(output.join("identity.rs"), format!(
        "pub const ROOM_AUTHORITY_SEED: &[u8] = b{seed:?};\npub const SCHEMA: u64 = 0;\npub const DEPLOYMENT: u64 = {deployment};\npub const PROGRAM_DOMAIN: [u8; 32] = {bytes:?};\npub const POLICY: u64 = 1;\npub const LESSON_CAPACITY: usize = 96;\npub const ARTIFACT_VERSION: &str = {version:?};\npub const IDENTITY_SHA256: &str = {identity_hash:?};\npub const PRODUCTION_BUILD: bool = {production};\npinocchio::address::declare_id!({program:?});\n",
        seed = authority_seed, identity_hash = digest(&identity_bytes), program = string(&identity, "programId"),
    )).unwrap();
    let approved = release.filter(|_| production).map(|directory| {
        let bytes = read(&directory.join("build-inputs.json"));
        assert_eq!(
            digest(&bytes),
            env::var("BACKROOM_RINGS_BUILD_APPROVAL_SHA256")
                .expect("production requires an independently approved build input digest")
        );
        let value: Value = serde_json::from_slice(&bytes).expect("invalid build inputs");
        assert_eq!(value["version"], 1);
        assert_eq!(value["identitySha256"], digest(&identity_bytes));
        let provenance = string(&value, "setupProvenanceSha256");
        assert!(
            provenance.len() == 64 && provenance.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "setup provenance must be pinned"
        );
        value
    });
    let schema_pin = approved
        .as_ref()
        .map_or("", |value| string(value, "schemaSha256"));
    if production {
        assert!(
            schema_pin.len() == 64 && schema_pin.bytes().all(|byte| byte.is_ascii_hexdigit()),
            "invalid schema pin"
        );
    }
    let mut pins = format!("pub const DEPLOYMENT_SCHEMA_SHA256: &str = {schema_pin:?};\n");
    for (name, key) in [
        ("create_room", "createRoom"),
        ("advance_room", "advanceRoom"),
    ] {
        let path = release.filter(|_| production).map_or_else(
            || root.join(format!("src/verifier/{name}.vk.rs")),
            |directory| directory.join(format!("verifiers/{name}.vk.rs")),
        );
        let bytes = read(&path);
        if let Some(approved) = &approved {
            assert_eq!(
                approved["circuits"][key]["verifierSourceSha256"],
                digest(&bytes),
                "verifier source differs from approved build inputs"
            );
            let source = std::str::from_utf8(&bytes).expect("verifier is not UTF-8");
            assert!(
                source.contains("pub const VERIFYINGKEY_INSECURE_TEST_SETUP: bool = false;"),
                "production requires a verifier exported from qualified setup"
            );
            assert!(
                !source.contains("INSECURE TEST SETUP")
                    && !source.contains("insecure_test_setup\\x00true"),
                "insecure verifier rejected"
            );
            let declaration = source
                .split("pub const VERIFYINGKEY_PROVING_KEY_SHA256: [u8; 32] = [")
                .nth(1)
                .and_then(|tail| tail.split(']').next())
                .expect("verifier must pin its proving key");
            let pinned: Vec<u8> = declaration
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| {
                    value
                        .trim_end_matches("u8")
                        .parse()
                        .expect("invalid proving key pin")
                })
                .collect();
            assert_eq!(pinned.len(), 32);
            let encoded = pinned
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            assert_eq!(
                approved["circuits"][key]["provingKeySha256"], encoded,
                "verifier-to-proving-key binding differs"
            );
        }
        for (field, suffix) in [
            ("circuitSha256", "CIRCUIT_SHA256"),
            ("provingKeySha256", "PROVING_KEY_SHA256"),
            ("verifyingKeySha256", "VERIFYING_KEY_SHA256"),
        ] {
            let value = approved
                .as_ref()
                .map_or("", |input| string(&input["circuits"][key], field));
            if production {
                assert!(
                    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()),
                    "invalid circuit pin"
                );
            }
            pins.push_str(&format!(
                "pub const {}_{suffix}: &str = {value:?};\n",
                name.to_ascii_uppercase()
            ));
        }
        fs::write(output.join(format!("{name}.vk.rs")), bytes).unwrap();
        if production {
            let wrapper = read(&root.join(format!("src/verifier/{name}.rs")));
            fs::write(output.join(format!("{name}.rs")), wrapper).unwrap();
        }
    }
    fs::write(output.join("build_pins.rs"), pins).unwrap();
}
