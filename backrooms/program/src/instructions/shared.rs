#[cfg(any(target_os = "solana", target_arch = "bpf"))]
use pinocchio::cpi::{Seed, Signer};
use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};
use spr_interface::instruction::instruction_data::transact::TransactIxDataRef;
#[cfg(any(target_os = "solana", target_arch = "bpf"))]
use spr_program::cpi::{SppTransactAccounts, TransactAccountsError};
use spr_program::program::PdaOwner;
use wincode::{config::DefaultConfig, SchemaReadOwned};

use crate::error::RoomError;

pub struct IxData<'a, A> {
    pub args: A,
    pub private_tx_hash: &'a [u8; 32],
    pub transact: &'a [u8],
}

impl<'a, A: SchemaReadOwned<DefaultConfig, Dst = A>> IxData<'a, A> {
    pub fn parse(data: &'a [u8]) -> Result<Self, ProgramError> {
        let mut transact = data;
        let args =
            wincode::deserialize_from(&mut transact).map_err(|_| RoomError::InvalidInstruction)?;
        let private_tx_hash = TransactIxDataRef::from_bytes(transact)
            .map_err(|_| RoomError::InvalidInstruction)?
            .private_tx_hash;
        Ok(Self {
            args,
            private_tx_hash,
            transact,
        })
    }
}

pub struct RoomAuthority {
    address: Address,
    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    creator: Address,
    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    bump: u8,
}

impl RoomAuthority {
    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    pub fn find(creator: &Address) -> Self {
        let (address, bump) =
            Address::find_program_address(&crate::room_authority_seeds(creator), &crate::ID);
        Self {
            address,
            creator: *creator,
            bump,
        }
    }

    #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
    pub fn find(_creator: &Address) -> Self {
        unimplemented!("RoomAuthority::find requires Solana runtime syscalls")
    }

    pub fn owner_hash(&self) -> Result<[u8; 32], RoomError> {
        Ok(*PdaOwner::new(&self.address)
            .map_err(|_| RoomError::HashingFailed)?
            .owner_hash())
    }

    #[cfg(any(target_os = "solana", target_arch = "bpf"))]
    #[inline(never)]

    pub fn invoke_transact(&self, spp_accounts: &[AccountView], transact: &[u8]) -> ProgramResult {
        let signer_pdas = [&self.address];
        let spp = SppTransactAccounts::new(spp_accounts, &signer_pdas)
            .map_err(transact_accounts_error)?;
        let bump = [self.bump];
        let seeds = [
            Seed::from(crate::ROOM_AUTHORITY_SEED),
            Seed::from(self.creator.as_array()),
            Seed::from(&bump),
        ];
        spp.invoke::<16>(transact, &[Signer::from(&seeds)])
    }

    #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
    pub fn invoke_transact(
        &self,
        _spp_accounts: &[AccountView],
        _transact: &[u8],
    ) -> ProgramResult {
        unimplemented!("RoomAuthority::invoke_transact requires Solana runtime syscalls")
    }
}

#[cfg(any(target_os = "solana", target_arch = "bpf"))]
fn transact_accounts_error(error: TransactAccountsError) -> ProgramError {
    match error {
        TransactAccountsError::InvalidSppProgram => RoomError::InvalidShieldedPoolProgram.into(),
        TransactAccountsError::MissingPdaSigner { .. } => RoomError::MissingRoomAuthority.into(),
        TransactAccountsError::NotEnoughAccounts => ProgramError::NotEnoughAccountKeys,
    }
}
