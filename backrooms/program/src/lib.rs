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
#[cfg(all(
    not(feature = "production"),
    not(feature = "build-circuits"),
    not(xark),
    not(xark_client)
))]
pub mod verifier;
#[cfg(all(
    feature = "production",
    not(feature = "build-circuits"),
    not(xark),
    not(xark_client)
))]
pub mod verifier {
    pub mod create_room {
        include!(concat!(env!("OUT_DIR"), "/create_room.rs"));
    }
    pub mod advance_room {
        include!(concat!(env!("OUT_DIR"), "/advance_room.rs"));
    }
}

include!(concat!(env!("OUT_DIR"), "/identity.rs"));
include!(concat!(env!("OUT_DIR"), "/build_pins.rs"));

pub fn room_authority_seeds(writer: &pinocchio::Address) -> [&[u8]; 2] {
    [ROOM_AUTHORITY_SEED, writer.as_array()]
}

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
