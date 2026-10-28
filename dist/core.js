(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.VectraCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const DONATION_MIN = 1999;
  const DONATION_MAX = 100000;
  const DONATION_ADDRESS = 'Efhs2ifAwJKUYcVGXvTj3F8z17pGvDRMSxQrDZzjmizR';
  const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
  const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const RPC_ENDPOINT = 'https://api.devnet.solana.com';
  const SOL_FAUCET_URL = 'https://faucet.solana.com/';
  const USDC_FAUCET_URL = 'https://faucet.circle.com/';
  const USDC_DECIMALS = 6;
  const TX_SIZE_LIMIT = 1232;
  const MAX_RECIPIENTS_PER_TX = 4;
  const MAX_RECIPIENTS = 20;
  const MEMO_MAX = 280;
  const TOKEN_ACCOUNT_SIZE = 165;
  const COMPUTE_UNIT_LIMIT = 400000;
  const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
  const ASSOCIATED_TOKEN_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
  const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
  const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';
  const COMPUTE_BUDGET_PROGRAM_ID = 'ComputeBudget111111111111111111111111111111';
  const BLOCKED_RECIPIENTS = new Set([
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MEMO_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    COMPUTE_BUDGET_PROGRAM_ID,
  ]);

  function base58Decode(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      let carry = ALPHABET.indexOf(text[i]);
      if (carry < 0) return null;
      for (let j = 0; j < bytes.length; j++) {
        carry += bytes[j] * 58;
        bytes[j] = carry & 0xff;
        carry >>= 8;
      }
      while (carry > 0) {
        bytes.push(carry & 0xff);
        carry >>= 8;
      }
    }
    let zeros = 0;
    while (zeros < text.length && text[zeros] === '1') zeros++;
    const out = new Uint8Array(zeros + bytes.length);
    for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i];
    return out;
  }

  function base58Encode(value) {
    const input = value instanceof Uint8Array ? value : Uint8Array.from(value);
    let zeros = 0;
    while (zeros < input.length && input[zeros] === 0) zeros++;
    if (zeros === input.length) return '1'.repeat(input.length);
    const digits = [0];
    for (let i = zeros; i < input.length; i++) {
      let carry = input[i];
      for (let j = 0; j < digits.length; j++) {
        carry += digits[j] << 8;
        digits[j] = carry % 58;
        carry = (carry / 58) | 0;
      }
      while (carry > 0) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let text = '1'.repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--) text += ALPHABET[digits[i]];
    return text;
  }

  function isSolanaAddress(value) {
    const decoded = base58Decode(value);
    return !!decoded && decoded.length === 32;
  }

  function isSignature(value) {
    const decoded = base58Decode(value);
    return !!decoded && decoded.length === 64;
  }

  function parseTokenAmount(raw, decimals) {
    const places = decimals === undefined ? USDC_DECIMALS : decimals;
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { ok: false, error: 'Enter an amount.' };
    let body = trimmed.replace(/\$/g, '').trim();
    if (!body) return { ok: false, error: 'Enter an amount.' };
    if (body.startsWith('-') || body.startsWith('\u2212')) {
      return { ok: false, error: 'Amount must be greater than zero.' };
    }
    body = body.replace(/,/g, '');
    if (!/^\d+(\.\d+)?$/.test(body)) return { ok: false, error: 'Enter a positive amount, like 12.5.' };
    const parts = body.split('.');
    const whole = parts[0];
    const fraction = parts[1] || '';
    if (fraction.length > places) return { ok: false, error: 'Use at most ' + places + ' decimal places.' };
    const padded = (fraction + '0'.repeat(places)).slice(0, places);
    let amount;
    try {
      amount = BigInt(whole) * (10n ** BigInt(places)) + BigInt(padded || '0');
    } catch {
      return { ok: false, error: 'Enter a positive amount, like 12.5.' };
    }
    if (amount <= 0n) return { ok: false, error: 'Enter an amount greater than zero.' };
    if (amount > 18446744073709551615n) return { ok: false, error: 'That amount is too large for one transfer.' };
    return { ok: true, amount };
  }

  function formatBaseUnits(amount, decimals) {
    const value = typeof amount === 'bigint' ? amount : BigInt(amount);
    const negative = value < 0n;
    const abs = negative ? -value : value;
    const base = 10n ** BigInt(decimals);
    const whole = abs / base;
    const frac = abs % base;
    const fracText = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    const text = fracText ? whole.toString() + '.' + fracText : whole.toString();
    return negative ? '-' + text : text;
  }

  function cleanMemo(memo) {
    if (memo == null || String(memo).trim() === '') return { ok: true, memo: '' };
    const text = String(memo).trim();
    if (text.length > MEMO_MAX) return { ok: false, error: 'Memo must be 280 characters or fewer.' };
    if (/[\u0000-\u001f\u007f]/.test(text)) {
      return { ok: false, error: 'Memo cannot include line breaks or control characters.' };
    }
    return { ok: true, memo: text };
  }

  function validatePayout(input) {
    const source = input || {};
    const rows = Array.isArray(source.recipients) ? source.recipients : [];
    if (!rows.length) return { ok: false, error: 'Add at least one recipient.' };
    if (rows.length > MAX_RECIPIENTS) return { ok: false, error: 'You can add up to 20 recipients per payout.' };
    const memo = cleanMemo(source.memo);
    if (!memo.ok) return memo;
    const recipients = [];
    const seen = new Set();
    for (const row of rows) {
      const address = String(row?.address ?? '').trim();
      if (!isSolanaAddress(address)) {
        return { ok: false, error: 'Enter a Solana address for each recipient (32-byte base58).' };
      }
      if (BLOCKED_RECIPIENTS.has(address)) {
        return { ok: false, error: 'That address is a Solana program, not a recipient wallet.' };
      }
      if (seen.has(address)) return { ok: false, error: 'Each recipient address must be unique.' };
      seen.add(address);
      const parsed = parseTokenAmount(row?.amount, USDC_DECIMALS);
      if (!parsed.ok) return parsed;
      recipients.push({ address, amount: parsed.amount, display: formatBaseUnits(parsed.amount, USDC_DECIMALS) });
    }
    const total = recipients.reduce((sum, row) => sum + row.amount, 0n);
    return { ok: true, recipients, total, totalDisplay: formatBaseUnits(total, USDC_DECIMALS), memo: memo.memo };
  }

  function planBatches(items, options) {
    const settings = options || {};
    const limit = settings.limit;
    const maxItems = settings.maxItems == null ? MAX_RECIPIENTS_PER_TX : settings.maxItems;
    const measure = settings.measure;
    if (!Array.isArray(items) || !items.length) return { ok: false, error: 'Add at least one recipient.' };
    if (typeof measure !== 'function' || !Number.isFinite(limit)) {
      return { ok: false, error: 'Could not measure the transaction.' };
    }
    const batches = [];
    let current = [];
    const sizeOf = (group) => {
      const size = measure(group);
      if (!Number.isFinite(size)) throw new Error('Could not measure the transaction.');
      return size;
    };
    const tooBig = 'One recipient does not fit in a Solana transaction. Shorten the memo or split the payout.';
    try {
      for (const item of items) {
        if (current.length >= maxItems) {
          batches.push(current);
          current = [];
        }
        const trial = current.concat([item]);
        if (sizeOf(trial) <= limit) {
          current = trial;
          continue;
        }
        if (!current.length) return { ok: false, error: tooBig };
        batches.push(current);
        if (sizeOf([item]) > limit) return { ok: false, error: tooBig };
        current = [item];
      }
    } catch (error) {
      return { ok: false, error: error.message || 'Could not measure the transaction.' };
    }
    if (current.length) batches.push(current);
    return { ok: true, batches };
  }

  function u64Bytes(amount) {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, amount, true);
    return data;
  }

  function transferCheckedData(amount, decimals) {
    const data = new Uint8Array(10);
    data[0] = 12;
    data.set(u64Bytes(amount), 1);
    data[9] = decimals;
    return data;
  }

  function createAtaIdempotentData() {
    return Uint8Array.of(1);
  }

  function setComputeUnitLimitData(units) {
    const data = new Uint8Array(5);
    data[0] = 2;
    new DataView(data.buffer).setUint32(1, units, true);
    return data;
  }

  function transferCheckedInstruction(fields) {
    return {
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: fields.source, isSigner: false, isWritable: true },
        { pubkey: fields.mint, isSigner: false, isWritable: false },
        { pubkey: fields.destination, isSigner: false, isWritable: true },
        { pubkey: fields.owner, isSigner: true, isWritable: false },
      ],
      data: transferCheckedData(fields.amount, fields.decimals),
    };
  }

  function createAtaIdempotentInstruction(fields) {
    return {
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: fields.payer, isSigner: true, isWritable: true },
        { pubkey: fields.ata, isSigner: false, isWritable: true },
        { pubkey: fields.owner, isSigner: false, isWritable: false },
        { pubkey: fields.mint, isSigner: false, isWritable: false },
        { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: createAtaIdempotentData(),
    };
  }

  function memoInstruction(fields) {
    return {
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: fields.signer, isSigner: true, isWritable: false }],
      data: new TextEncoder().encode(fields.memo),
    };
  }

  function computeUnitLimitInstruction(units) {
    return {
      programId: COMPUTE_BUDGET_PROGRAM_ID,
      keys: [],
      data: setComputeUnitLimitData(units == null ? COMPUTE_UNIT_LIMIT : units),
    };
  }

  function payoutInstructions(fields) {
    const instructions = [computeUnitLimitInstruction(fields.computeUnits)];
    if (fields.memo) instructions.push(memoInstruction({ memo: fields.memo, signer: fields.payer }));
    for (const transfer of fields.transfers) {
      if (transfer.createAta) {
        instructions.push(createAtaIdempotentInstruction({
          payer: fields.payer,
          ata: transfer.ata,
          owner: transfer.owner,
          mint: fields.mint,
        }));
      }
      instructions.push(transferCheckedInstruction({
        source: fields.sourceAta,
        mint: fields.mint,
        destination: transfer.ata,
        owner: fields.payer,
        amount: transfer.amount,
        decimals: USDC_DECIMALS,
      }));
    }
    return instructions;
  }

  function associatedTokenAddress(owner, mint, web3) {
    const PublicKey = web3.PublicKey;
    const ownerKey = new PublicKey(owner);
    const mintKey = new PublicKey(mint);
    const tokenProgram = new PublicKey(TOKEN_PROGRAM_ID);
    const ataProgram = new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ID);
    return PublicKey.findProgramAddressSync(
      [ownerKey.toBuffer(), tokenProgram.toBuffer(), mintKey.toBuffer()],
      ataProgram,
    )[0].toBase58();
  }

  function explorerTxUrl(signature, cluster) {
    const network = cluster == null ? 'devnet' : cluster;
    if (network !== 'devnet' || !isSignature(signature)) return '';
    return 'https://explorer.solana.com/tx/' + signature + '?cluster=devnet';
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  }

  function buildReportCsv(input) {
    const source = input || {};
    const rows = [[
      'Date', 'Reference', 'Type', 'Recipient', 'Amount USDC', 'Status',
      'Signature', 'Explorer URL', 'Cluster', 'Memo', 'Environment',
    ]];
    for (const payout of source.payouts || []) {
      for (const batch of payout.batches || []) {
        const url = explorerTxUrl(batch.signature, 'devnet');
        const recipients = batch.recipients && batch.recipients.length
          ? batch.recipients
          : [{ address: '', amount: payout.totalDisplay || '' }];
        for (const recipient of recipients) {
          rows.push([
            payout.createdAt || '',
            payout.reference || '',
            'Devnet USDC payout',
            recipient.address || '',
            recipient.amount || '',
            batch.status || payout.status || '',
            batch.signature || '',
            url,
            'devnet',
            payout.memo || '',
            'Solana devnet. Tokens have no cash value.',
          ]);
        }
      }
    }
    for (const row of source.demoRows || []) {
      rows.push([
        row.date || '',
        row.name || '',
        row.sub || row.type || '',
        '',
        row.amountDisplay == null ? row.amount : row.amountDisplay,
        row.status || '',
        '',
        '',
        '',
        '',
        'Fictional demo data',
      ]);
    }
    for (const proposal of source.proposals || []) {
      rows.push([
        '',
        proposal.name || '',
        proposal.type || '',
        '',
        proposal.amount == null ? '' : String(proposal.amount),
        proposal.status || '',
        '',
        '',
        '',
        '',
        'Local demo proposal',
      ]);
    }
    return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  }

  function friendlyTxError(input) {
    const error = input instanceof Error ? { message: input.message, code: input.code } : (input || {});
    const logs = Array.isArray(error.logs) ? error.logs.join('\n') : '';
    const errJson = error.err == null ? '' : JSON.stringify(error.err);
    const blob = [error.message || '', logs, errJson, error.code == null ? '' : String(error.code)].join('\n');
    if (/you declined the request in your wallet/i.test(blob)) return error.message;
    if (/user rejected|user denied|rejected the request|user cancelled|user canceled|\b4001\b/i.test(blob)) {
      return 'You declined the request in your wallet. Nothing was sent.';
    }
    if (/blockhash not found|block height exceeded|transaction expired|expired before/i.test(blob)) {
      return 'The blockhash expired before the transaction landed. Nothing new was sent for this step. Review the payout and try again.';
    }
    if (/429|too many requests|rate limit/i.test(blob)) {
      return 'The public devnet RPC is rate-limiting requests. Wait a few seconds and try again.';
    }
    if (/failed to fetch|networkerror|network request failed|load failed|econnrefused|timeout/i.test(blob)) {
      return 'The devnet RPC could not be reached. Check your connection and try again.';
    }
    if (/insufficient lamports|insufficient funds for fee|no record of a prior credit/i.test(blob)) {
      return 'This wallet does not have enough devnet SOL for fees and token-account rent. Use the Solana devnet faucet, then try again. Devnet SOL has no cash value.';
    }
    if (/insufficient funds|custom program error: 0x1|"Custom":1/i.test(blob)) {
      return 'This wallet does not have enough devnet USDC for this payout. Devnet USDC has no cash value. Use the Circle devnet faucet if you need test tokens.';
    }
    if (/transaction too large/i.test(blob)) {
      return 'This payout does not fit in a Solana transaction. Remove a recipient or shorten the memo.';
    }
    if (/simulation failed|instructionerror|error processing instruction/i.test(blob)) {
      return 'Simulation failed, so your wallet was not asked to sign. Check the recipient addresses and balances, then try again.';
    }
    if (/mainnet is not available/i.test(blob)) return 'Mainnet is not available yet. Vectra Lite only sends on devnet.';
    return 'The payout could not be completed. If your wallet did not ask you to sign, nothing was sent.';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char]));
  }

  function formatDonationNumber(amount) {
    const sign = amount < 0 ? '-' : '';
    const cents = Math.round(Math.abs(amount) * 100);
    const whole = Math.floor(cents / 100);
    const frac = cents % 100;
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    if (frac === 0) return sign + grouped;
    if (frac % 10 === 0) return sign + grouped + '.' + (frac / 10);
    return sign + grouped + '.' + String(frac).padStart(2, '0');
  }

  function formatPayAmount(amount) {
    const cents = Math.round(Math.abs(amount) * 100);
    const whole = Math.floor(cents / 100);
    const frac = cents % 100;
    if (frac === 0) return String(whole);
    if (frac % 10 === 0) return whole + '.' + (frac / 10);
    return whole + '.' + String(frac).padStart(2, '0');
  }

  function looseDonationNumber(raw) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { kind: 'empty' };
    let body = trimmed;
    if (body.startsWith('$')) body = body.slice(1).trim();
    if (!body) return { kind: 'empty' };
    if (body.startsWith('-') || body.startsWith('\u2212') || trimmed.startsWith('-')) return { kind: 'negative' };
    if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?$/.test(body)) {
      if (/^(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{3,}$/.test(body)) return { kind: 'decimals' };
      return { kind: 'invalid' };
    }
    if (body.endsWith('.')) return { kind: 'incomplete' };
    const fraction = body.includes('.') ? body.split('.')[1] : '';
    if (fraction.length > 2) return { kind: 'decimals' };
    const amount = Number(body.replace(/,/g, ''));
    if (!Number.isFinite(amount)) return { kind: 'invalid' };
    return { kind: 'number', amount };
  }

  function parseDonation(raw) {
    const loose = looseDonationNumber(raw);
    if (loose.kind === 'empty') return { ok: false, error: 'Enter a donation amount' };
    if (loose.kind === 'negative') return { ok: false, error: "Donation amount can't be negative" };
    if (loose.kind === 'invalid') return { ok: false, error: 'Enter a number, like 5,000' };
    if (loose.kind === 'decimals') return { ok: false, error: 'Use up to 2 decimal places' };
    if (loose.kind === 'incomplete') return { ok: false, incomplete: true, error: '' };
    if (loose.amount < DONATION_MIN) return { ok: false, error: 'Minimum donation is $1,999', amount: loose.amount };
    if (loose.amount > DONATION_MAX) return { ok: false, error: 'Maximum donation is $100,000', amount: loose.amount };
    return { ok: true, amount: loose.amount, error: '' };
  }

  function solanaPayLink(address, amount, mint) {
    const tokenMint = mint || DEVNET_USDC_MINT;
    if (!isSolanaAddress(address) || !isSolanaAddress(tokenMint)) return '';
    const params = new URLSearchParams({
      amount: formatPayAmount(amount),
      'spl-token': tokenMint,
      label: 'Vectra',
      message: 'Vectra devnet test. Tokens have no cash value.',
      cluster: 'devnet',
    });
    return 'solana:' + address + '?' + params.toString();
  }

  function bytesToBase64(bytes) {
    const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    let binary = '';
    for (let i = 0; i < input.length; i++) binary += String.fromCharCode(input[i]);
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  function readTokenAmount(data) {
    if (!data || data.length < 72) return null;
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(64, true);
  }

  return {
    DONATION_MIN,
    DONATION_MAX,
    DONATION_ADDRESS,
    DEVNET_USDC_MINT,
    MAINNET_USDC_MINT,
    RPC_ENDPOINT,
    SOL_FAUCET_URL,
    USDC_FAUCET_URL,
    USDC_DECIMALS,
    TX_SIZE_LIMIT,
    MAX_RECIPIENTS_PER_TX,
    MAX_RECIPIENTS,
    MEMO_MAX,
    TOKEN_ACCOUNT_SIZE,
    COMPUTE_UNIT_LIMIT,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MEMO_PROGRAM_ID,
    SYSTEM_PROGRAM_ID,
    COMPUTE_BUDGET_PROGRAM_ID,
    base58Decode,
    base58Encode,
    isSolanaAddress,
    isSignature,
    parseTokenAmount,
    formatBaseUnits,
    validatePayout,
    planBatches,
    transferCheckedData,
    createAtaIdempotentData,
    setComputeUnitLimitData,
    transferCheckedInstruction,
    createAtaIdempotentInstruction,
    memoInstruction,
    computeUnitLimitInstruction,
    payoutInstructions,
    associatedTokenAddress,
    explorerTxUrl,
    buildReportCsv,
    friendlyTxError,
    escapeHtml,
    formatDonationNumber,
    formatPayAmount,
    looseDonationNumber,
    parseDonation,
    solanaPayLink,
    bytesToBase64,
    base64ToBytes,
    readTokenAmount,
  };
});
