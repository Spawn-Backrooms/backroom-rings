use super::*;
use solana_signature::Signature;
use spr_client::rpc::PaginationToken;
use spr_keypair::ViewingKey;
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    sync::mpsc,
    thread,
    time::Duration,
};

#[path = "../../../tests/support/mod.rs"]
mod support;

struct MockRpc {
    url: String,
    requests: mpsc::Receiver<Value>,
    worker: thread::JoinHandle<()>,
    count: usize,
}

impl MockRpc {
    fn new(slot: u64, pages: Vec<Value>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let (sender, requests) = mpsc::channel();
        let count = pages.len() + 1;
        let worker = thread::spawn(move || {
            let replies = std::iter::once(("getSlot", json!(slot))).chain(
                pages
                    .into_iter()
                    .map(|page| ("getShieldedTransactionsByTags", page)),
            );
            for (method, result) in replies {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let request = read_request(&mut stream);
                assert_eq!(request["method"], method);
                let body =
                    json!({ "jsonrpc": "2.0", "id": request["id"], "result": result }).to_string();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{}",
                    body.len(),
                    body,
                )
                .unwrap();
                sender.send(request).unwrap();
            }
        });
        Self {
            url,
            requests,
            worker,
            count,
        }
    }

    fn finish(self, snapshot: u64) -> Vec<Value> {
        let requests: Vec<_> = (0..self.count)
            .map(|_| self.requests.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect();
        self.worker.join().unwrap();
        for request in &requests[1..] {
            assert_eq!(request["params"]["minContextSlot"], snapshot);
            assert_eq!(request["params"]["filters"]["slot"]["lte"], snapshot);
        }
        requests
    }
}

fn read_request(stream: &mut TcpStream) -> Value {
    let mut reader = BufReader::new(stream);
    let mut content_length = None;
    loop {
        let mut line = String::new();
        assert_ne!(reader.read_line(&mut line).unwrap(), 0);
        if line == "\r\n" {
            break;
        }
        if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = Some(value.trim().parse::<usize>().unwrap());
        }
    }
    let mut body = vec![0; content_length.unwrap()];
    reader.read_exact(&mut body).unwrap();
    serde_json::from_slice(&body).unwrap()
}

fn host(server: &MockRpc, writer: ShieldedKeypair) -> Host {
    Host {
        config: Config {
            mode: DeploymentMode::SyntheticLocalnet,
            production: None,
            signer_seed_hex: String::new(),
            rpc_url: server.url.clone(),
            indexer_url: server.url.clone(),
            prover_url: server.url.clone(),
            tree_address: spr_interface::pda::tree(0).to_string(),
            tree_id: 0,
            artifacts_directory: PathBuf::new(),
            genesis_hash: String::new(),
            program_binary_sha256: String::new(),
            shielded_pool_binary_sha256: String::new(),
        },
        client: SprClient::new(
            SolanaRpc::new(server.url.clone()),
            SprIndexer::new(&server.url),
            ProverClient::new(server.url.clone()),
        )
        .with_proof_data_source(ProofDataSource::Client),
        writer,
    }
}

fn request(room: Field, minimum: u64) -> RecoverInput {
    RecoverInput {
        room_id: hex::encode(to_bytes(&room)),
        minimum_confirmed_slot: minimum.to_string(),
    }
}

fn encrypted_event(transaction: ProgramTransaction, slot: u64, signature: Signature) -> Value {
    let proof = transaction
        .finalized
        .encrypt_with_viewing_key(&ViewingKey::from_bytes(&[20; 32]))
        .unwrap();
    let output_slots: Vec<_> = proof
        .external_data
        .outputs
        .iter()
        .zip(&proof.external_data.resolved_owner_tags)
        .enumerate()
        .map(|(index, (output, view_tag))| {
            json!({
                "viewTag": Address::new_from_array(*view_tag).to_string(),
                "outputContext": {
                    "hash": Address::new_from_array(output.utxo_hash).to_string(),
                    "tree": spr_interface::pda::tree(proof.output_tree_id).to_string(),
                    "treeId": proof.output_tree_id,
                    "leafIndex": index,
                },
                "payload": STANDARD.encode(output.data.as_ref().unwrap()),
            })
        })
        .collect();
    let nullifiers: Vec<_> = proof
        .input_utxos
        .iter()
        .map(|input| Address::new_from_array(input.published_nullifier()).to_string())
        .collect();
    json!({
        "slot": slot,
        "signature": signature.to_string(),
        "events": [{
            "eventIndex": 0,
            "slot": slot,
            "txSignature": signature.to_string(),
            "txViewingPk": STANDARD.encode(proof.external_data.tx_viewing_pk),
            "salt": STANDARD.encode(proof.external_data.salt),
            "outputSlots": output_slots,
            "messages": [],
            "nullifiers": nullifiers,
            "proofless": false,
        }],
    })
}

