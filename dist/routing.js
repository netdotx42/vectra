const VectraRouting = (function () {
  const STORAGE_KEY = 'vectra-routing';
  const core = () => globalThis.VectraCore;
  const esc = (value) => core().escapeHtml(value == null ? '' : String(value));
  let ctx = { state: {}, notify() {} };
  let polling = 0;

  const model = {
    kind: 'single',
    routeMode: 'default',
    amount: '1',
    recipient: '',
    destinations: [{ address: '', amount: '0.5' }, { address: '', amount: '0.5' }],
    hops: '3',
    arrivalSeconds: '300',
    customHops: [{ wallet: '', waitSeconds: '120' }, { wallet: '', waitSeconds: '180' }],
    externalId: '',
    estimate: null,
    transfer: null,
    transferId: '',
    prepared: null,
    signatures: {},
    actions: {},
    payloads: {},
    pending: {},
    error: '',
    statusLine: '',
    mode: '',
    proxyOk: null,
    busy: false,
    log: [],
  };

  function proxy() {
    const meta = document.querySelector('meta[name="vectra-routing-proxy"]');
    const configured = meta && meta.content ? meta.content.trim().replace(/\/$/, '') : '';
    if (configured) return configured;
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:8787';
    return '';
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!saved || typeof saved !== 'object') return;
      ['kind', 'routeMode', 'amount', 'recipient', 'hops', 'arrivalSeconds', 'externalId', 'transferId', 'mode', 'statusLine'].forEach((key) => {
        if (typeof saved[key] === 'string') model[key] = saved[key];
      });
      if (Array.isArray(saved.destinations) && saved.destinations.length) model.destinations = saved.destinations;
      if (Array.isArray(saved.customHops) && saved.customHops.length) model.customHops = saved.customHops;
      if (saved.estimate && typeof saved.estimate === 'object') model.estimate = saved.estimate;
      if (saved.transfer && typeof saved.transfer === 'object') model.transfer = saved.transfer;
      if (saved.prepared && typeof saved.prepared === 'object') model.prepared = saved.prepared;
      if (saved.signatures && typeof saved.signatures === 'object') model.signatures = saved.signatures;
      if (saved.actions && typeof saved.actions === 'object') model.actions = saved.actions;
      if (saved.payloads && typeof saved.payloads === 'object') model.payloads = saved.payloads;
      if (saved.pending && typeof saved.pending === 'object') model.pending = saved.pending;
      if (Array.isArray(saved.log)) model.log = saved.log.slice(-12);
    } catch {
      /* A broken local record should not block a new route. */
    }
  }

  function save() {
    const copy = {
      kind: model.kind,
      routeMode: model.routeMode,
      amount: model.amount,
      recipient: model.recipient,
      destinations: model.destinations,
      hops: model.hops,
      arrivalSeconds: model.arrivalSeconds,
      customHops: model.customHops,
      externalId: model.externalId,
      estimate: model.estimate,
      transfer: model.transfer,
      transferId: model.transferId,
      prepared: model.prepared,
      signatures: model.signatures,
      actions: model.actions,
      payloads: model.payloads,
      pending: model.pending,
      statusLine: model.statusLine,
      mode: model.mode,
      log: model.log.slice(-12),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
  }

  function forget() {
    stopPoll();
    localStorage.removeItem(STORAGE_KEY);
    model.estimate = null;
    model.transfer = null;
    model.transferId = '';
    model.prepared = null;
    model.signatures = {};
    model.actions = {};
    model.payloads = {};
    model.pending = {};
    model.error = '';
    model.statusLine = '';
    model.log = [];
    paint();
  }

  function short(value) {
    const text = String(value || '');
    if (text.length < 12) return text;
    return text.slice(0, 4) + '…' + text.slice(-4);
  }

  function usdc(raw) {
    if (raw == null || raw === '') return '—';
    try { return core().formatBaseUnits(BigInt(raw), 6) + ' USDC'; } catch { return '—'; }
  }

  function sol(lamports) {
    if (lamports == null || lamports === '') return '—';
    try { return core().formatBaseUnits(BigInt(lamports), 9) + ' SOL'; } catch { return '—'; }
  }

  function duration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value)) return '—';
    if (value < 90) return value + ' seconds';
    if (value < 3600) return Math.round(value / 60) + ' minutes';
    if (value < 86400) return (value / 3600).toFixed(value % 3600 === 0 ? 0 : 1) + ' hours';
    return (value / 86400).toFixed(value % 86400 === 0 ? 0 : 1) + ' days';
  }

  function explorer(signature) {
    const href = core().explorerTxUrl(signature);
    if (!href) return esc(short(signature));
    const note = model.mode === 'mock' ? ' <small>(mock, not broadcast)</small>' : '';
    return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(short(signature))}</a>${note}`;
  }

  function capture() {
    const read = (id) => {
      const node = document.getElementById(id);
      return node ? node.value : null;
    };
    const amount = read('route-amount');
    if (amount != null) model.amount = amount;
    const recipient = read('route-recipient');
    if (recipient != null) model.recipient = recipient;
    const hops = read('route-hops');
    if (hops != null) model.hops = hops;
    const arrival = read('route-arrival');
    if (arrival != null) model.arrivalSeconds = arrival;
    const externalId = read('route-external');
    if (externalId != null) model.externalId = externalId;
    document.querySelectorAll('[data-dest]').forEach((row) => {
      const index = Number(row.getAttribute('data-dest'));
      if (!model.destinations[index]) return;
      const address = row.querySelector('[data-field="address"]');
      const destAmount = row.querySelector('[data-field="amount"]');
      if (address) model.destinations[index].address = address.value;
      if (destAmount) model.destinations[index].amount = destAmount.value;
    });
    document.querySelectorAll('[data-hop]').forEach((row) => {
      const index = Number(row.getAttribute('data-hop'));
      if (!model.customHops[index]) return;
      const wallet = row.querySelector('[data-field="wallet"]');
      const wait = row.querySelector('[data-field="wait"]');
      if (wallet) model.customHops[index].wallet = wallet.value;
      if (wait) model.customHops[index].waitSeconds = wait.value;
    });
  }

  function rawOf(text) {
    const parsed = core().parseTokenAmount(text, 6);
    if (!parsed.ok) throw new Error(parsed.error);
    return parsed.amount.toString();
  }

  function buildBody(includeSource) {
    capture();
    const body = {
      tokenMint: core().DEVNET_USDC_MINT,
      tokenDecimals: 6,
      tokenSymbol: 'USDC',
    };
    if (model.kind === 'multi') {
      const destinations = model.destinations.map((item) => ({
        wallet: item.address.trim(),
        amountRaw: rawOf(item.amount),
      }));
      const total = destinations.reduce((sum, item) => sum + BigInt(item.amountRaw), 0n);
      body.amountRaw = total.toString();
      body.amountTokens = core().formatBaseUnits(total, 6);
      body.destinations = destinations;
      body.destinationCount = destinations.length;
    } else {
      body.amountRaw = rawOf(model.amount);
      body.amountTokens = core().formatBaseUnits(BigInt(body.amountRaw), 6);
      body.recipientWallet = model.recipient.trim();
    }
    if (model.routeMode === 'custom') {
      body.route = {
        hops: model.customHops.map((hop) => ({
          wallet: hop.wallet.trim(),
          waitSeconds: Number(hop.waitSeconds),
        })),
      };
    } else {
      body.hops = Number(model.hops);
      body.arrivalSeconds = Number(model.arrivalSeconds);
    }
    if (model.externalId.trim()) body.externalId = model.externalId.trim();
    if (includeSource) {
      if (ctx.state.walletMode !== 'live' || !core().isSolanaAddress(ctx.state.publicKey)) {
        throw new Error('Connect Phantom, Solflare, or Backpack on devnet. The demo wallet cannot sign.');
      }
      body.sourceOwner = ctx.state.publicKey;
    }
    return body;
  }

  async function post(path, payload, actionName, options) {
    const base = proxy();
    if (!base) throw new Error('Set the vectra-routing-proxy meta tag to the deployed Worker origin, and allow that origin in the page CSP.');
    const body = JSON.stringify(payload);
    const same = model.payloads[actionName] === body;
    const fresh = options && options.fresh;
    if (!model.actions[actionName] || ((fresh || !same) && !model.pending[actionName])) {
      model.actions[actionName] = crypto.randomUUID();
    }
    model.payloads[actionName] = body;
    model.pending[actionName] = true;
    save();
    let response;
    try {
      response = await fetch(base + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vectra-action': model.actions[actionName],
        },
        body,
      });
    } catch {
      model.pending[actionName] = false;
      save();
      throw new Error('The routing proxy is not reachable at ' + base + '. For local mock mode run npm run routing:dev.');
    }
    const data = await response.json().catch(() => ({}));
    if (data.mode) model.mode = data.mode;
    model.pending[actionName] = false;
    if (!response.ok) {
      const code = data.error && data.error.code;
      if (response.status === 400 || code === 'MH_071') {
        delete model.actions[actionName];
        delete model.payloads[actionName];
      }
      save();
      const message = (data.error && data.error.message) || 'The routing proxy rejected that request.';
      const detail = data.error && data.error.detail ? ' ' + data.error.detail : '';
      throw new Error(message + detail);
    }
    save();
    return data;
  }

  async function getTransfer(id) {
    const base = proxy();
    if (!base) throw new Error('The routing proxy URL is not set.');
    const response = await fetch(base + '/v1/transfers/' + id);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((data.error && data.error.message) || 'Could not load that transfer.');
    if (data.mode) model.mode = data.mode;
    return data;
  }

  function hopsOf(transfer) {
    const route = transfer && transfer.route;
    const hops = route && Array.isArray(route.hops) ? route.hops : [];
    return hops;
  }

  function renderHops(hops) {
    if (!hops.length) return '<p class="route-note">Hop wallets appear after the transfer is created. A default route lets MultiHopper choose them.</p>';
    return `<div class="hop-list">${hops.map((hop) => {
      const screening = hop.screening;
      const screen = screening
        ? `<small>Screening: ${esc(screening.status || 'returned')} — ${esc(screening.message || 'No detail was included.')}</small>`
        : '<small>No per-hop screening result in this response.</small>';
      const when = hop.executedAt ? 'Executed ' + esc(hop.executedAt) : 'Scheduled ' + esc(hop.scheduledAt || '—');
      const sig = hop.txSignature ? `<small>Transaction ${explorer(hop.txSignature)}</small>` : '';
      return `<article class="hop"><strong>Hop ${esc(hop.index)} · ${esc(hop.label || hop.category || 'Wallet')}</strong><small>${esc(hop.address || 'Wallet is assigned on the live route')}</small><small>${when}${hop.waitSeconds != null ? ' · wait ' + esc(duration(hop.waitSeconds)) : ''}</small>${sig}${screen}</article>`;
    }).join('')}</div>`;
  }

  function renderQuote() {
    const quote = model.estimate;
    if (!quote) return '';
    const solQuote = quote.sol || {};
    const breakdown = solQuote.breakdown || {};
    const route = quote.route || {};
    return `<section class="panel" style="margin-top:14px"><h2>Estimate</h2><p class="route-note">Devnet tokens have no cash value. A mock estimate is a fixture. A live estimate is a devnet quote, not a mainnet price.</p>
      <div class="quote-row"><span>Percent fee</span><strong>${esc(quote.percentFeeBps)} basis points</strong></div>
      <div class="quote-row"><span>Token fee</span><strong>${esc(usdc(quote.percentFeeRaw))}</strong></div>
      <div class="quote-row"><span>Recipient receives</span><strong>${esc(usdc(quote.hopAmountRaw))}</strong></div>
      <div class="quote-row"><span>Flat network charge</span><strong>${esc(sol(quote.totalFlatFeeLamports))}</strong></div>
      <div class="quote-row"><span>SOL needed up front</span><strong>${esc(sol(solQuote.requiredSolUpFrontLamports))}</strong></div>
      <div class="quote-row"><span>Screening fee</span><strong>${esc(sol(breakdown.screeningFeeLamports))}</strong></div>
      <div class="quote-row"><span>Total time</span><strong>${esc(duration(route.arrivalSeconds))}</strong></div>
      <div class="quote-row"><span>Hops on the route</span><strong>${esc(route.hopCount)}</strong></div>
      <p class="route-note">USD figures are omitted unless MultiHopper returns one. Devnet USDC is not cash.</p></section>`;
  }

  function renderStatus() {
    const transfer = model.transfer;
    if (!transfer && !model.transferId) return '';
    const id = (transfer && transfer.id) || model.transferId;
    const status = (transfer && transfer.status) || 'unknown';
    const phase = transfer && transfer.phase ? ' · ' + transfer.phase : '';
    const progress = transfer && transfer.progress ? `${transfer.progress.hopsCompleted}/${transfer.progress.hopsTotal} hops` : '';
    const sigs = model.signatures || {};
    const signed = [
      sigs.keeperFundingSignature ? `<div class="quote-row"><span>Keeper funding</span><strong>${explorer(sigs.keeperFundingSignature)}</strong></div>` : '',
      ...(sigs.routeInitSignatures || []).map((signature, index) => `<div class="quote-row"><span>Route init ${index + 1}</span><strong>${explorer(signature)}</strong></div>`),
      sigs.orchestratorInitSignature ? `<div class="quote-row"><span>Orchestrator</span><strong>${explorer(sigs.orchestratorInitSignature)}</strong></div>` : '',
      ...(sigs.sessionInitSignatures || []).map((signature, index) => `<div class="quote-row"><span>Session ${index + 1}</span><strong>${explorer(signature)}</strong></div>`),
      ...(sigs.dispersionInitSignatures || []).map((signature, index) => `<div class="quote-row"><span>Destination setup ${index + 1}</span><strong>${explorer(signature)}</strong></div>`),
    ].join('');
    return `<section class="panel" style="margin-top:14px"><h2 id="routing-status">Transfer ${esc(id)}</h2>
      <div class="quote-row"><span>Status</span><strong>${esc(status)}${esc(phase)}</strong></div>
      <div class="quote-row"><span>Progress</span><strong>${esc(progress || model.statusLine || 'Waiting')}</strong></div>
      ${signed}
      ${renderHops(hopsOf(transfer))}
      <p class="route-note">${esc(model.statusLine)}</p>
      <div class="log">${model.log.map((line) => `<p class="route-note">${esc(line)}</p>`).join('')}</div>
    </section>`;
  }

  function modeBanner() {
    if (model.proxyOk === false) return `<div class="route-mock">The routing proxy did not respond at ${esc(proxy() || 'an unset URL')}. Local mock mode: <span class="mono">npm run routing:dev</span>.</div>`;
    if (model.mode === 'live') return '<div class="route-live">Live devnet. You approve every transaction in your wallet. Production MultiHopper stays locked.</div>';
    if (model.mode === 'mock') return '<div class="route-mock">Mock mode. No MultiHopper key is in use. Quotes, signatures, and hop status are fixtures. Nothing is sent to Solana.</div>';
    return '<div class="route-mock">Checking the routing proxy…</div>';
  }

  function customEditor() {
    if (model.routeMode !== 'custom') return '';
    const rows = model.customHops.map((hop, index) => `<div class="hop-editor" data-hop="${index}"><input data-field="wallet" aria-label="Hop ${index + 1} wallet" placeholder="Hop wallet" value="${esc(hop.wallet)}"><input data-field="wait" aria-label="Hop ${index + 1} wait seconds" inputmode="numeric" value="${esc(hop.waitSeconds)}"><button type="button" class="btn" data-remove-hop="${index}">Remove</button></div>`).join('');
    return `<div class="field"><label>Custom hops</label><p class="route-note">One recipient: 2 to 9 hops. Several destinations: 3 to 10 hops. Each wait is 20 seconds to 30 days, and the waits together stay within 30 days. Devnet has no hop library, so enter wallets yourself. The recipient is added after these hops.</p>${rows}<button type="button" class="btn" id="route-add-hop">Add hop</button></div>`;
  }

  function destinationEditor() {
    if (model.kind !== 'multi') {
      return `<div class="field"><label for="route-amount">Amount · devnet USDC</label><input id="route-amount" inputmode="decimal" value="${esc(model.amount)}" autocomplete="off"><small>At most 6 decimal places. Devnet USDC has no cash value.</small></div><div class="field"><label for="route-recipient">Recipient</label><input id="route-recipient" spellcheck="false" value="${esc(model.recipient)}" autocomplete="off" placeholder="Solana address"></div>`;
    }
    const rows = model.destinations.map((item, index) => `<div class="hop-editor" data-dest="${index}"><input data-field="address" aria-label="Destination ${index + 1} wallet" placeholder="Destination wallet" value="${esc(item.address)}"><input data-field="amount" aria-label="Destination ${index + 1} amount" inputmode="decimal" value="${esc(item.amount)}"><button type="button" class="btn" data-remove-dest="${index}">Remove</button></div>`).join('');
    return `<div class="field"><label>Destinations</label><p class="route-note">2 to 20 Solana wallets. Amounts are devnet USDC and must be the full payment. They are paid from the last hop.</p>${rows}<button type="button" class="btn" id="route-add-dest">Add destination</button></div>`;
  }

  function defaultEditor() {
    if (model.routeMode !== 'default') return '';
    return `<div class="field"><label for="route-hops">Hops</label><input id="route-hops" inputmode="numeric" value="${esc(model.hops)}"><small>3 to 10. MultiHopper chooses the hop wallets on a default route.</small></div><div class="field"><label for="route-arrival">Arrival · seconds</label><input id="route-arrival" inputmode="numeric" value="${esc(model.arrivalSeconds)}"><small>60 seconds to 30 days. ${esc(duration(model.arrivalSeconds))}.</small></div>`;
  }

  function view() {
    const order = `<ol class="route-note"><li>Keeper funding, then record that signature immediately.</li><li>Route init, in order.</li><li>Orchestrator init.</li><li>Session init.</li><li>Destination setup, when there are several recipients.</li><li>Confirm the rest.</li></ol>`;
    return `${modeBanner()}<div class="route-banner"><strong>Solana only.</strong> This is not a bridge. Funds move through timed hops as ordinary Solana transfers. Anyone can follow them. Routing does not make a transfer untraceable. You sign in your own wallet. This page never asks for a private key, and the MultiHopper API key stays on the Worker.</div>
      <div class="routing-grid"><section class="panel form-panel"><h2>Devnet USDC route</h2><div class="choice-row" role="group" aria-label="Recipients"><button type="button" class="btn" id="route-kind-single" aria-pressed="${model.kind === 'single'}">One recipient</button><button type="button" class="btn" id="route-kind-multi" aria-pressed="${model.kind === 'multi'}">Several destinations</button></div><div class="choice-row" role="group" aria-label="Route style"><button type="button" class="btn" id="route-mode-default" aria-pressed="${model.routeMode === 'default'}">Default route</button><button type="button" class="btn" id="route-mode-custom" aria-pressed="${model.routeMode === 'custom'}">Custom hops</button></div>${destinationEditor()}${defaultEditor()}${customEditor()}<div class="field"><label for="route-external">Reference · optional</label><input id="route-external" value="${esc(model.externalId)}" maxlength="64" autocomplete="off"><small>Letters, numbers, dot, underscore, hyphen. Retries of the same click reuse one idempotency key.</small></div><p id="routing-error" class="error">${esc(model.error)}</p><div class="routing-actions"><button type="button" class="btn" id="route-estimate" ${model.busy ? 'disabled' : ''}>Estimate</button><button type="button" class="btn primary" id="route-create" ${model.busy ? 'disabled' : ''}>Create quote</button><button type="button" class="btn" id="route-prepare" ${model.busy || !model.transferId ? 'disabled' : ''}>Prepare</button><button type="button" class="btn primary" id="route-broadcast" ${model.busy || !model.prepared ? 'disabled' : ''}>Sign and broadcast</button><button type="button" class="btn" id="route-refresh" ${model.busy || !model.transferId ? 'disabled' : ''}>Refresh status</button><button type="button" class="btn" id="route-forget">Forget local transfer</button></div></section><section class="panel"><h2>What you will sign</h2>${order}<p class="route-note">Keeper funding is recorded before the other transactions so a reload does not pay it twice. If a blockhash expires, choose Prepare again. The new prepare is a new action. Devnet SOL and devnet USDC have no cash value.</p>${renderQuote()}${renderStatus()}</section></div>`;
  }

  function paint() {
    const root = document.getElementById('routing-root');
    if (!root) return;
    root.innerHTML = view();
    const pill = document.getElementById('routing-mode-pill');
    if (pill) pill.textContent = model.mode === 'live' ? 'Live devnet' : (model.mode === 'mock' ? 'Mock' : 'Devnet');
    bind();
  }

  function note(message) {
    model.log.push(message);
    model.log = model.log.slice(-12);
    model.statusLine = message;
    save();
  }

  async function run(action) {
    if (model.busy) return;
    capture();
    model.busy = true;
    model.error = '';
    paint();
    try {
      await action();
    } catch (error) {
      model.error = error && error.message ? error.message : 'The route could not continue.';
      if (ctx.notify) ctx.notify(model.error);
    } finally {
      model.busy = false;
      save();
      paint();
    }
  }

  async function onEstimate() {
    model.estimate = await post('/v1/transfers/estimate', buildBody(false), 'estimate', { fresh: true });
    note(model.mode === 'mock' ? 'Mock estimate ready.' : 'Devnet estimate ready.');
  }

  async function onCreate() {
    if (model.transferId) throw new Error('A quote is already stored in this browser. Forget it before creating another.');
    const data = await post('/v1/transfers', buildBody(true), 'create');
    model.transfer = data;
    model.transferId = String(data.id || '');
    model.prepared = null;
    model.signatures = {};
    note('Quote ' + model.transferId + ' created. Prepare next, then sign in your wallet.');
    save();
  }

  async function onPrepare() {
    if (!model.transferId) throw new Error('Create a quote before preparing transactions.');
    const data = await post('/v1/transfers/' + model.transferId + '/prepare', {}, 'prepare', { fresh: true });
    model.prepared = data;
    if (data.transfer) model.transfer = { ...model.transfer, ...data.transfer };
    note('Transactions are ready. Sign keeper funding first.');
    save();
  }

  function txBytes(value) {
    const base64 = typeof value === 'string' ? value : value && value.base64;
    if (!base64) throw new Error('A prepared transaction was empty.');
    return core().base64ToBytes(base64);
  }

  function deserialize(bytes) {
    try { return solanaWeb3.VersionedTransaction.deserialize(bytes); } catch { return solanaWeb3.Transaction.from(bytes); }
  }

  async function mockSignature(seed) {
    const first = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed)));
    const second = new Uint8Array(await crypto.subtle.digest('SHA-256', first));
    const bytes = new Uint8Array(64);
    bytes.set(first, 0);
    bytes.set(second, 32);
    return core().base58Encode(bytes);
  }

  async function signLocally(encoded, label) {
    const features = ctx.state.wallet && ctx.state.wallet.features;
    const signer = features && features['solana:signTransaction'];
    if (signer && signer.signTransaction) {
      const tx = deserialize(txBytes(encoded));
      await VectraWallet.sign(ctx.state.wallet, ctx.state.account, tx);
    }
    const signature = await mockSignature(label + ':' + model.transferId);
    note(label + ' signed locally. Mock mode did not broadcast it.');
    return signature;
  }

  async function signAndSend(encoded, label, height) {
    if (model.mode !== 'live') return signLocally(encoded, label);
    const bytes = txBytes(encoded);
    const tx = deserialize(bytes);
    const signed = await VectraWallet.sign(ctx.state.wallet, ctx.state.account, tx);
    if (signed.mode === 'sent') {
      note(label + ' was sent by the wallet.');
      return signed.signature;
    }
    const signature = await VectraChain.sendRaw(signed.raw);
    await VectraChain.confirm(signature, height);
    note(label + ' confirmed on devnet.');
    return signature;
  }

  async function onBroadcast() {
    const prepared = model.prepared && model.prepared.preparedTxs;
    if (!prepared) throw new Error('Prepare the transfer before signing.');
    if (ctx.state.walletMode !== 'live') throw new Error('Connect Phantom, Solflare, or Backpack on devnet. The demo wallet cannot sign.');
    const height = prepared.lastValidBlockHeight;
    model.signatures.routeInitSignatures = model.signatures.routeInitSignatures || [];
    model.signatures.sessionInitSignatures = model.signatures.sessionInitSignatures || [];
    model.signatures.dispersionInitSignatures = model.signatures.dispersionInitSignatures || [];
    if (prepared.keeperFundingTx && !model.signatures.keeperFundingSignature) {
      model.signatures.keeperFundingSignature = await signAndSend(prepared.keeperFundingTx, 'Keeper funding', height);
      save();
    }
    if (model.signatures.keeperFundingSignature && !model.signatures.keeperRecorded) {
      await post('/v1/transfers/' + model.transferId + '/confirm-broadcast', {
        routeInitSignatures: [],
        keeperFundingSignature: model.signatures.keeperFundingSignature,
      }, 'confirm-keeper');
      model.signatures.keeperRecorded = true;
      save();
      note('Keeper funding signature recorded.');
    }
    const routeTxs = Array.isArray(prepared.routeInitTxs) ? prepared.routeInitTxs : [];
    for (let index = 0; index < routeTxs.length; index += 1) {
      if (model.signatures.routeInitSignatures[index]) continue;
      model.signatures.routeInitSignatures[index] = await signAndSend(routeTxs[index], 'Route init ' + (index + 1), height);
      save();
    }
    if (prepared.orchestratorInitTx && !model.signatures.orchestratorInitSignature) {
      model.signatures.orchestratorInitSignature = await signAndSend(prepared.orchestratorInitTx, 'Orchestrator init', height);
      save();
    }
    const sessionTxs = Array.isArray(prepared.sessionInitTxs) ? prepared.sessionInitTxs : [];
    for (let index = 0; index < sessionTxs.length; index += 1) {
      if (model.signatures.sessionInitSignatures[index]) continue;
      model.signatures.sessionInitSignatures[index] = await signAndSend(sessionTxs[index], 'Session init ' + (index + 1), height);
      save();
    }
    const dispersionTxs = Array.isArray(prepared.dispersionInitTxs) ? prepared.dispersionInitTxs : [];
    for (let index = 0; index < dispersionTxs.length; index += 1) {
      if (model.signatures.dispersionInitSignatures[index]) continue;
      model.signatures.dispersionInitSignatures[index] = await signAndSend(dispersionTxs[index], 'Destination setup ' + (index + 1), height);
      save();
    }
    const body = { routeInitSignatures: model.signatures.routeInitSignatures.filter(Boolean) };
    if (model.signatures.keeperFundingSignature) body.keeperFundingSignature = model.signatures.keeperFundingSignature;
    if (model.signatures.orchestratorInitSignature) body.orchestratorInitSignature = model.signatures.orchestratorInitSignature;
    if (model.signatures.sessionInitSignatures.length) body.sessionInitSignatures = model.signatures.sessionInitSignatures.filter(Boolean);
    if (model.signatures.dispersionInitSignatures.length) body.dispersionInitSignatures = model.signatures.dispersionInitSignatures.filter(Boolean);
    const confirmed = await post('/v1/transfers/' + model.transferId + '/confirm-broadcast', body, 'confirm-final');
    if (confirmed.transfer) model.transfer = { ...model.transfer, ...confirmed.transfer };
    note('Broadcast reported. Hop status updates as keepers run. This does not hide the transfers.');
    await refresh();
    startPoll();
  }

  async function refresh() {
    if (!model.transferId) return;
    const data = await getTransfer(model.transferId);
    model.transfer = data;
    const status = data.status || '';
    if (status === 'completed' || status === 'failed' || status === 'expired' || status === 'refunded') stopPoll();
    save();
  }

  function startPoll() {
    stopPoll();
    polling = window.setInterval(() => {
      if (!document.getElementById('routing-root')) {
        stopPoll();
        return;
      }
      refresh().then(paint).catch(() => {});
    }, 8000);
  }

  function stopPoll() {
    if (polling) window.clearInterval(polling);
    polling = 0;
  }

  async function health() {
    const base = proxy();
    if (!base) {
      model.proxyOk = false;
      paint();
      return;
    }
    try {
      const response = await fetch(base + '/health');
      const data = await response.json().catch(() => ({}));
      model.proxyOk = response.ok;
      model.mode = data.mode || model.mode;
    } catch {
      model.proxyOk = false;
    }
    if (model.transferId && model.proxyOk) {
      try { await refresh(); } catch { /* The form still loads if status cannot be read yet. */ }
    }
    paint();
  }

  function bind() {
    const click = (id, fn) => {
      const node = document.getElementById(id);
      if (node) node.addEventListener('click', fn);
    };
    click('route-kind-single', () => { capture(); model.kind = 'single'; paint(); });
    click('route-kind-multi', () => { capture(); model.kind = 'multi'; paint(); });
    click('route-mode-default', () => { capture(); model.routeMode = 'default'; paint(); });
    click('route-mode-custom', () => { capture(); model.routeMode = 'custom'; paint(); });
    click('route-add-hop', () => {
      capture();
      if (model.customHops.length >= 10) return;
      model.customHops.push({ wallet: '', waitSeconds: '120' });
      paint();
    });
    click('route-add-dest', () => {
      capture();
      if (model.destinations.length >= 20) return;
      model.destinations.push({ address: '', amount: '' });
      paint();
    });
    document.querySelectorAll('[data-remove-hop]').forEach((button) => {
      button.addEventListener('click', () => {
        capture();
        const index = Number(button.getAttribute('data-remove-hop'));
        if (model.customHops.length <= 2) return;
        model.customHops.splice(index, 1);
        paint();
      });
    });
    document.querySelectorAll('[data-remove-dest]').forEach((button) => {
      button.addEventListener('click', () => {
        capture();
        const index = Number(button.getAttribute('data-remove-dest'));
        if (model.destinations.length <= 2) return;
        model.destinations.splice(index, 1);
        paint();
      });
    });
    click('route-estimate', () => run(onEstimate));
    click('route-create', () => run(onCreate));
    click('route-prepare', () => run(onPrepare));
    click('route-broadcast', () => run(onBroadcast));
    click('route-refresh', () => run(refresh));
    click('route-forget', () => forget());
  }

  function mount(next) {
    ctx = next || ctx;
    stopPoll();
    load();
    paint();
    health();
  }

  return { mount };
})();
globalThis.VectraRouting = VectraRouting;
