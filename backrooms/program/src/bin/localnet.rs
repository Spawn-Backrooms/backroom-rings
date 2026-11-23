use anyhow::{ensure, Result};
use serde_json::json;
use sha2::{Digest, Sha256};
use spr_client::SolanaRpc;
use spr_program_test::{
    fixture,
    localnet::{FixtureLocalnet, LocalnetPaths, LocalnetPorts},
    workspace_path,
};
use std::{fs, path::PathBuf, process::Command};

fn main() -> Result<()> {
    let mut command = std::env::args_os().skip(1);
    let executable = command
        .next()
        .ok_or_else(|| anyhow::anyhow!("provide a command to run inside the local fixture"))?;
    let ports = LocalnetPorts::for_test(13)?;
    let paths = LocalnetPaths::workspace();
    let program_path = workspace_path("target/deploy/backroom_rings_program.so");
    let run_dir = std::env::var_os("BACKROOM_RINGS_RUN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| workspace_path("target/backrooms-demo"));
    fs::create_dir_all(&run_dir)?;
    let config_path = run_dir.join("bridge-config.json");
    ensure!(
        !config_path.exists(),
        "use a fresh run directory; a retained room must reconnect to its retained ledger"
    );
    let localnet = FixtureLocalnet::start(
        "backrooms-demo",
        ports,
        vec![(backroom_rings_program::ID, program_path.clone())],
        &paths,
    )?;
    let rpc = SolanaRpc::new(ports.rpc_url());
    let config = json!({
        "signerSeedHex": hex::encode(&fixture::actor(0).to_bytes()[..32]),
        "rpcUrl": ports.rpc_url(), "indexerUrl": ports.photon_url(),
        "proverUrl": std::env::var("ZOLANA_PROVER_URL").unwrap_or_else(|_| "http://127.0.0.1:3001".into()),
        "treeAddress": localnet.tree.to_string(), "treeId": localnet.tree_id,
        "artifactsDirectory": workspace_path("target/zk/backroom-rings-program"),
        "genesisHash": rpc.client().get_genesis_hash()?.to_string(),
        "programBinarySha256": hex::encode(Sha256::digest(fs::read(program_path)?)),
        "shieldedPoolBinarySha256": hex::encode(Sha256::digest(fs::read(&paths.shielded_pool_program)?)),
    });
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&config_path)?;
    serde_json::to_writer_pretty(file, &config)?;
    let status = Command::new(executable)
        .args(command)
        .env("BACKROOM_RINGS_CONFIG", config_path)
        .env("BACKROOM_RINGS_RUN_DIR", &run_dir)
        .env(
            "BACKROOM_RINGS_BRIDGE",
            workspace_path("target/debug/backroom-rings-bridge"),
        )
        .status()?;
    drop(localnet);
    ensure!(status.success(), "reference host command failed");
    Ok(())
}
