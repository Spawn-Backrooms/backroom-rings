mod support;
use spr_program::proof::{compressed_proof, SolanaVerifyingKey};
use spr_program::verifier::{verify_groth16, VerifyError};
use spr_program::ProgramTransaction;
use std::path::PathBuf;

fn prove(name: &str, transaction: ProgramTransaction) {
    let artifacts = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/zk/backroom-rings-program")
        .join(name);
    let circuit = xark::prover::circuit_at(&artifacts);
    circuit
        .check_constrained(transaction.proof_inputs.clone())
        .unwrap();
    let result = circuit.prove(transaction.proof_inputs).unwrap();
    let proof = compressed_proof(&result.proof).unwrap();
    let key =
        SolanaVerifyingKey::from_xark(&std::fs::read(artifacts.join("vk.bin")).unwrap()).unwrap();
    verify_groth16(&proof, transaction.public_hash, &key.as_key()).unwrap();
    let mut changed = transaction.public_hash;
    changed[31] ^= 1;
    assert_eq!(
        verify_groth16(&proof, changed, &key.as_key()),
        Err(VerifyError::Proof)
    );
}

#[test]
fn create_and_advance_generate_real_proofs_bound_to_the_finalized_transaction() {
    let fixture = support::fixture();
    prove("create_room", fixture.genesis());
    let (advance, records) = fixture.advance();
    prove(
        "advance_room",
        fixture.advance_transaction(&advance, &records),
    );
}

#[test]
fn compiled_circuit_refuses_rebound_grants() {
    let fixture = support::fixture();
    let artifacts = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../target/zk/backroom-rings-program/advance_room");
    let circuit = xark::prover::circuit_at(artifacts);
    for mutation in 0..3 {
        let (mut program, _) = fixture.advance();
        let public_hash = *spr_program::checked(|| program.execute())
            .unwrap()
            .public_hash();
        match mutation {
            0 => program.private.grant.predecessor += spr_program::Field::one(),
            1 => program.private.grant.ordinal += 1,
            _ => program.private.grant.blinding[0] ^= 1,
        }
        assert!(circuit
            .check(spr_program::ProgramProofInputs::new(&program, public_hash))
            .is_err());
    }
}
