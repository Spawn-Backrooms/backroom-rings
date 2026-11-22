#[cfg(any(feature = "circuits", feature = "wasm"))]
pub mod circuits;
#[cfg(all(
    any(feature = "circuits", feature = "wasm"),
    not(feature = "build-circuits"),
    not(xark),
    not(xark_client)
))]
pub mod client;
pub mod error;
#[cfg(all(not(feature = "build-circuits"), not(xark), not(xark_client)))]
pub mod instructions;
#[cfg(all(not(feature = "build-circuits"), not(xark), not(xark_client)))]
pub mod verifier;

pub const ROOM_AUTHORITY_SEED: &[u8] = b"backroom_v0";
pub const SCHEMA: u64 = 0;
pub const DEPLOYMENT: u64 = 0x42524c4f43414c30;
pub const PROGRAM_DOMAIN: [u8; 32] = [
    100, 183, 112, 69, 196, 130, 255, 162, 205, 22, 55, 146, 239, 21, 182, 60, 118, 21, 81, 14, 56,
    144, 227, 31, 58, 131, 16, 229, 108, 24, 59, 133,
];
pub const POLICY: u64 = 1;
pub const LESSON_CAPACITY: usize = 96;

pub fn room_authority_seeds(writer: &pinocchio::Address) -> [&[u8]; 2] {
    [ROOM_AUTHORITY_SEED, writer.as_array()]
}

pinocchio::address::declare_id!("7nA1Dh53c8eUZudEj7vDSvoT9rHapHHuF9NvHRLqjNmi");

pub mod tag {
    pub const CREATE_ROOM: u8 = 0;
    pub const ADVANCE_ROOM: u8 = 1;
}

#[cfg(all(
    feature = "bpf-entrypoint",
    not(feature = "no-entrypoint"),
    not(feature = "build-circuits")
))]
mod entrypoint {
    pinocchio::entrypoint!(crate::process_instruction);
}

#[cfg(all(not(feature = "build-circuits"), not(xark), not(xark_client)))]
pub fn process_instruction(
    program_id: &pinocchio::Address,
    accounts: &mut [pinocchio::AccountView],
    data: &[u8],
) -> pinocchio::ProgramResult {
    use pinocchio::error::ProgramError;
    if !pinocchio::address::address_eq(program_id, &ID) {
        return Err(ProgramError::IncorrectProgramId);
    }
    let (operation, data) = data
        .split_first()
        .ok_or(error::RoomError::InvalidInstruction)?;
    match *operation {
        tag::CREATE_ROOM => instructions::process_create(accounts, data),
        tag::ADVANCE_ROOM => instructions::process_advance(accounts, data),
        _ => Err(error::RoomError::InvalidInstruction.into()),
    }
}
