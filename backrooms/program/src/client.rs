use crate::{
    circuits::room_authority,
    instructions::{AdvanceArgs, CreateArgs},
    tag, ID,
};
use pinocchio::Address;
use solana_instruction::{AccountMeta, Instruction};
use spr_interface::instruction::instruction_data::transact::TransactIxData;
use spr_program::{instruction::Transact, CompressedProof};

pub struct RoomInstruction {
    pub writer: Address,
    pub tree: Address,
    pub proof: CompressedProof,
    pub viewing_pubkey: [u8; 33],
    pub room_identity: [u8; 32],
    pub transact: TransactIxData,
}

impl RoomInstruction {
    pub fn create(self) -> Result<Instruction, wincode::Error> {
        let args = wincode::serialize(&CreateArgs {
            proof: self.proof,
            viewing_pubkey: self.viewing_pubkey,
            room_identity: self.room_identity,
        })?;
        self.instruction(tag::CREATE_ROOM, args)
    }

    pub fn advance(self, authorization: [u8; 32]) -> Result<Instruction, wincode::Error> {
        let args = wincode::serialize(&AdvanceArgs {
            proof: self.proof,
            viewing_pubkey: self.viewing_pubkey,
            room_identity: self.room_identity,
            authorization,
        })?;
        self.instruction(tag::ADVANCE_ROOM, args)
    }

    fn instruction(self, tag: u8, args: Vec<u8>) -> Result<Instruction, wincode::Error> {
        let transact_bytes = self.transact.serialize()?;
        let transact = Transact {
            payer: self.writer,
            input_trees: vec![self.tree],
            output_tree: self.tree,
            owner_signers: Vec::new(),
            interface_transfer_accounts: Vec::new(),
            data: self.transact,
        };
        let mut accounts = vec![AccountMeta::new(self.writer, true)];
        accounts.extend(transact.cpi_accounts(&[*room_authority(&self.writer).pda()]));
        let mut data = vec![tag];
        data.extend(args);
        data.extend(transact_bytes);
        Ok(Instruction {
            program_id: ID,
            accounts,
            data,
        })
    }
}
