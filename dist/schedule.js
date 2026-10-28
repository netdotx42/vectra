globalThis.VectraSchedule = (function () {
  const core = () => globalThis.VectraCore;
  const app = () => globalThis.VectraApp;
  const SESSION_KEY = 'vectra-scheduler-session';
  let cache = {
    at: 0,
    loading: false,
    error: '',
    schedules: [],
    runs: [],
    inbox: [],
  };
  let pending = null;

  function origin() {
    const raw = String(globalThis.SCHEDULER_API_URL || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
      if (url.username || url.password) return '';
      if (!local && url.protocol !== 'https:') return '';
      return url.origin;
    } catch {
      return '';
    }
  }

  function isRemote() {
    return !!origin();
  }

  function esc(value) {
    return core().escapeHtml(value);
  }

  function session() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '');
      if (!saved || !saved.token || !saved.wallet) return null;
      if (saved.expiresAt && Date.parse(saved.expiresAt) <= Date.now()) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return saved;
    } catch {
      return null;
    }
  }

  function saveSession(value) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function api(path, options) {
    const headers = { accept: 'application/json' };
    const current = session();
    if (current) headers.authorization = 'Bearer ' + current.token;
    const settings = options || {};
    if (settings.body) headers['content-type'] = 'application/json';
    const response = await fetch(origin() + path, {
      method: settings.method || 'GET',
      headers,
      body: settings.body ? JSON.stringify(settings.body) : undefined,
    });
    let data = {};
    try { data = await response.json(); } catch { data = {}; }
    if (response.status === 401) clearSession();
    if (!response.ok) throw new Error(data.error || 'The scheduler request failed.');
    return data;
  }

  function shouldPaint() {
    const page = app()?.state?.page;
    return page === 'Distributions' || page === 'Overview';
  }

  async function load() {
    const current = session();
    if (!current) {
      cache = { at: Date.now(), loading: false, error: '', schedules: [], runs: [], inbox: [] };
      return;
    }
    const [schedules, runs, inbox] = await Promise.all([
      api('/v1/schedules'),
      api('/v1/runs'),
      api('/v1/inbox'),
    ]);
    cache.schedules = schedules.schedules || [];
    cache.runs = runs.runs || [];
    cache.inbox = inbox.inbox || [];
    cache.error = '';
    cache.at = Date.now();
  }

  function refresh(force) {
    if (!isRemote()) return;
    if (cache.loading) return;
    if (!force && cache.at && Date.now() - cache.at < 15000) return;
    cache.loading = true;
    load().catch((error) => {
      cache.error = error.message || 'The scheduler could not be reached.';
      cache.at = Date.now();
    }).finally(() => {
      cache.loading = false;
      if (shouldPaint() && app()) app().render();
    });
  }

  function walletReady() {
    const state = app().state;
    const current = session();
    if (!current) return 'Sign in with the wallet that owns these schedules.';
    if (state.walletMode !== 'live') return 'Connect Phantom, Solflare, or Backpack on devnet. The simulated demo wallet cannot sign.';
    if (state.publicKey !== current.wallet) return 'Connected wallet does not match the scheduler sign-in. Sign in again with this wallet.';
    return '';
  }

  function scheduleLine(item) {
    const when = item.nextDueAt ? new Date(item.nextDueAt).toLocaleString() : 'No further run';
    const count = (item.recipients || []).length;
    return `<div class="run-card"><div class="run-top"><div><strong>${esc(item.name)}</strong><small>${esc(item.frequency)} · ${esc(item.timezone)} · ${count} recipient${count === 1 ? '' : 's'} · devnet USDC</small><div>${esc(when)}</div></div><span class="status">${esc(item.status)}</span></div><div class="run-actions">${item.status === 'active' ? `<button type="button" class="btn" data-schedule-action="pause" data-id="${esc(item.id)}">Pause</button>` : ''}${item.status === 'paused' ? `<button type="button" class="btn" data-schedule-action="resume" data-id="${esc(item.id)}">Resume</button>` : ''}<button type="button" class="btn" data-schedule-action="delete" data-id="${esc(item.id)}">Delete</button></div></div>`;
  }

  function runLine(item) {
    const amounts = (item.recipients || []).map((row) => esc(row.amount) + ' USDC to ' + esc(row.address)).join('<br>');
    const actions = item.status === 'awaiting_signature'
      ? `<button type="button" class="btn primary" data-schedule-action="review-run" data-id="${esc(item.id)}">Review and sign</button><button type="button" class="btn" data-schedule-action="skip-run" data-id="${esc(item.id)}">Skip</button>`
      : '';
    const signatures = (item.signatures || []).length ? `<small>Signatures recorded: ${(item.signatures || []).map((value) => esc(value)).join(', ')}</small>` : '';
    return `<div class="run-card"><div class="run-top"><div><strong>${esc(item.name)}</strong><small>Due ${esc(item.dueAt)} · devnet · nothing sends until you sign</small><div>${amounts}</div>${signatures}</div><span class="status ${item.status === 'awaiting_signature' ? 'pending' : ''}">${esc(item.status)}</span></div><div class="run-actions">${actions}</div></div>`;
  }

  function page() {
    refresh(false);
    const current = session();
    const banner = '<div class="notice scheduler-note">Scheduler mode. The Worker stores the plan and prepares a run when it is due. It never holds a key and never sends USDC. You sign each run in your wallet.</div>';
    if (!current) {
      return app().pageHeading('Distributions', 'Keep your team funded. Keep control of every payment.', `<button type="button" class="btn primary" data-schedule-action="login">Sign in with wallet</button>`)
        + app().devnetBanner()
        + banner
        + `<section class="panel" style="padding:22px"><h2>Sign in to scheduled payouts</h2><p>Use Phantom, Solflare, or Backpack. The signature only logs you in. The simulated demo wallet cannot sign in.</p>${cache.error ? `<p class="error">${esc(cache.error)}</p>` : ''}<button type="button" class="btn primary" data-schedule-action="login">Sign in with wallet</button></section>`;
    }
    const due = cache.runs.filter((item) => item.status === 'awaiting_signature');
    const body = cache.loading && !cache.at
      ? '<p class="scheduler-empty">Loading schedules…</p>'
      : `<section class="panel"><div class="panel-head"><h2>Due runs</h2><span class="pill">${due.length} waiting for a signature</span></div>${due.length ? due.map(runLine).join('') : '<div class="run-card scheduler-empty">No payout is waiting. A due schedule appears here. It stays unsigned until you approve it.</div>'}</section><section class="panel"><div class="panel-head"><h2>Schedules</h2><span class="pill">${cache.schedules.length} on the scheduler</span></div>${cache.schedules.length ? cache.schedules.map(scheduleLine).join('') : '<div class="run-card scheduler-empty">No remote schedules yet.</div>'}</section>`;
    return app().pageHeading('Distributions', 'Keep your team funded. Keep control of every payment.', `<button type="button" class="btn" data-schedule-action="logout">Sign out</button><button type="button" class="btn primary" data-action="schedule">${app().icon('plus')} Create schedule</button>`)
      + app().devnetBanner()
      + banner
      + `<p class="scheduler-note">Signed in as <span class="mono">${esc(current.wallet)}</span>. Devnet USDC only. Mainnet is locked.</p>`
      + (cache.error ? `<p class="error">${esc(cache.error)}</p>` : '')
      + body;
  }

  function upcomingHtml() {
    refresh(false);
    const due = cache.runs.filter((item) => item.status === 'awaiting_signature').slice(0, 3);
    if (!session()) return '<div class="schedule-item"><div class="schedule-title">Scheduler sign-in<small>Open Distributions and sign in with your wallet</small></div></div>';
    if (!due.length) return '<div class="schedule-item"><div class="schedule-title">No payout is waiting on a signature<small>Remote schedules do not send by themselves</small></div></div>';
    return due.map((item) => `<div class="schedule-item"><div class="schedule-line"><div class="schedule-title">${esc(item.name)}<small>${esc(item.status)} · devnet USDC</small></div></div><div class="schedule-date"><span>${esc(item.dueAt)}</span></div></div>`).join('');
  }

  function zones() {
    const common = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo', 'Europe/London', 'Europe/Berlin', 'Asia/Singapore', 'Asia/Tokyo', 'Pacific/Auckland'];
    let local = 'UTC';
    try { local = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { local = 'UTC'; }
    if (!common.includes(local)) common.unshift(local);
    return common.map((zone) => `<option${zone === local ? ' selected' : ''}>${esc(zone)}</option>`).join('');
  }

  function recipientRow() {
    return `<div class="recipient scheduler-recipient"><input aria-label="Recipient wallet address" placeholder="Solana wallet address" autocapitalize="off" spellcheck="false" required><input aria-label="Amount in USDC" placeholder="0.00" inputmode="decimal" autocomplete="off" required><button type="button" class="icon-btn" data-schedule-action="remove-recipient" aria-label="Remove recipient">${app().icon('close', 14)}</button></div>`;
  }

  function openCreate() {
    const current = session();
    if (!current) {
      app().notify('Sign in with your wallet before creating a remote schedule.');
      login().catch((error) => app().notify(error.message));
      return;
    }
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((name, index) => `<option value="${index}">${name}</option>`).join('');
    const monthDays = Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('') + '<option value="last">Last day</option>';
    app().modal('Create a schedule', `<p class="lead">The Worker will prepare this payout when it is due. Your wallet still has to sign. Nothing is sent from the server.</p><form id="scheduler-form"><div class="field"><label for="sched-name">Schedule name</label><input id="sched-name" maxlength="70" required placeholder="Contributor payroll"></div><div class="field"><label>Recipients and devnet USDC</label><div id="sched-recipients">${recipientRow()}</div><button type="button" class="text-btn" data-schedule-action="add-recipient">${app().icon('plus', 13)} Add recipient</button></div><div class="field"><label for="sched-memo">Memo · optional</label><input id="sched-memo" maxlength="280" autocomplete="off"></div><div class="form-row"><div class="field"><label for="sched-frequency">Frequency</label><select id="sched-frequency"><option value="once">One-time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div><div class="field"><label for="sched-zone">Timezone</label><select id="sched-zone">${zones()}</select></div></div><div class="form-row"><div class="field" id="sched-date-field"><label for="sched-date">Local date</label><input id="sched-date" type="date" required></div><div class="field" id="sched-weekday-field" hidden><label for="sched-weekday">Weekday</label><select id="sched-weekday">${days}</select></div><div class="field" id="sched-day-field" hidden><label for="sched-day">Day of month</label><select id="sched-day">${monthDays}</select></div><div class="field"><label for="sched-hour">Hour</label><input id="sched-hour" type="number" min="0" max="23" value="9" required></div><div class="field"><label for="sched-minute">Minute</label><input id="sched-minute" type="number" min="0" max="59" value="0" required></div></div><div class="field"><label for="sched-webhook">Webhook URL · optional</label><input id="sched-webhook" type="url" inputmode="url" placeholder="https://example.com/hooks/vectra" maxlength="300"><small>https only. The Worker POSTs a JSON notice. It does not send email.</small></div><div class="notice">Network is devnet. A missed run expires after the grace period instead of sending itself. Day 31 is clamped to the last day of shorter months. A spring-forward gap uses the next valid local minute.</div><div class="error" id="sched-error" role="alert"></div><button class="btn primary full" type="submit">Save schedule</button></form>`);
    const today = new Date().toISOString().slice(0, 10);
    const date = document.getElementById('sched-date');
    if (date) date.value = today;
    document.getElementById('sched-frequency').addEventListener('change', syncFrequency);
    syncFrequency();
  }

  function syncFrequency() {
    const frequency = document.getElementById('sched-frequency')?.value;
    const dateField = document.getElementById('sched-date-field');
    const weekField = document.getElementById('sched-weekday-field');
    const dayField = document.getElementById('sched-day-field');
    if (!dateField) return;
    dateField.hidden = frequency !== 'once';
    weekField.hidden = frequency !== 'weekly';
    dayField.hidden = frequency !== 'monthly';
    document.getElementById('sched-date').required = frequency === 'once';
  }

  async function submitCreate() {
    const error = document.getElementById('sched-error');
    const rows = [...document.querySelectorAll('.scheduler-recipient')].map((row) => ({
      address: row.children[0].value.trim(),
      amount: row.children[1].value.trim(),
    }));
    const frequency = document.getElementById('sched-frequency').value;
    const body = {
      name: document.getElementById('sched-name').value.trim(),
      frequency,
      timezone: document.getElementById('sched-zone').value,
      hour: Number(document.getElementById('sched-hour').value),
      minute: Number(document.getElementById('sched-minute').value),
      recipients: rows,
      memo: document.getElementById('sched-memo').value,
      webhookUrl: document.getElementById('sched-webhook').value.trim(),
      network: 'devnet',
    };
    if (frequency === 'once') body.date = document.getElementById('sched-date').value;
    if (frequency === 'weekly') body.weekday = Number(document.getElementById('sched-weekday').value);
    if (frequency === 'monthly') {
      const day = document.getElementById('sched-day').value;
      body.dayOfMonth = day === 'last' ? 'last' : Number(day);
    }
    try {
      await api('/v1/schedules', { method: 'POST', body });
      app().close();
      app().notify('Schedule saved. A due run still needs your signature.');
      await load();
      app().render();
    } catch (failure) {
      if (error) error.textContent = failure.message;
    }
  }

  async function login() {
    const state = app().state;
    if (state.walletMode !== 'live' || !state.wallet || !state.account) {
      throw new Error('Connect Phantom, Solflare, or Backpack on devnet first. The simulated demo wallet cannot sign in.');
    }
    const feature = state.wallet.features && state.wallet.features['solana:signMessage'];
    if (!feature || !feature.signMessage) {
      throw new Error('This wallet cannot sign the scheduler login. Use Phantom, Solflare, or Backpack.');
    }
    const challenge = await api('/v1/auth/nonce', { method: 'POST', body: { wallet: state.publicKey } });
    const message = new TextEncoder().encode(challenge.message);
    const signed = await feature.signMessage({ account: state.account, message });
    const output = Array.isArray(signed) ? signed[0] : signed;
    const signature = output && output.signature;
    if (!signature) throw new Error('The wallet did not return a login signature.');
    const verified = await api('/v1/auth/verify', {
      method: 'POST',
      body: {
        wallet: state.publicKey,
        nonce: challenge.nonce,
        signature: core().base58Encode(signature instanceof Uint8Array ? signature : Uint8Array.from(signature)),
      },
    });
    saveSession({ token: verified.token, wallet: verified.wallet, expiresAt: verified.expiresAt });
    await load();
    app().notify('Signed in. This signature did not send USDC.');
    app().render();
  }

  function openInbox() {
    refresh(true);
    const current = session();
    if (!current) {
      app().modal('Scheduler inbox', '<p>Sign in on Distributions to read prepared-run notices. No email is sent.</p><button type="button" class="btn primary full" data-schedule-action="login">Sign in with wallet</button>');
      return;
    }
    const items = cache.inbox.length
      ? cache.inbox.map((item) => `<div class="inbox-item${item.read ? ' read' : ''}"><strong>${esc(item.title)}</strong><p>${esc(item.body)}</p><small>${esc(item.createdAt)}</small>${item.read ? '' : `<div class="run-actions"><button type="button" class="btn" data-schedule-action="read-inbox" data-id="${esc(item.id)}">Mark read</button></div>`}</div>`).join('')
      : '<p>No notices yet. A due or expired run shows up here. Nothing is emailed.</p>';
    app().modal('Scheduler inbox', items + '<button type="button" class="btn full" data-action="close">Close</button>');
  }

  async function reviewRun(id) {
    const problem = walletReady();
    if (problem) {
      app().notify(problem);
      return;
    }
    const run = cache.runs.find((item) => item.id === id) || (await api('/v1/runs/' + id)).run;
    if (!run || run.network !== 'devnet') {
      app().notify('That run is not a devnet payout.');
      return;
    }
    app().modal('Review scheduled payout', '<p class="lead">Rebuilding the unsigned devnet transaction and simulating it. Your wallet is not asked to sign until simulation succeeds.</p>');
    try {
      const preview = await VectraChain.preparePayout({
        network: 'devnet',
        payer: app().state.publicKey,
        recipients: run.recipients,
        memo: run.memo,
        reference: run.name,
      });
      preview.reference = run.name;
      pending = { run, preview };
      const rows = preview.recipients.map((row) => `<div class="quote-row"><span class="mono">${esc(row.address)}</span><strong>${esc(row.display)} USDC</strong></div>`).join('');
      app().modal('Review scheduled payout', `<p class="lead">${esc(run.name)} · simulation succeeded. The scheduler did not send this. Your wallet still has to sign.</p>${rows}<div class="quote-row"><span>Total devnet USDC</span><strong>${esc(preview.totalDisplay)}</strong></div><div class="quote-row"><span>Network fee</span><strong>${esc(app().solText(preview.feeLamports))}</strong></div><div class="notice">Devnet tokens have no cash value. Approve each batch in your wallet.</div><div class="error" id="sched-sign-error" role="alert"></div><button type="button" class="btn primary full" data-schedule-action="confirm-sign">Sign and send</button><button type="button" class="btn full" data-schedule-action="skip-run" data-id="${esc(run.id)}">Skip this run</button>`);
    } catch (error) {
      pending = null;
      app().modal('Review scheduled payout', `<p class="error">${esc(error.message || 'Simulation failed.')}</p><div class="notice">The wallet was not asked to sign. The run is still waiting.</div><button type="button" class="btn full" data-action="close">Close</button>`);
    }
  }

  async function confirmSign() {
    if (!pending || app().state.sending) return;
    const problem = walletReady();
    const errorBox = document.getElementById('sched-sign-error');
    if (problem) {
      if (errorBox) errorBox.textContent = problem;
      return;
    }
    const { run, preview } = pending;
    app().state.sending = true;
    const button = document.querySelector('[data-schedule-action="confirm-sign"]');
    if (button) button.disabled = true;
    const results = [];
    try {
      for (let index = 0; index < preview.batches.length; index++) {
        if (button) button.textContent = 'Approve ' + (index + 1) + ' of ' + preview.batches.length + ' in your wallet…';
        const batch = preview.batches[index];
        const block = await VectraChain.latestBlockhash();
        const tx = VectraChain.rebuild(preview, batch, block.blockhash);
        const sim = await VectraChain.simulate(tx);
        if (!sim.ok) throw new Error(sim.message);
        const signed = await VectraWallet.sign(app().state.wallet, app().state.account, tx);
        let signature = signed.signature;
        let status = 'signed';
        if (signed.mode === 'signed') signature = await VectraChain.sendRaw(signed.raw);
        try {
          await VectraChain.confirm(signature, block.lastValidBlockHeight);
          status = 'confirmed';
        } catch (failure) {
          status = failure.timeout ? 'submitted' : 'failed';
          results.push({
            signature,
            status,
            recipients: batch.transfers.map((row) => ({ address: row.address, amount: row.display })),
            amountDisplay: batch.amountDisplay,
          });
          throw failure;
        }
        results.push({
          signature,
          status,
          recipients: batch.transfers.map((row) => ({ address: row.address, amount: row.display })),
          amountDisplay: batch.amountDisplay,
        });
      }
      const signatures = results.map((result) => result.signature).filter(Boolean);
      const recorded = await api('/v1/runs/' + run.id + '/signature', {
        method: 'POST',
        body: { signatures, status: results.every((result) => result.status === 'confirmed') ? 'sent' : 'signed' },
      });
      app().recordResults(preview, results);
      pending = null;
      await load();
      app().showSendResult(preview, results, '');
      app().notify('Signature recorded on the run ' + recorded.run.status + '.');
    } catch (failure) {
      if (results.length) {
        try {
          await api('/v1/runs/' + run.id + '/signature', {
            method: 'POST',
            body: { signatures: results.map((result) => result.signature).filter(Boolean), status: 'signed' },
          });
        } catch { /* The run stays awaiting if this record fails. */ }
        app().recordResults(preview, results);
      }
      const message = app().explain(failure);
      if (results.length) app().showSendResult(preview, results, message);
      else if (errorBox) errorBox.textContent = message;
      else app().notify(message);
    } finally {
      app().state.sending = false;
    }
  }

  async function mutate(action, id) {
    if (action === 'pause') await api('/v1/schedules/' + id + '/pause', { method: 'POST', body: {} });
    if (action === 'resume') await api('/v1/schedules/' + id + '/resume', { method: 'POST', body: {} });
    if (action === 'delete') await api('/v1/schedules/' + id, { method: 'DELETE' });
    if (action === 'skip-run') await api('/v1/runs/' + id + '/skip', { method: 'POST', body: { reason: 'Skipped in Vectra' } });
    if (action === 'read-inbox') await api('/v1/inbox/' + id + '/read', { method: 'POST', body: {} });
    await load();
    app().close();
    app().render();
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-schedule-action]');
    if (!button || !isRemote()) return;
    const action = button.dataset.scheduleAction;
    const id = button.dataset.id;
    if (action === 'add-recipient') {
      if (document.querySelectorAll('.scheduler-recipient').length >= 20) {
        app().notify('You can add up to 20 recipients.');
        return;
      }
      document.getElementById('sched-recipients')?.insertAdjacentHTML('beforeend', recipientRow());
      return;
    }
    if (action === 'remove-recipient') {
      const row = button.closest('.scheduler-recipient');
      if (row && document.querySelectorAll('.scheduler-recipient').length > 1) row.remove();
      return;
    }
    if (action === 'login') {
      login().catch((error) => app().notify(error.message));
      return;
    }
    if (action === 'logout') {
      clearSession();
      cache.at = 0;
      app().notify('Signed out of the scheduler. The wallet stays connected.');
      app().render();
      return;
    }
    if (action === 'review-run') {
      reviewRun(id);
      return;
    }
    if (action === 'confirm-sign') {
      confirmSign();
      return;
    }
    if (action === 'pause' || action === 'resume' || action === 'delete' || action === 'skip-run' || action === 'read-inbox') {
      mutate(action, id).catch((error) => app().notify(error.message));
    }
  });

  document.addEventListener('submit', (event) => {
    if (event.target && event.target.id === 'scheduler-form') {
      event.preventDefault();
      submitCreate();
    }
  });

  return { isRemote, page, upcomingHtml, openCreate, openInbox, refresh };
})();
