mod shared;
use crate::{error::RoomError, verifier};
use pinocchio::{AccountView, ProgramResult};
use shared::{IxData, RoomAuthority};
use spr_account_checks::AccountIterator;
use spr_hasher::primitives::solana_owner_identity;
use spr_program::CompressedProof;
use wincode::{SchemaRead, SchemaWrite};

#[derive(Clone, Copy, Debug, PartialEq, Eq, SchemaRead, SchemaWrite)]
pub struct CreateArgs {
    pub proof: CompressedProof,
    pub viewing_pubkey: [u8; 33],
    pub room_identity: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, SchemaRead, SchemaWrite)]
pub struct AdvanceArgs {
    pub proof: CompressedProof,
    pub viewing_pubkey: [u8; 33],
    pub room_identity: [u8; 32],
    pub authorization: [u8; 32],
}

pub fn process_create(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut iter = AccountIterator::new(accounts);
    let writer = *iter.next_signer("room writer")?.address();
    let writer_identity =
        solana_owner_identity(writer.as_array()).map_err(|_| RoomError::HashingFailed)?;
    let authority = RoomAuthority::find(&writer);
    let parsed = IxData::<CreateArgs>::parse(data)?;
    let args = parsed.args;
    let room_owner =
        spr_program::verifier::address_hash(&authority.owner_hash()?, &args.viewing_pubkey)
            .map_err(|_| RoomError::HashingFailed)?;
    verifier::create_room::Verifier {
        proof: &args.proof,
        public_inputs: verifier::create_room::PublicInputs {
            room_owner,
            writer_identity,
            room_identity: args.room_identity,
        },
        private_tx_hash: parsed.private_tx_hash,
        transfers: &[],
    }
    .verify()
    .map_err(|_| RoomError::InvalidProof)?;
    authority.invoke_transact(iter.remaining()?, parsed.transact)
}

pub fn process_advance(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let mut iter = AccountIterator::new(accounts);
    let writer = *iter.next_signer("room writer")?.address();
    let writer_identity =
        solana_owner_identity(writer.as_array()).map_err(|_| RoomError::HashingFailed)?;
    let authority = RoomAuthority::find(&writer);
    let parsed = IxData::<AdvanceArgs>::parse(data)?;
    let args = parsed.args;
    let room_owner =
        spr_program::verifier::address_hash(&authority.owner_hash()?, &args.viewing_pubkey)
            .map_err(|_| RoomError::HashingFailed)?;
    verifier::advance_room::Verifier {
        proof: &args.proof,
        public_inputs: verifier::advance_room::PublicInputs {
            room_owner,
            writer_identity,
            room_identity: args.room_identity,
            authorization: args.authorization,
        },
        private_tx_hash: parsed.private_tx_hash,
        transfers: &[],
    }
    .verify()
    .map_err(|_| RoomError::InvalidProof)?;
    authority.invoke_transact(iter.remaining()?, parsed.transact)
}
