const VectraWallet = (function () {
  const KNOWN = [
    { match: /phantom/i, install: 'https://phantom.app/download' },
    { match: /solflare/i, install: 'https://solflare.com/download' },
    { match: /backpack/i, install: 'https://backpack.app/download' },
  ];
  const registered = new Set();
  const listeners = new Set();
  let started = false;

  function emit() {
    listeners.forEach((listener) => {
      try { listener(); } catch { /* A listener bug must not break discovery. */ }
    });
  }

  function register(...wallets) {
    const added = [];
    wallets.forEach((wallet) => {
      if (!wallet || registered.has(wallet)) return;
      registered.add(wallet);
      added.push(wallet);
    });
    if (!added.length) return function noop() {};
    emit();
    return function unregister() {
      added.forEach((wallet) => registered.delete(wallet));
      emit();
    };
  }

  function start() {
    if (started || typeof window === 'undefined') return;
    started = true;
    const api = Object.freeze({ register });
    window.addEventListener('wallet-standard:register-wallet', (event) => {
      const callback = event && event.detail;
      if (typeof callback !== 'function') return;
      try { callback(api); } catch { /* Ignore a wallet that fails while registering. */ }
    });
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
    } catch { /* Discovery continues through the register event. */ }
    try {
      const existing = window.navigator.wallets;
      const push = (...callbacks) => {
        callbacks.forEach((callback) => {
          try { if (typeof callback === 'function') callback(api); } catch { /* Ignore legacy wallet errors. */ }
        });
      };
      if (Array.isArray(existing)) push(...existing);
      Object.defineProperty(window.navigator, 'wallets', { configurable: true, value: Object.freeze({ push }) });
    } catch { /* Some browsers lock navigator.wallets. The standard events still work. */ }
  }

  function listSupported() {
    const found = [];
    registered.forEach((wallet) => {
      const name = String(wallet.name || '');
      if (!KNOWN.some((item) => item.match.test(name))) return;
      const chains = Array.isArray(wallet.chains) ? wallet.chains.map(String) : [];
      if (!chains.some((chain) => chain.startsWith('solana:'))) return;
      if (!wallet.features || !wallet.features['standard:connect']) return;
      found.push(wallet);
    });
    return found;
  }

  function installs() {
    return [
      { name: 'Phantom', url: KNOWN[0].install },
      { name: 'Solflare', url: KNOWN[1].install },
      { name: 'Backpack', url: KNOWN[2].install },
    ];
  }

  function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function pickAccount(accounts) {
    const list = Array.isArray(accounts) ? accounts : [];
    return list.find((account) => (account.chains || []).includes('solana:devnet'))
      || list.find((account) => (account.chains || []).some((chain) => String(chain).startsWith('solana:')))
      || null;
  }

  async function connect(wallet) {
    const feature = wallet.features && wallet.features['standard:connect'];
    if (!feature || !feature.connect) throw new Error('This wallet does not support Wallet Standard connect.');
    let result;
    try {
      result = await feature.connect();
    } catch (error) {
      throw new Error(globalThis.VectraCore.friendlyTxError(error));
    }
    const account = pickAccount(result && result.accounts);
    if (!account || !globalThis.VectraCore.isSolanaAddress(account.address)) {
      throw new Error('The wallet did not share a Solana address. Switch it to Devnet and try again.');
    }
    return {
      account,
      needsDevnetHint: !(account.chains || []).includes('solana:devnet'),
    };
  }

  async function disconnect(wallet) {
    const feature = wallet && wallet.features && wallet.features['standard:disconnect'];
    if (!feature || !feature.disconnect) return;
    try { await feature.disconnect(); } catch { /* The local session still clears. */ }
  }

  function watch(wallet, listener) {
    const feature = wallet && wallet.features && wallet.features['standard:events'];
    if (!feature || !feature.on) return function noop() {};
    try {
      return feature.on('change', (properties) => {
        try { listener(properties || {}); } catch { /* Ignore UI refresh errors. */ }
      });
    } catch {
      return function noop() {};
    }
  }

  async function sign(wallet, account, tx) {
    const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    const bytes = raw instanceof Uint8Array ? new Uint8Array(raw) : Uint8Array.from(raw);
    const input = { account, transaction: bytes, chain: 'solana:devnet' };
    const signer = wallet.features && wallet.features['solana:signTransaction'];
    const sender = wallet.features && wallet.features['solana:signAndSendTransaction'];
    try {
      if (signer && signer.signTransaction) {
        const outputs = await signer.signTransaction(input);
        const signed = outputs && outputs[0] && outputs[0].signedTransaction;
        if (!signed) throw new Error('The wallet did not return a signed transaction.');
        return { mode: 'signed', raw: signed instanceof Uint8Array ? signed : Uint8Array.from(signed) };
      }
      if (sender && sender.signAndSendTransaction) {
        const outputs = await sender.signAndSendTransaction(input);
        const signatureBytes = outputs && outputs[0] && outputs[0].signature;
        if (!signatureBytes) throw new Error('The wallet did not return a signature.');
        if (typeof signatureBytes === 'string' && globalThis.VectraCore.isSignature(signatureBytes)) {
          return { mode: 'sent', signature: signatureBytes };
        }
        const signature = globalThis.VectraCore.base58Encode(signatureBytes instanceof Uint8Array ? signatureBytes : Uint8Array.from(signatureBytes));
        return { mode: 'sent', signature };
      }
    } catch (error) {
      if (String(error && error.message || '').startsWith('The wallet did not')) throw error;
      throw new Error(globalThis.VectraCore.friendlyTxError(error));
    }
    throw new Error('This wallet cannot sign Solana transactions. Try Phantom, Solflare, or Backpack.');
  }

  return { start, listSupported, installs, onChange, connect, disconnect, watch, sign };
})();
