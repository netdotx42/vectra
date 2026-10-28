const VectraChain = (function () {
  const core = () => globalThis.VectraCore;

  function lib() {
    const web3 = globalThis.solanaWeb3;
    if (!web3 || !web3.PublicKey || !web3.Transaction || !web3.TransactionInstruction) {
      throw new Error('The Solana library did not load. Reload the page and try again.');
    }
    return web3;
  }

  function asBytes(data) {
    if (data instanceof Uint8Array) return data;
    return Uint8Array.from(data);
  }

  async function rpc(method, params) {
    const api = core();
    let response;
    try {
      response = await fetch(api.RPC_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      throw new Error(api.friendlyTxError(error));
    }
    if (response.status === 429) throw new Error(api.friendlyTxError({ message: '429 Too Many Requests' }));
    if (!response.ok) throw new Error(api.friendlyTxError({ message: 'Failed to fetch' }));
    let json;
    try {
      json = await response.json();
    } catch {
      throw new Error(api.friendlyTxError({ message: 'Failed to fetch' }));
    }
    if (json.error) {
      throw new Error(api.friendlyTxError({
        message: json.error.message || 'RPC error',
        logs: json.error.data && json.error.data.logs,
        code: json.error.code,
      }));
    }
    return json.result;
  }

  function decodeAccountData(data) {
    const api = core();
    if (!data) return null;
    if (typeof data === 'string') return api.base64ToBytes(data);
    if (Array.isArray(data) && typeof data[0] === 'string') return api.base64ToBytes(data[0]);
    return null;
  }

  function parseTokenAccount(info, mint) {
    const api = core();
    if (!info || info.owner !== api.TOKEN_PROGRAM_ID) return { exists: false, amount: 0n };
    const data = decodeAccountData(info.data);
    const amount = api.readTokenAmount(data);
    if (amount == null || api.base58Encode(data.slice(0, 32)) !== mint) return { exists: false, amount: 0n };
    return { exists: true, amount };
  }

  function buildTransaction(payer, blockhash, instructions) {
    const web3 = lib();
    const tx = new web3.Transaction();
    tx.feePayer = new web3.PublicKey(payer);
    tx.recentBlockhash = blockhash;
    instructions.forEach((ix) => {
      tx.add(new web3.TransactionInstruction({
        programId: new web3.PublicKey(ix.programId),
        keys: ix.keys.map((key) => ({
          pubkey: new web3.PublicKey(key.pubkey),
          isSigner: key.isSigner,
          isWritable: key.isWritable,
        })),
        data: asBytes(ix.data),
      }));
    });
    return tx;
  }

  function serializedSize(tx) {
    try {
      return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
    } catch (error) {
      const match = String(error && error.message || '').match(/Transaction too large: (\d+)/);
      if (match) return Number(match[1]);
      throw error;
    }
  }

  function wireBytes(tx) {
    const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return raw instanceof Uint8Array ? new Uint8Array(raw) : Uint8Array.from(raw);
  }

  async function getBalance(owner) {
    const result = await rpc('getBalance', [owner, { commitment: 'confirmed' }]);
    return BigInt(result.value);
  }

  async function getMultipleAccounts(addresses) {
    const result = await rpc('getMultipleAccounts', [addresses, { commitment: 'confirmed', encoding: 'base64' }]);
    return result.value || [];
  }

  async function latestBlockhash() {
    const result = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    return {
      blockhash: result.value.blockhash,
      lastValidBlockHeight: result.value.lastValidBlockHeight,
    };
  }

  async function rentExempt(bytes) {
    const value = await rpc('getMinimumBalanceForRentExemption', [bytes, { commitment: 'confirmed' }]);
    return BigInt(value);
  }

  async function fetchBalances(owner) {
    const api = core();
    if (!api.isSolanaAddress(owner)) throw new Error('Connect a Solana wallet on devnet first.');
    const ata = api.associatedTokenAddress(owner, api.DEVNET_USDC_MINT, lib());
    const [lamports, accounts] = await Promise.all([
      getBalance(owner),
      getMultipleAccounts([ata]),
    ]);
    const token = parseTokenAccount(accounts[0], api.DEVNET_USDC_MINT);
    return {
      solLamports: lamports,
      usdcBase: token.amount,
      sourceAta: ata,
      sourceExists: token.exists,
    };
  }

  function instructionSet(preview, transfers) {
    return core().payoutInstructions({
      payer: preview.payer,
      sourceAta: preview.sourceAta,
      mint: preview.mint,
      memo: preview.memo,
      transfers: transfers.map((row) => ({
        owner: row.owner,
        ata: row.ata,
        amount: typeof row.amount === 'bigint' ? row.amount : BigInt(row.amount),
        createAta: !!row.createAta,
      })),
    });
  }

  async function feeFor(tx) {
    try {
      const message = tx.compileMessage().serialize();
      const result = await rpc('getFeeForMessage', [core().bytesToBase64(message), { commitment: 'confirmed' }]);
      if (result && result.value != null) return BigInt(result.value);
    } catch {
      /* The base signature fee is the fallback when the fee RPC is busy. */
    }
    return 5000n;
  }

  async function simulate(tx) {
    const api = core();
    const result = await rpc('simulateTransaction', [
      api.bytesToBase64(wireBytes(tx)),
      {
        encoding: 'base64',
        sigVerify: false,
        replaceRecentBlockhash: true,
        commitment: 'confirmed',
      },
    ]);
    const value = result.value || {};
    if (value.err) {
      return {
        ok: false,
        message: api.friendlyTxError({ message: 'simulation failed', logs: value.logs, err: value.err }),
      };
    }
    return { ok: true };
  }

  async function preparePayout(input) {
    const api = core();
    if (input.network && input.network !== 'devnet') {
      throw new Error('Mainnet is not available yet. Vectra Lite only sends on devnet.');
    }
    const validated = api.validatePayout({ recipients: input.recipients, memo: input.memo });
    if (!validated.ok) {
      const error = new Error(validated.error);
      error.field = true;
      throw error;
    }
    const web3 = lib();
    const mint = api.DEVNET_USDC_MINT;
    const payer = input.payer;
    const sourceAta = api.associatedTokenAddress(payer, mint, web3);
    const transfers = validated.recipients.map((row) => ({
      address: row.address,
      owner: row.address,
      display: row.display,
      amount: row.amount,
      ata: api.associatedTokenAddress(row.address, mint, web3),
      createAta: false,
    }));
    const [accounts, solLamports] = await Promise.all([
      getMultipleAccounts([sourceAta, ...transfers.map((row) => row.ata)]),
      getBalance(payer),
    ]);
    const source = parseTokenAccount(accounts[0], mint);
    if (source.amount < validated.total) {
      throw new Error('This wallet does not have enough devnet USDC for this payout. Devnet USDC has no cash value. Use the Circle devnet faucet if you need test tokens.');
    }
    transfers.forEach((row, index) => {
      row.createAta = !parseTokenAccount(accounts[index + 1], mint).exists;
    });
    const [block, rentAta, rentSystem] = await Promise.all([
      latestBlockhash(),
      rentExempt(api.TOKEN_ACCOUNT_SIZE),
      rentExempt(0),
    ]);
    const previewBase = { payer, sourceAta, mint, memo: validated.memo };
    const planned = api.planBatches(transfers, {
      limit: api.TX_SIZE_LIMIT,
      maxItems: api.MAX_RECIPIENTS_PER_TX,
      measure(group) {
        return serializedSize(buildTransaction(payer, block.blockhash, instructionSet(previewBase, group)));
      },
    });
    if (!planned.ok) throw new Error(planned.error);
    const batches = [];
    let feeEach = null;
    for (const group of planned.batches) {
      const tx = buildTransaction(payer, block.blockhash, instructionSet(previewBase, group));
      const sim = await simulate(tx);
      if (!sim.ok) throw new Error(sim.message);
      if (feeEach == null) feeEach = await feeFor(tx);
      const amount = group.reduce((sum, row) => sum + row.amount, 0n);
      batches.push({
        transfers: group.map((row) => ({
          address: row.address,
          owner: row.owner,
          ata: row.ata,
          amount: row.amount.toString(),
          display: row.display,
          createAta: row.createAta,
        })),
        amountDisplay: api.formatBaseUnits(amount, api.USDC_DECIMALS),
        newAtaCount: group.filter((row) => row.createAta).length,
        size: serializedSize(tx),
      });
    }
    const feeLamports = feeEach * BigInt(batches.length);
    const newAtaCount = batches.reduce((sum, batch) => sum + batch.newAtaCount, 0);
    const rentTotal = rentAta * BigInt(newAtaCount);
    if (solLamports < feeLamports + rentTotal + rentSystem) {
      throw new Error('This wallet does not have enough devnet SOL for fees and token-account rent. Use the Solana devnet faucet, then try again. Devnet SOL has no cash value.');
    }
    return {
      ...previewBase,
      reference: String(input.reference || '').trim(),
      total: validated.total.toString(),
      totalDisplay: validated.totalDisplay,
      recipients: transfers.map((row) => ({
        address: row.address,
        display: row.display,
        createAta: row.createAta,
      })),
      batches,
      feeLamports: feeLamports.toString(),
      rentLamports: rentAta.toString(),
      rentTotalLamports: rentTotal.toString(),
      newAtaCount,
      solLamports: solLamports.toString(),
    };
  }

  function rebuild(preview, batch, blockhash) {
    return buildTransaction(preview.payer, blockhash, instructionSet(preview, batch.transfers));
  }

  async function sendRaw(bytes) {
    const api = core();
    const signature = await rpc('sendTransaction', [
      api.bytesToBase64(bytes),
      { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed' },
    ]);
    if (!api.isSignature(signature)) throw new Error('The devnet RPC did not return a transaction signature.');
    return signature;
  }

  async function confirm(signature, lastValidBlockHeight) {
    const started = Date.now();
    while (Date.now() - started < 45000) {
      const result = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
      const status = result && result.value ? result.value[0] : null;
      if (status && status.err) {
        throw new Error('The transaction was confirmed but failed on devnet. Open the explorer link before trying again. Devnet tokens have no cash value.');
      }
      if (status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized')) return status;
      const height = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
      if (typeof height === 'number' && lastValidBlockHeight && height > lastValidBlockHeight && !status) {
        throw new Error('block height exceeded');
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
    const error = new Error('Timed out waiting for confirmation. Check the explorer before sending this payout again.');
    error.timeout = true;
    throw error;
  }

  return {
    fetchBalances,
    preparePayout,
    latestBlockhash,
    rebuild,
    simulate,
    sendRaw,
    confirm,
    wireBytes,
  };
})();
