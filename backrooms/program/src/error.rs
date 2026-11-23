use pinocchio::error::ProgramError;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
#[repr(u32)]
pub enum RoomError {
    #[error("invalid Backrooms instruction")]
    InvalidInstruction = 8100,
    #[error("Backrooms proof did not verify")]
    InvalidProof = 8101,
    #[error("Backrooms commitment could not be computed")]
    HashingFailed = 8102,
    #[error("unexpected shielded pool program")]
    InvalidShieldedPoolProgram = 8103,
    #[error("room authority signer is missing")]
    MissingRoomAuthority = 8104,
}

impl From<RoomError> for ProgramError {
    fn from(error: RoomError) -> Self {
        Self::Custom(error as u32)
    }
}