fn page(context: u64, data: Vec<Value>, token: Option<PaginationToken>) -> Value {
    json!({
        "context": { "blockTime": 0, "slot": context },
        "data": data,
        "paginationToken": token.map(|value| value.to_string()),
    })
}

#[test]
fn fresh_scan_recovers_an_older_checkpoint() {
    let fixture = support::fixture();
    let room = fixture.create.public.room_identity;
    let event = encrypted_event(fixture.genesis(), 100, Signature::from([1; 64]));
    let server = MockRpc::new(110, vec![page(110, vec![event], None)]);
    let result = host(&server, fixture.writer)
        .recover(request(room, 110))
        .unwrap();
    assert_eq!(result["status"], "recovered");
    assert_eq!(result["slot"], "100");
    assert_eq!(result["contextSlot"], "110");
    assert_eq!(result["checkpoint"]["revision"], "0");
    server.finish(110);
}

#[test]
fn later_page_contexts_do_not_extend_the_frozen_scan_bound() {
    let fixture = support::fixture();
    let room = fixture.create.public.room_identity;
    let signature = Signature::from([2; 64]);
    let event = encrypted_event(fixture.genesis(), 100, signature);
    let token = PaginationToken::new(100, signature);
    let server = MockRpc::new(
        110,
        vec![page(120, vec![event], Some(token)), page(130, vec![], None)],
    );
    let result = host(&server, fixture.writer)
        .recover(request(room, 105))
        .unwrap();
    assert_eq!(result["status"], "recovered");
    assert_eq!(result["slot"], "100");
    assert_eq!(result["contextSlot"], "110");
    let requests = server.finish(110);
    assert_eq!(requests[2]["params"]["paginationToken"], token.to_string());
}

#[test]
fn absent_state_carries_the_complete_scan_watermark() {
    let fixture = support::fixture();
    let room = fixture.create.public.room_identity;
    let server = MockRpc::new(100, vec![page(120, vec![], None)]);
    let result = host(&server, fixture.writer)
        .recover(request(room, 110))
        .unwrap();
    assert_eq!(
        result,
        json!({ "status": "not_found", "contextSlot": "110" })
    );
    server.finish(110);
}

#[test]
fn stale_absence_is_not_a_completed_recovery() {
    let fixture = support::fixture();
    let room = fixture.create.public.room_identity;
    let server = MockRpc::new(110, vec![page(109, vec![], None)]);
    let error = host(&server, fixture.writer)
        .recover(request(room, 110))
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<BridgeFailure>().unwrap().code(),
        "recovery_unavailable"
    );
    server.finish(110);
}

#[test]
fn a_checkpoint_is_not_returned_before_the_last_page_is_fresh() {
    let fixture = support::fixture();
    let room = fixture.create.public.room_identity;
    let signature = Signature::from([3; 64]);
    let event = encrypted_event(fixture.genesis(), 100, signature);
    let server = MockRpc::new(
        110,
        vec![
            page(110, vec![event], Some(PaginationToken::new(100, signature))),
            page(109, vec![], None),
        ],
    );
    let error = host(&server, fixture.writer)
        .recover(request(room, 110))
        .unwrap_err();
    assert_eq!(
        error.downcast_ref::<BridgeFailure>().unwrap().code(),
        "recovery_unavailable"
    );
    server.finish(110);
}

#[test]
fn recovery_scans_later_pages_for_a_spent_predecessor_and_its_successor() {
    let fixture = support::fixture();
    let room = fixture.create.public.room_identity;
    let signature = Signature::from([4; 64]);
    let genesis = encrypted_event(fixture.genesis(), 100, signature);
    let (advance, records) = fixture.advance();
    let successor = encrypted_event(
        fixture.advance_transaction(&advance, &records),
        105,
        Signature::from([5; 64]),
    );
    let server = MockRpc::new(
        110,
        vec![
            page(
                110,
                vec![genesis],
                Some(PaginationToken::new(100, signature)),
            ),
            page(115, vec![successor], None),
        ],
    );
    let result = host(&server, fixture.writer)
        .recover(request(room, 110))
        .unwrap();
    assert_eq!(result["status"], "recovered");
    assert_eq!(result["slot"], "105");
    assert_eq!(result["contextSlot"], "110");
    assert_eq!(result["checkpoint"]["revision"], "1");
    server.finish(110);
}
