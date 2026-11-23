package transfer

import (
	"testing"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/test"
	"github.com/helius-labs/zolana-custom-rings/prover/circuits/shared"
)

type roomNotePairCircuit struct {
	RingID    frontend.Variable
	Old, Next shared.Output
}

func (c *roomNotePairCircuit) Define(api frontend.API) error {
	assertSpawnRoomNotePair(api, c.RingID, c.Old, c.Next)
	return nil
}

func roomNotePairWitness() *roomNotePairCircuit {
	note := func(hash int) shared.Output {
		return shared.Output{
			UtxoWires: shared.UtxoWires{
				Domain: 0, TreeID: 0, OwnerPkHash: 7, NullifierPk: 9,
				Asset: 11, Amount: 0, Blinding: 0, DataHash: 0,
				RingDataHash: 0, RingProgramID: 13,
			},
			Hash: hash, Utxo: 1, Ring: 1, Exit: 0,
		}
	}
	return &roomNotePairCircuit{RingID: 13, Old: note(17), Next: note(19)}
}

func TestSpawnRoomNotePair(t *testing.T) {
	if err := test.IsSolved(&roomNotePairCircuit{}, roomNotePairWitness(), ecc.BN254.ScalarField()); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*roomNotePairCircuit){
		"zero ring":           func(c *roomNotePairCircuit) { c.RingID = 0 },
		"input dummy":         func(c *roomNotePairCircuit) { c.Old.Utxo = 0 },
		"output dummy":        func(c *roomNotePairCircuit) { c.Next.Utxo = 0 },
		"input default ring":  func(c *roomNotePairCircuit) { c.Old.Ring = 0 },
		"output default ring": func(c *roomNotePairCircuit) { c.Next.Ring = 0 },
		"exit":                func(c *roomNotePairCircuit) { c.Next.Exit = 1 },
		"other ring":          func(c *roomNotePairCircuit) { c.Next.RingProgramID = 23 },
		"input value":         func(c *roomNotePairCircuit) { c.Old.Amount = 1 },
		"output value":        func(c *roomNotePairCircuit) { c.Next.Amount = 1 },
		"zero owner":          func(c *roomNotePairCircuit) { c.Old.OwnerPkHash = 0; c.Next.OwnerPkHash = 0 },
		"other owner":         func(c *roomNotePairCircuit) { c.Next.OwnerPkHash = 23 },
		"literal zero key":    func(c *roomNotePairCircuit) { c.Old.NullifierPk = 0; c.Next.NullifierPk = 0 },
		"public zero secret": func(c *roomNotePairCircuit) {
			c.Old.NullifierPk = shared.ZeroNullifierPk
			c.Next.NullifierPk = shared.ZeroNullifierPk
		},
		"other key":       func(c *roomNotePairCircuit) { c.Next.NullifierPk = 23 },
		"other asset":     func(c *roomNotePairCircuit) { c.Next.Asset = 23 },
		"same commitment": func(c *roomNotePairCircuit) { c.Next.Hash = c.Old.Hash },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			w := roomNotePairWitness()
			change(w)
			if err := test.IsSolved(&roomNotePairCircuit{}, w, ecc.BN254.ScalarField()); err == nil {
				t.Fatal("invalid note pair satisfied the constraints")
			}
		})
	}
}
