const test = require('node:test');
const assert = require('node:assert/strict');
const { Keypair, PublicKey, Transaction, TransactionInstruction } = require('@solana/web3.js');
const {
  createTransferCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');
const core = require('../dist/core.js');

function toTxInstruction(ix) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((key) => ({
      pubkey: new PublicKey(key.pubkey),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

function sameKeys(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((key, index) => {
    assert.equal(key.pubkey, expected[index].pubkey.toBase58());
    assert.equal(key.isSigner, expected[index].isSigner);
    assert.equal(key.isWritable, expected[index].isWritable);
  });
}

test('base58 matches web3.js public keys', () => {
  const key = Keypair.generate().publicKey;
  assert.equal(core.base58Encode(key.toBytes()), key.toBase58());
  assert.deepEqual(Buffer.from(core.base58Decode(key.toBase58())), Buffer.from(key.toBytes()));
});

test('ATA seeds and instruction bytes match @solana/spl-token', () => {
  const payer = Keypair.generate().publicKey;
  const owner = Keypair.generate().publicKey;
  const mint = new PublicKey(core.DEVNET_USDC_MINT);
  const ata = core.associatedTokenAddress(owner.toBase58(), mint.toBase58(), { PublicKey });
  const official = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  assert.equal(ata, official.toBase58());

  const ours = core.createAtaIdempotentInstruction({
    payer: payer.toBase58(),
    ata,
    owner: owner.toBase58(),
    mint: mint.toBase58(),
  });
  const theirs = createAssociatedTokenAccountIdempotentInstruction(payer, official, owner, mint);
  assert.equal(ours.programId, theirs.programId.toBase58());
  sameKeys(ours.keys, theirs.keys);
  assert.deepEqual(Buffer.from(ours.data), Buffer.from(theirs.data));

  const source = Keypair.generate().publicKey;
  const transfer = core.transferCheckedInstruction({
    source: source.toBase58(),
    mint: mint.toBase58(),
    destination: ata,
    owner: payer.toBase58(),
    amount: 1000001n,
    decimals: 6,
  });
  const officialTransfer = createTransferCheckedInstruction(source, mint, official, payer, 1000001n, 6);
  assert.equal(transfer.programId, officialTransfer.programId.toBase58());
  sameKeys(transfer.keys, officialTransfer.keys);
  assert.deepEqual(Buffer.from(transfer.data), Buffer.from(officialTransfer.data));
});

test('a full devnet batch with ATAs and a memo fits in one transaction', () => {
  const payer = Keypair.generate().publicKey;
  const mint = core.DEVNET_USDC_MINT;
  const sourceAta = core.associatedTokenAddress(payer.toBase58(), mint, { PublicKey });
  const transfers = [];
  for (let i = 0; i < core.MAX_RECIPIENTS_PER_TX; i++) {
    const owner = Keypair.generate().publicKey.toBase58();
    transfers.push({
      owner,
      ata: core.associatedTokenAddress(owner, mint, { PublicKey }),
      amount: 1000000n + BigInt(i),
      createAta: true,
    });
  }
  const instructions = core.payoutInstructions({
    payer: payer.toBase58(),
    sourceAta,
    mint,
    memo: 'm'.repeat(core.MEMO_MAX),
    transfers,
  });
  const tx = new Transaction();
  tx.feePayer = payer;
  tx.recentBlockhash = '11111111111111111111111111111111';
  instructions.forEach((ix) => tx.add(toTxInstruction(ix)));
  const size = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  assert.ok(size <= core.TX_SIZE_LIMIT, 'serialized ' + size);
  assert.ok(size > 64);

  const planned = core.planBatches(transfers, {
    limit: core.TX_SIZE_LIMIT,
    maxItems: core.MAX_RECIPIENTS_PER_TX,
    measure(group) {
      const trial = new Transaction();
      trial.feePayer = payer;
      trial.recentBlockhash = tx.recentBlockhash;
      core.payoutInstructions({
        payer: payer.toBase58(),
        sourceAta,
        mint,
        memo: 'm'.repeat(core.MEMO_MAX),
        transfers: group,
      }).forEach((ix) => trial.add(toTxInstruction(ix)));
      return trial.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
    },
  });
  assert.equal(planned.ok, true);
  assert.equal(planned.batches.length, 1);
});
