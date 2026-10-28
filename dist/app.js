const core = globalThis.VectraCore;
const DONATION_MIN = core.DONATION_MIN;
const DONATION_MAX = core.DONATION_MAX;
const DONATION_ADDRESS = core.DONATION_ADDRESS;

const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  wallet: 'M3 6h16v15H3z M3 6l13-3v3 M15 11h6v5h-6z',
  send: 'm5 19 14-14 M5 5h14v14',
  calendar: 'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h3 M8 17h6',
  route: 'M5 5h12l-3-3 M17 5l-3 3 M19 19H7l3 3 M7 19l3-3 M5 5v8 M19 11v8',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6',
  history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v6l4 2',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 4 4 1v8l-4 1-1 4H9l-1-4-4-1V8l4-1z',
  help: 'M12 16h.01 M9 9a3 3 0 1 1 5 2l-2 1v1 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
  arrow: 'M4 12h16m-5-5 5 5-5 5',
  down: 'm5 9 7 7 7-7',
  plus: 'M12 5v14 M5 12h14',
  bell: 'M5 17h14l-2-4V9a5 5 0 0 0-10 0v4z M10 21h4',
  external: 'M14 3h7v7 M21 3l-9 9 M10 5H4v15h15v-6',
  download: 'M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12 M6 18 18 6',
  lock: 'M6 10h12v11H6z M8 10V7a4 4 0 0 1 8 0v3',
  file: 'M5 3h10l4 4v14H5z M9 11h6 M9 15h6',
  arrowDown: 'm5 5 14 14 M5 19h14V5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  heart: 'M12 20s-7-4.4-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4.6-7 9-7 9z',
};
const icon = (name, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.grid}"/></svg>`;
const esc = (value) => core.escapeHtml(value);
const money = (value) => {
  const amount = Number(value);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number.isFinite(amount) ? amount : 0);
};

function loadJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '');
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

const saved = loadJson('vectra-demo', {});
const state = {
  page: 'Overview',
  walletMode: 'none',
  wallet: null,
  account: null,
  publicKey: '',
  walletName: '',
  needsDevnetHint: false,
  balances: null,
  balanceError: '',
  balanceLoading: false,
  balancesAt: 0,
  unwatch: null,
  filter: 'All',
  range: 'This month',
  proposals: Array.isArray(saved.proposals) ? saved.proposals : [],
  schedules: Array.isArray(saved.schedules) ? saved.schedules : [],
  payouts: [],
  preview: null,
  sending: false,
  stale: false,
  connectIntent: '',
  walletChoices: [],
};
state.payouts = loadPayouts();

function loadPayouts() {
  const raw = loadJson('vectra-payouts', []);
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object').slice(0, 100) : [];
}
function persistDemo() {
  localStorage.setItem('vectra-demo', JSON.stringify({ proposals: state.proposals, schedules: state.schedules }));
}
function persistPayouts() {
  localStorage.setItem('vectra-payouts', JSON.stringify(state.payouts.slice(0, 100)));
}
const navs = [['Overview', 'grid'], ['Wallets & assets', 'wallet'], ['Distributions', 'calendar'], ['Routing preview', 'route'], ['Approvals', 'shield'], ['Activity log', 'history']];
const initialTx = [
  { name: 'Monthly contributor payout', sub: 'Distribution · 12 recipients', amount: '− $18,000.00', status: 'Completed', date: 'Oct 21, 2026', icon: 'send' },
  { name: 'Treasury funding', sub: 'Deposit · USDC', amount: '+ $50,000.00', status: 'Completed', date: 'Oct 20, 2026', icon: 'arrowDown' },
  { name: 'Route preview', sub: 'Illustrative · not sent · devnet demo', amount: '− $25,000.00', status: 'Draft', date: 'Oct 19, 2026', icon: 'route' },
  { name: 'Operations wallet top-up', sub: 'Transfer · USDC', amount: '− $2,500.00', status: 'Completed', date: 'Oct 18, 2026', icon: 'send' },
];
const initialSchedules = [
  { name: 'Contributor payroll', recipients: 12, amount: 18000, date: 'Oct 28, 2026', frequency: 'Monthly' },
  { name: 'Operations top-up', recipients: 3, amount: 9000, date: 'Nov 01, 2026', frequency: 'Weekly' },
  { name: 'Ecosystem grants', recipients: 5, amount: 15000, date: 'Nov 05, 2026', frequency: 'One-time' },
];
const DEMO_USDC_CAP = 206500000000n;

function notify(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}
function explain(error) {
  if (error && (error.field || error.timeout)) return error.message;
  const message = String(error && error.message || '');
  const kept = ['Add at least', 'Enter ', 'Use at most', 'Each recipient', 'That address', 'Memo ', 'You can add', 'Amount must', 'That amount', 'This wallet does not', 'Simulation failed', 'The blockhash', 'The public devnet', 'The devnet RPC', 'You declined', 'Mainnet is not', 'The transaction was confirmed', 'Timed out waiting', 'This payout does not', 'The Solana library', 'The wallet did not', 'This wallet cannot', 'This wallet does not support', 'One recipient does not', 'Could not measure', 'Connect a Solana', 'Give this payout'];
  if (kept.some((prefix) => message.startsWith(prefix))) return message;
  return core.friendlyTxError(error || { message });
}
function shortAddress(value) {
  const text = String(value || '');
  if (text.length < 10) return text;
  return text.slice(0, 4) + '…' + text.slice(-4);
}
function solText(lamports) {
  return core.formatBaseUnits(BigInt(lamports), 9) + ' SOL';
}
function usdcText(amount) {
  return core.formatBaseUnits(BigInt(amount), 6) + ' USDC';
}
function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function navigate(page) {
  if (state.sending) return;
  state.page = page;
  state.filter = 'All';
  close();
  render();
  window.scrollTo(0, 0);
  if (page === 'Overview' || page === 'Wallets & assets') refreshBalances(false);
}
function connectLabel() {
  if (state.walletMode === 'live') {
    return `<span class="connect-full">${esc(state.walletName)} · ${esc(shortAddress(state.publicKey))}</span><span class="connect-short">${esc(shortAddress(state.publicKey))}</span>`;
  }
  if (state.walletMode === 'demo') return '<span class="connect-full">Demo wallet · simulated</span><span class="connect-short">Demo wallet</span>';
  return 'Connect wallet';
}
function devnetBanner() {
  return `<div class="devnet-banner">${icon('lock', 14)} <span><strong>Solana Devnet.</strong> Test tokens have no cash value. Mainnet is coming soon and stays locked.</span></div>`;
}
function faucetLinks() {
  return `<p class="faucet-links"><a href="${core.SOL_FAUCET_URL}" target="_blank" rel="noopener noreferrer">Devnet SOL faucet ${icon('external', 11)}</a><a href="${core.USDC_FAUCET_URL}" target="_blank" rel="noopener noreferrer">Devnet USDC faucet ${icon('external', 11)}</a></p>`;
}
function shell() {
  const pending = state.proposals.filter((item) => item.status === 'Pending approval').length + 2;
  return `<aside><div class="brand"><svg class="logo vectra-mark" width="31" height="31" viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M3 7 17.5 31 32 7H25L17.5 20 10 7Z" fill="currentColor"/><path d="m16 7 4 7 4-7" stroke="currentColor" stroke-width="2.5"/><circle cx="31" cy="29" r="2" fill="currentColor"/></svg><span class="word">VECTRA<small>TREASURY OPERATIONS</small></span></div><div class="workspace"><span class="avatar workspace-monogram">V/</span><div>${state.walletMode === 'live' ? 'Devnet wallet' : 'Demo treasury'}<small>${state.walletMode === 'live' ? esc(shortAddress(state.publicKey)) : 'Solana workspace'}</small></div>${icon('down', 12)}</div><div class="nav-label">WORKSPACE</div><nav class="nav">${navs.map(([name, glyph]) => `<button type="button" data-page="${name}" class="${state.page === name ? 'active' : ''}">${icon(glyph)}<span>${name}</span>${name === 'Approvals' ? `<b class="badge">${pending}</b>` : ''}</button>`).join('')}</nav><div class="sidebar-bottom"><nav class="nav"><button type="button" data-action="donate">${icon('heart')}<span>Donate</span></button><button type="button" data-page="Settings">${icon('settings')}<span>Settings</span></button><button type="button" data-page="Help & roadmap">${icon('help')}<span>Help & roadmap</span></button></nav><div class="safe">${icon('shield', 16)} &nbsp; Capital in motion.<br>Control by design.<p>Plan. Approve. Move.<br>Every step, accountable.</p></div><div class="profile"><span class="avatar">VT</span><div style="font-size:11px;color:#dce9de">Treasury team<br><small>Workspace admin</small></div><span style="margin-left:auto">${icon('down', 12)}</span></div></div></aside><main><header><div class="crumb">Workspace <span>/</span> <strong>${esc(state.page)}</strong></div><div class="mobile-brand">VECTRA<span>/</span></div><div class="header-actions"><button type="button" class="network" data-action="network"><i class="dot"></i> Solana Devnet ${icon('down', 11)}</button><button type="button" class="icon-btn" data-action="notifications" aria-label="Notifications">${icon('bell', 18)}</button><button type="button" class="btn donate" data-action="donate" title="Support Vectra">Donate</button><button type="button" class="btn" data-action="connect">${icon('wallet')} ${connectLabel()}</button></div></header><div class="content" id="content"></div></main><nav class="mobile-nav">${navs.slice(0, 5).map(([name, glyph]) => `<button type="button" data-page="${name}" class="${state.page === name ? 'active' : ''}">${icon(glyph)}${name === 'Wallets & assets' ? 'Assets' : name === 'Routing preview' ? 'Routing' : name}</button>`).join('')}</nav>`;
}
function pageHeading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><div class="heading-actions">${actions}</div></div>`;
}
function statusClass(status) {
  if (status === 'Reviewed') return 'reviewed';
  if (status === 'Pending approval' || status === 'Submitted') return 'pending';
  if (status === 'Draft') return 'draft';
  return '';
}
function payoutRows() {
  return state.payouts.flatMap((payout) => (Array.isArray(payout.batches) ? payout.batches : []).map((batch) => {
    const href = core.explorerTxUrl(batch.signature);
    const recipients = Array.isArray(batch.recipients) ? batch.recipients.length : 0;
    return {
      name: String(payout.reference || 'Devnet USDC payout'),
      sub: 'Devnet USDC · ' + recipients + ' recipient' + (recipients === 1 ? '' : 's') + (href ? '' : ''),
      amount: '− ' + String(batch.amountDisplay || payout.totalDisplay || '') + ' USDC',
      status: batch.status === 'confirmed' ? 'Completed' : 'Submitted',
      date: formatWhen(payout.createdAt),
      icon: 'send',
      href,
      live: true,
    };
  }));
}
function txTable(all = false) {
  let rows = [
    ...payoutRows(),
    ...state.proposals.map((item) => ({
      name: item.name,
      sub: String(item.type || 'Transfer') + ' · Demo proposal',
      amount: '− ' + money(item.amount),
      status: item.status,
      date: 'Just now',
      icon: item.type === 'Routing' ? 'route' : 'send',
    })),
    ...initialTx,
  ];
  if (state.filter !== 'All') rows = rows.filter((row) => row.status === state.filter);
  if (!all) rows = rows.slice(0, 5);
  return `<div class="table-wrap"><table><thead><tr><th>Transaction</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead><tbody>${rows.map((row) => `<tr><td><div class="tx-name"><span class="tx-icon">${icon(row.icon, 14)}</span><div>${esc(row.name)}<small>${esc(row.sub)}${row.href ? ` · <a href="${esc(row.href)}" target="_blank" rel="noopener noreferrer">Explorer</a>` : ''}</small></div></div></td><td class="amount">${esc(row.amount)}</td><td><span class="status ${statusClass(row.status)}">${esc(row.status)}</span></td><td style="color:#8c9886">${esc(row.date)}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nothing matches this filter yet.</td></tr>'}</tbody></table></div>`;
}
function scheduleItems(full = false) {
  return [...state.schedules, ...initialSchedules].slice(0, full ? 99 : 3).map((item) => `<div class="schedule-item"><div class="schedule-line"><div class="schedule-title">${esc(item.name)}<small>${esc(item.recipients)} recipients · USDC</small></div><div class="schedule-amount">${money(item.amount).replace('.00', '')}</div></div><div class="schedule-date"><span>${icon('calendar', 11)} ${esc(item.date)}</span><span class="schedule-meta"><span class="status">${esc(item.frequency)}</span>${item.local ? '<span class="status pending">Needs approval</span>' : ''}</span></div></div>`).join('');
}
function liveBalanceCard() {
  const balances = state.balances;
  let body;
  if (state.balanceLoading && !balances) {
    body = '<div class="balance">Reading…</div><div class="gain">Asking the public devnet RPC for SOL and USDC.</div>';
  } else if (balances) {
    body = `<div class="balance">${esc(usdcText(balances.usdcBase))}</div><div class="gain">${esc(solText(balances.solLamports))} for fees · devnet SOL has no cash value</div><div class="balance-foot"><div>Token account<strong>${balances.sourceExists ? 'Ready' : 'Not created yet'}</strong></div><div>Network<strong>Devnet</strong></div></div>`;
  } else {
    body = `<div class="balance">—</div><div class="gain">${esc(state.balanceError || 'Balances have not loaded yet.')}</div>`;
  }
  const error = state.balanceError && balances ? `<p class="error">${esc(state.balanceError)}</p>` : '';
  return `<section class="balance-card"><div><div class="balance-label">Devnet USDC <span class="demo-tag">NO CASH VALUE</span></div>${body}${error}<div class="balance-actions"><button type="button" class="btn" data-action="refresh-balances"${state.balanceLoading ? ' disabled' : ''}>${state.balanceLoading ? 'Refreshing…' : 'Refresh'}</button></div>${faucetLinks()}</div><div class="chart"><div class="chart-label"><span>ILLUSTRATIVE CHART</span><span>NOT YOUR WALLET</span></div><svg viewBox="0 0 310 125" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#82ab65" stop-opacity=".27"/><stop offset="1" stop-color="#82ab65" stop-opacity="0"/></linearGradient></defs><path d="M0 95 14 91 25 96 40 78 53 82 66 66 80 74 93 54 106 60 118 48 132 54 146 35 159 44 174 25 187 34 198 29 211 40 223 22 236 30 248 13 261 19 274 7 290 10 309 3V125H0Z" fill="url(#area)"/><path d="M0 95 14 91 25 96 40 78 53 82 66 66 80 74 93 54 106 60 118 48 132 54 146 35 159 44 174 25 187 34 198 29 211 40 223 22 236 30 248 13 261 19 274 7 290 10 309 3" fill="none" stroke="#70914e" stroke-width="2"/><circle cx="309" cy="3" r="4" fill="#638549" stroke="#ddefd9" stroke-width="3"/></svg><div class="chart-bottom"><span>SAMPLE</span><span>NOT LIVE</span></div></div></section>`;
}
function upcomingDistributions() {
  if (globalThis.VectraSchedule && VectraSchedule.isRemote()) return VectraSchedule.upcomingHtml();
  return scheduleItems();
}
function demoBalanceCard() {
  return `<section class="balance-card"><div><div class="balance-label">Total treasury balance <span class="demo-tag">DEMO DATA</span></div><div class="balance">$248,500<span class="cents">.00</span></div><div class="gain"><strong>↗ 12.8%</strong> vs. previous ${state.range === 'This month' ? 'month' : 'period'} · illustrative</div><div class="balance-foot"><div>Available to spend<strong>$206,500.00</strong></div><div>Reserved for payouts<strong>$42,000.00</strong></div></div><p class="gain">Connect a devnet wallet to replace this card with live SOL and devnet USDC.</p></div><div class="chart"><div class="chart-label"><span>TREASURY VALUE</span><span>USDC</span></div><svg viewBox="0 0 310 125" preserveAspectRatio="none"><defs><linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#82ab65" stop-opacity=".27"/><stop offset="1" stop-color="#82ab65" stop-opacity="0"/></linearGradient></defs><path d="M0 95 14 91 25 96 40 78 53 82 66 66 80 74 93 54 106 60 118 48 132 54 146 35 159 44 174 25 187 34 198 29 211 40 223 22 236 30 248 13 261 19 274 7 290 10 309 3V125H0Z" fill="url(#area)"/><path d="M0 95 14 91 25 96 40 78 53 82 66 66 80 74 93 54 106 60 118 48 132 54 146 35 159 44 174 25 187 34 198 29 211 40 223 22 236 30 248 13 261 19 274 7 290 10 309 3" fill="none" stroke="#70914e" stroke-width="2"/><circle cx="309" cy="3" r="4" fill="#638549" stroke="#ddefd9" stroke-width="3"/></svg><div class="chart-bottom"><span>OCT 01</span><span>OCT 07</span><span>OCT 14</span><span>OCT 22</span></div></div></section>`;
}
function overview() {
  return pageHeading('Treasury overview', 'A calm look at balances, payouts, and what is waiting on a signature.', `<button type="button" class="btn" data-action="export">${icon('download')} Export report</button><button type="button" class="btn" data-action="range">${icon('calendar')} ${esc(state.range)} ${icon('down', 11)}</button>`) + devnetBanner() + `<section class="brand-banner"><div class="brand-banner-copy"><div class="brand-kicker"><span class="brand-live"></span> VECTRA / SOLANA TREASURY OPERATIONS</div><h2>Treasury, in motion.</h2><p>Treasury operations at the speed of Solana.</p><div class="brand-principles"><span>01 <b>Plan.</b></span><span>02 <b>Approve.</b></span><span>03 <b>Move.</b></span></div></div><div class="brand-orbit" aria-hidden="true"><svg viewBox="0 0 380 180"><defs><linearGradient id="routeGlow"><stop stop-color="#174f3e"/><stop offset="1" stop-color="#b7f59a"/></linearGradient></defs><path d="M-10 145H95L164 36h90l65 108h75 M-10 165H106L175 56h68l65 108h86 M-10 125H84L153 16h112l65 108h64" stroke="url(#routeGlow)" stroke-width="1.2" fill="none"/><circle cx="254" cy="36" r="5" fill="#b7f59a"/><circle cx="95" cy="145" r="4" fill="#a4d6af"/><path d="m225 23 18 31 18-31h-8l-10 17-10-17z" fill="#c9f5d8"/></svg><span>CAPITAL → COORDINATED</span></div></section>${landingIntro()}<div class="summary">${state.walletMode === 'live' ? liveBalanceCard() : demoBalanceCard()}<section class="quick"><div class="card-heading"><h2>Treasury actions</h2><span class="subtle">${state.walletMode === 'live' ? 'DEVNET' : 'PROTOTYPE'}</span></div><div class="quick-grid">${[['Send USDC', 'send', 'send'], ['Schedule', 'calendar', 'schedule'], ['Route funds', 'route', 'route'], ['Approvals', 'shield', 'approvals']].map(([name, glyph, action]) => `<button type="button" data-action="${action}"><span class="action-icon">${icon(glyph, 17)}</span>${name}</button>`).join('')}</div><div class="quick-note">${icon('lock', 11)} Wallet-controlled. Always.</div></section></div><div class="metrics"><div class="metric"><div class="metric-top">Scheduled payouts ${icon('calendar')}</div><div class="metric-value">$42,000 <span>Illustrative</span></div><p>Sample schedules, not live jobs</p></div><div class="metric"><div class="metric-top">Routed volume ${icon('route')}</div><div class="metric-value">$1.2M <span>Sample</span></div><p>Illustrative all-time volume</p></div><div class="metric"><div class="metric-top">Pending approvals ${icon('shield')}</div><div class="metric-value">${state.proposals.filter((item) => item.status === 'Pending approval').length + 2} <span style="color:#a08745;background:#faf5e8">Local demo</span></div><p>Squads is not connected</p></div></div><div class="lower"><section class="panel"><div class="panel-head"><h2>Recent activity</h2><button type="button" class="text-btn" data-page="Activity log">View all activity ${icon('arrow', 13)}</button></div>${txTable()}<div class="table-bottom"><span>Devnet payouts include explorer links. Other rows are illustrative.</span><span>${state.walletMode === 'live' ? 'Devnet tokens have no cash value' : 'Demo rows move no funds'}</span></div></section><section class="panel"><div class="panel-head"><h2>Upcoming distributions</h2>${icon('calendar', 16)}</div>${upcomingDistributions()}<button type="button" class="btn new-schedule" data-action="schedule">${icon('plus', 13)} Create a schedule</button></section></div><div class="bottom-strip"><span>${icon('shield', 15)} <strong>Control at every step.</strong> Plan distributions. Review proposals. Authorize movement.</span><span><i class="dot"></i> Solana Devnet</span></div>`;
}
function routing() {
  return pageHeading('Routing preview', 'Devnet demo. Nothing leaves Solana.', '<span class="pill">Not a live route</span>') + `<div class="lower"><section class="panel form-panel"><h2>No route is configured</h2><p style="margin-top:8px">This build does not bridge funds and does not request a quote. Devnet USDC payouts stay on Solana and are signed in your wallet. Devnet tokens have no cash value.</p><div class="notice">Vectra does not hold a treasury key. A routing worker origin is not set on this page.</div></section><section class="panel" style="align-self:start;padding:23px"><h2>What a later route would still require</h2><div style="padding:23px 0;line-height:2.1;font-size:12px;color:#7c8b74">1. A devnet quote you can read<br>2. Costs shown before you sign<br>3. Your wallet, not a key stored here<br>4. A public Solana transfer you can follow</div><div class="notice">Mainnet is locked. This screen does not send USDC.</div></section></div>`;
}
function assets() {
  const live = state.walletMode === 'live';
  let rows;
  if (live && state.balances) {
    rows = `<tr><td><div class="tx-name"><span class="chain-logo" style="background:#edf4fa;color:#3874b3">$</span><div>USD Coin<small>Devnet USDC · no cash value</small></div></div></td><td class="mono">${esc(core.DEVNET_USDC_MINT)}</td><td>${esc(usdcText(state.balances.usdcBase))}</td><td class="amount">No cash value</td></tr><tr><td><div class="tx-name"><span class="chain-logo">≋</span><div>Solana<small>Devnet SOL · no cash value</small></div></div></td><td>Native</td><td>${esc(solText(state.balances.solLamports))}</td><td class="amount">No cash value</td></tr>`;
  } else if (live) {
    rows = `<tr><td colspan="4" class="empty">${esc(state.balanceLoading ? 'Reading devnet balances…' : (state.balanceError || 'Balances have not loaded yet.'))}</td></tr>`;
  } else {
    rows = `<tr><td><div class="tx-name"><span class="chain-logo" style="background:#edf4fa;color:#3874b3">$</span><div>USD Coin<small>USDC · Demo</small></div></div></td><td>SPL Token</td><td>245,000.00 USDC</td><td class="amount">Illustrative</td></tr><tr><td><div class="tx-name"><span class="chain-logo">≋</span><div>Solana<small>SOL · Demo</small></div></div></td><td>Native</td><td>20.00 SOL</td><td class="amount">Illustrative</td></tr>`;
  }
  return pageHeading('Wallets & assets', live ? 'Live devnet balances from the public RPC. These tokens have no cash value.' : 'A clear view of the simulated treasury.', `<button type="button" class="btn primary" data-action="connect">${icon('wallet')} ${live ? 'Wallet' : state.walletMode === 'demo' ? 'Manage demo wallet' : 'Connect wallet'}</button>`) + devnetBanner() + `<div class="section-intro"><h2>${live ? esc(state.walletName) + ' · ' + esc(shortAddress(state.publicKey)) : state.walletMode === 'demo' ? 'Simulated demo wallet' : 'Connect a devnet wallet'}</h2><p style="margin-top:8px">${live ? 'SOL pays fees and token-account rent. USDC is the devnet mint ' + esc(core.DEVNET_USDC_MINT) + '.' : 'The rows below are fictional until a Phantom, Solflare, or Backpack wallet is connected on devnet.'}</p>${live ? faucetLinks() : ''}</div><section class="panel"><div class="panel-head"><h2>Treasury assets</h2><span class="pill">${live ? 'Solana Devnet · live' : 'Solana Devnet · demo data'}</span></div><div class="table-wrap"><table><thead><tr><th>Asset</th><th>Mint / standard</th><th>Balance</th><th>Value</th></tr></thead><tbody>${rows}</tbody></table></div></section><div class="notice">Token-2022 discovery is not part of this devnet lite build. Mainnet balances are not read.</div>`;
}
function distributions() {
  if (globalThis.VectraSchedule && VectraSchedule.isRemote()) return VectraSchedule.page();
  return pageHeading('Distributions', 'Keep your team funded. Keep control of every payment.', `<button type="button" class="btn primary" data-action="schedule">${icon('plus')} Create schedule</button>`) + devnetBanner() + `<div class="section-intro"><h2>Local-only fallback.</h2><p style="margin-top:7px">SCHEDULER_API_URL is not set, so these schedules stay in this browser and never fire. Nothing is sent. A devnet USDC payout is a separate action: Send USDC, with a signature in your own wallet.</p></div><section class="panel"><div class="panel-head"><h2>Payment schedules</h2><span class="pill">${state.schedules.length + 3} local schedules</span></div>${scheduleItems(true)}</section>`;
}
function approvals() {
  const items = [...state.proposals, { id: 'seed-1', name: 'October contributor payroll', amount: 18000, status: 'Pending approval', type: 'Distribution', seed: true }, { id: 'seed-2', name: 'Operations wallet funding', amount: 2500, status: 'Pending approval', type: 'Transfer', seed: true }];
  return pageHeading('Approvals', 'Every payment deserves a clear trail.') + `<div class="section-intro"><h2>Wallet-controlled execution</h2><p style="margin-top:7px">Demo approvals model a 2-of-3 treasury policy. Squads is not connected. Approving here records a local review only. Devnet payouts you already signed appear in the activity log, not in this queue.</p></div><section class="panel"><div class="panel-head"><h2>Transaction proposals</h2><span class="pill">Demo policy · 2 of 3 signers</span></div>${items.map((item) => `<div class="audit-row"><div><strong>${esc(item.name)}</strong><small>${esc(item.type)} · ${money(item.amount)} USDC · ${item.status === 'Reviewed' ? '1 local review · 0 on-chain signatures' : '0 of 2 signatures'}</small></div><div style="display:flex;align-items:center;gap:12px"><span class="status ${statusClass(item.status)}">${esc(item.status)}</span><button type="button" class="btn" data-review="${esc(item.id)}">Review ${icon('arrow', 13)}</button></div></div>`).join('')}</section>`;
}
function activity() {
  const payoutCount = payoutRows().length;
  return pageHeading('Activity log', 'Devnet signatures stay in this browser. Sample rows are not an audit trail.', `<button type="button" class="btn" data-action="export">${icon('download')} Export CSV</button>`) + `<div class="section-intro"><p>Sent devnet payouts keep their signature and a Solana Explorer link. Illustrative rows and local proposals are labeled and have no signature. History can be cleared in Settings. It is not a durable server ledger.</p></div><section class="panel"><div class="panel-head"><h2>All activity</h2><div class="filters">${['All', 'Completed', 'Pending approval', 'Draft'].map((filter) => `<button type="button" class="filter ${state.filter === filter ? 'active' : ''}" data-filter="${filter}">${filter === 'Pending approval' ? 'Pending' : filter}</button>`).join('')}</div></div>${txTable(true)}<div class="table-bottom"><span>${payoutCount} saved devnet signature${payoutCount === 1 ? '' : 's'} on this browser</span><span>Devnet tokens have no cash value</span></div></section>`;
}
function help() {
  return pageHeading('Build roadmap', 'A focused path from devnet lite to production.') + `<div class="section-intro"><h2>Treasury operations at the speed of Solana.</h2><p style="margin-top:10px">This lite build connects a wallet, reads devnet balances, and sends devnet USDC from the wallet you control. Schedules, Squads, and MultiHopper routing are still previews.</p></div><div class="roadmap">${[['01–05', 'Connect & discover', 'Wallet Standard, devnet RPC, and locked mainnet.', 'Done in this lite build, with public RPC limits.'], ['06–10', 'Fund operations', 'USDC payouts, recipient accounts, and local history.', 'Sign and send devnet USDC from your wallet.'], ['11–15', 'Route treasury', 'Verified MultiHopper adapter, costs and status.', 'Not in this build. Routing stays a simulation.'], ['16–20', 'Approve & audit', 'Squads, retries, logs and security checks.', 'Not in this build. One wallet signs directly.'], ['21–25', 'Launch & monitor', 'Production infrastructure and onboarding.', 'Mainnet stays locked.']].map(([day, title, copy, accept]) => `<div class="panel"><div class="eyebrow">Days ${day}</div><h3>${title}</h3><p>${copy}</p><p style="margin-top:15px;color:#527647">${accept}</p></div>`).join('')}</div><div class="notice">Routing availability, supported chains, route accounting and qualification rules are integration gates. Devnet tokens have no cash value. The public RPC can rate-limit. There is no backend and no custom program.</div><section class="panel" style="padding:24px;margin-top:22px"><h2>Illustrative $30M volume scenario</h2><div class="quote-row"><span>10 operators × $3M qualifying volume</span><strong>$30,000,000</strong></div><div class="quote-row"><span>Stated 0.25% partner share</span><strong>$75,000</strong></div><p style="margin-top:15px">Before exclusions, costs and negotiated adjustments. This is a scenario, not earned revenue or verified partnership terms. It is not related to devnet balances.</p></section>`;
}
function settings() {
  const walletLine = state.walletMode === 'live' ? state.walletName + ' · ' + state.publicKey : state.walletMode === 'demo' ? 'Simulated demo wallet' : 'Not connected';
  return pageHeading('Workspace settings', 'Devnet lite. No keys are stored here.') + `<section class="panel form-panel"><h2>Environment</h2>${[
    ['Network', 'Solana Devnet'],
    ['Mainnet', 'Coming soon · locked'],
    ['RPC', core.RPC_ENDPOINT],
    ['Devnet USDC mint', core.DEVNET_USDC_MINT],
    ['Wallet', walletLine],
    ['Signing', 'Your wallet only. This site holds no keys.'],
    ['MultiHopper', 'Simulation only'],
    ['Squads multisig', 'Not configured'],
    ['Schedule storage', 'This browser only'],
    ['Payout history', state.payouts.length + ' local record' + (state.payouts.length === 1 ? '' : 's')],
  ].map(([label, value]) => `<div class="quote-row"><span>${esc(label)}</span><strong class="mono">${esc(value)}</strong></div>`).join('')}<div class="notice">${esc(donationSettingsNote())}</div>${faucetLinks()}<div class="notice">A public devnet RPC can rate-limit or fail. There is no private RPC key in this app. Refresh and try again.</div><button type="button" class="btn" data-action="reset">Reset local demo data</button><button type="button" class="btn" data-action="clear-payouts">Clear payout history</button></section>`;
}
function render() {
  if (document.getElementById('modal-root').innerHTML) {
    state.stale = true;
    return;
  }
  document.getElementById('app').innerHTML = shell();
  const pages = {
    Overview: overview,
    'Wallets & assets': assets,
    Distributions: distributions,
    'Routing preview': routing,
    Approvals: approvals,
    'Activity log': activity,
    Settings: settings,
    'Help & roadmap': help,
  };
  document.getElementById('content').innerHTML = (pages[state.page] || overview)() + `<footer class="footer"><span>VECTRA © 2026 · Devnet lite · Illustrative rows are labeled · Mainnet locked.</span><nav class="footer-links" aria-label="More"><button type="button" data-page="Activity log">Activity</button><button type="button" data-page="Settings">Settings</button><button type="button" data-page="Help & roadmap">Help</button><a class="brand-guide-link" href="brand.html">Brand ${icon('external', 11)}</a></nav></footer>`;
  document.querySelector('#route-form')?.addEventListener('submit', routeReview);
}
function modal(title, body) {
  document.getElementById('modal-root').innerHTML = `<div class="overlay"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-header"><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>${body}</section></div>`;
  document.querySelector('.modal input, .modal button, .modal a')?.focus();
}
function close() {
  if (state.sending) return;
  document.getElementById('modal-root').innerHTML = '';
  if (state.stale) {
    state.stale = false;
    render();
  }
}
function clearLiveLocal() {
  if (state.unwatch) state.unwatch();
  state.unwatch = null;
  state.wallet = null;
  state.account = null;
  state.publicKey = '';
  state.walletName = '';
  state.needsDevnetHint = false;
  state.balances = null;
  state.balanceError = '';
  state.walletMode = 'none';
}
async function disconnectLive() {
  const wallet = state.wallet;
  clearLiveLocal();
  await VectraWallet.disconnect(wallet);
}
function connectModal() {
  const installs = VectraWallet.installs().map((item) => `<a href="${item.url}" target="_blank" rel="noopener noreferrer">${esc(item.name)}</a>`).join(' · ');
  modal('Connect a wallet', `<p class="lead">Devnet only. Vectra asks your wallet to sign. It never sees your private key. Mainnet is locked.</p><div id="wallet-list"></div><button type="button" class="wallet-option" data-action="demo-connect"><span class="avatar">V</span><div><strong>${state.walletMode === 'demo' ? 'Disconnect simulated demo' : 'Use simulated demo wallet'}</strong><p>Demo · no chain, no signature, fictional balances</p></div>${icon('arrow')}</button><p class="faucet-links">Install ${installs}</p><div class="notice">A donation, if you make one, is a devnet test transfer from your own wallet. Devnet tokens have no cash value.</div>`);
  const list = document.getElementById('wallet-list');
  const wallets = VectraWallet.listSupported();
  state.walletChoices = wallets;
  if (!wallets.length) {
    const empty = document.createElement('p');
    empty.className = 'notice';
    empty.textContent = 'No Phantom, Solflare, or Backpack wallet was detected in this browser.';
    list.append(empty);
  }
  wallets.forEach((wallet, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wallet-option';
    button.dataset.action = 'wallet-connect';
    button.dataset.walletIndex = String(index);
    const avatar = document.createElement('span');
    avatar.className = 'avatar';
    avatar.textContent = String(wallet.name || '?').slice(0, 1).toUpperCase();
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = wallet.name || 'Wallet';
    const sub = document.createElement('p');
    sub.textContent = 'Wallet Standard · signs on devnet';
    copy.append(title, sub);
    button.append(avatar, copy);
    list.append(button);
  });
  if (state.walletMode === 'live') {
    const current = document.createElement('p');
    current.className = 'notice';
    current.textContent = 'Connected: ' + state.walletName + ' · ' + state.publicKey;
    const disconnect = document.createElement('button');
    disconnect.type = 'button';
    disconnect.className = 'btn full';
    disconnect.dataset.action = 'disconnect-live';
    disconnect.textContent = 'Disconnect wallet';
    list.prepend(current);
    list.append(disconnect);
  }
}
function connect() {
  connectModal();
}
async function connectLive(wallet) {
  try {
    if (state.walletMode === 'demo') state.walletMode = 'none';
    const result = await VectraWallet.connect(wallet);
    if (state.unwatch) state.unwatch();
    state.wallet = wallet;
    state.account = result.account;
    state.publicKey = result.account.address;
    state.walletName = String(wallet.name || 'Wallet');
    state.needsDevnetHint = result.needsDevnetHint;
    state.walletMode = 'live';
    state.balances = null;
    state.balanceError = '';
    state.unwatch = VectraWallet.watch(wallet, (properties) => {
      if (!Array.isArray(properties.accounts)) return;
      const still = properties.accounts.find((account) => account.address === state.publicKey);
      if (still) {
        state.account = still;
        return;
      }
      const next = properties.accounts.find((account) => core.isSolanaAddress(account.address));
      if (!next) {
        clearLiveLocal();
        close();
        render();
        notify('The wallet disconnected.');
        return;
      }
      state.account = next;
      state.publicKey = next.address;
      state.balances = null;
      refreshBalances(true);
    });
    close();
    render();
    notify(state.needsDevnetHint
      ? 'Wallet connected. Set the wallet network to Devnet before signing. Devnet tokens have no cash value.'
      : 'Devnet wallet connected. Balances have no cash value.');
    refreshBalances(true);
    if (state.connectIntent === 'send') paymentForm(false);
  } catch (error) {
    notify(explain(error));
  }
}
async function refreshBalances(force) {
  if (state.walletMode !== 'live' || !state.publicKey) return;
  if (state.balanceLoading) return;
  if (!force && state.balances && Date.now() - state.balancesAt < 20000) return;
  state.balanceLoading = true;
  state.balanceError = '';
  render();
  try {
    state.balances = await VectraChain.fetchBalances(state.publicKey);
    state.balancesAt = Date.now();
  } catch (error) {
    state.balanceError = explain(error);
  } finally {
    state.balanceLoading = false;
    render();
  }
}
function networkModal() {
  modal('Network', `<p class="lead">Vectra Lite sends only on devnet. Devnet tokens have no cash value.</p><button type="button" class="wallet-option" data-action="use-devnet"><span class="avatar">D</span><div><strong>Devnet</strong><p>Selected · ${esc(core.RPC_ENDPOINT)}</p></div>${icon('check')}</button><button type="button" class="wallet-option" disabled aria-disabled="true"><span class="avatar">${icon('lock', 14)}</span><div><strong>Mainnet</strong><p>Coming soon</p></div></button><div class="notice">Mainnet cannot be selected. No mainnet RPC calls are made from this page.</div>`);
}
function recipientRow() {
  return `<div class="recipient"><input aria-label="Recipient wallet address" placeholder="Solana wallet address" autocapitalize="off" spellcheck="false" required><input aria-label="Amount in USDC" placeholder="0.00" inputmode="decimal" autocomplete="off" required><button type="button" class="icon-btn remove-recipient" data-action="remove-recipient" aria-label="Remove recipient">${icon('close', 14)}</button></div>`;
}
function paymentForm(scheduled = false) {
  const live = !scheduled && state.walletMode === 'live';
  modal(scheduled ? 'Create a distribution' : live ? 'Send devnet USDC' : 'Send USDC', `<p class="lead">${scheduled ? 'Local-only fallback. This browser stores the schedule. It never fires, and nothing is sent.' : live ? 'Build a devnet USDC payout. Simulation runs before your wallet asks for a signature. These tokens have no cash value.' : 'This simulated wallet creates a local proposal. No USDC is sent.'}</p><form id="payment-form"><div class="field"><label for="payment-name">${scheduled ? 'Schedule name' : 'Payment reference'}</label><input id="payment-name" maxlength="70" required placeholder="e.g. Contributor payroll"></div><div class="field"><label>Recipients and USDC amounts</label><div id="recipients">${recipientRow()}</div><button type="button" class="text-btn" data-action="add-recipient">${icon('plus', 13)} Add recipient</button><small>Solana base58 addresses. Up to 20 recipients. Devnet USDC uses 6 decimals.</small></div>${live ? `<div class="field"><label for="payment-memo">Memo · optional</label><input id="payment-memo" maxlength="280" placeholder="Shown on the transaction" autocomplete="off"></div>` : ''}${scheduled ? `<div class="form-row"><div class="field"><label for="payment-date">First proposal date</label><input id="payment-date" type="date" min="${isoToday()}" value="${isoToday()}" required></div><div class="field"><label for="frequency">Frequency</label><select id="frequency"><option>One-time</option><option>Weekly</option><option>Monthly</option></select></div></div>` : ''}<div class="notice">${live ? 'Your wallet must be on Devnet. Missing recipient token accounts are created in the same transaction. Large lists are split so each transaction fits.' : 'Demo only. No USDC is sent, and no automatic spending permission is granted.'}</div>${live ? faucetLinks() : ''}<div class="error" id="form-error" role="alert"></div><button class="btn primary full" type="submit" id="payment-submit">${scheduled ? 'Save local-only schedule' : live ? 'Review devnet payout' : 'Create payment proposal'} ${icon('arrow')}</button></form>`);
  document.getElementById('payment-form').addEventListener('submit', (event) => submitPayment(event, scheduled));
  refreshRecipientRemoves();
}
function collectRecipients() {
  return [...document.querySelectorAll('.recipient')].map((row) => ({
    address: row.children[0].value.trim(),
    amount: row.children[1].value.trim(),
  }));
}
async function submitPayment(event, scheduled) {
  event.preventDefault();
  const error = document.getElementById('form-error');
  const button = document.getElementById('payment-submit');
  error.textContent = '';
  const rows = collectRecipients();
  const name = document.getElementById('payment-name').value.trim();
  if (!name) {
    error.textContent = 'Give this payout a short name.';
    return;
  }
  if (!scheduled && state.walletMode === 'live') {
    const memo = document.getElementById('payment-memo')?.value || '';
    button.disabled = true;
    button.textContent = 'Simulating…';
    try {
      const preview = await VectraChain.preparePayout({
        network: 'devnet',
        payer: state.publicKey,
        recipients: rows,
        memo,
        reference: name,
      });
      preview.reference = name;
      state.preview = preview;
      openReview(preview);
    } catch (failure) {
      error.textContent = explain(failure);
      button.disabled = false;
      button.textContent = 'Review devnet payout';
    }
    return;
  }
  const parsed = rows.map((row) => ({ address: row.address, parsed: core.parseTokenAmount(row.amount, 6) }));
  if (parsed.some((row) => !core.isSolanaAddress(row.address))) {
    error.textContent = 'Enter a Solana address for each recipient (32-byte base58).';
    return;
  }
  if (parsed.some((row) => !row.parsed.ok)) {
    error.textContent = parsed.find((row) => !row.parsed.ok).parsed.error;
    return;
  }
  if (new Set(parsed.map((row) => row.address)).size !== parsed.length) {
    error.textContent = 'Each recipient address must be unique.';
    return;
  }
  const total = parsed.reduce((sum, row) => sum + row.parsed.amount, 0n);
  if (total > DEMO_USDC_CAP) {
    error.textContent = 'That total is above the illustrative available balance of 206,500 USDC.';
    return;
  }
  const proposal = {
    id: crypto.randomUUID(),
    name,
    amount: core.formatBaseUnits(total, 6),
    status: 'Pending approval',
    type: scheduled ? 'Distribution' : 'Transfer',
    recipients: rows.length,
  };
  state.proposals.unshift(proposal);
  if (scheduled) {
    const date = document.getElementById('payment-date').value;
    state.schedules.unshift({
      name,
      amount: proposal.amount,
      recipients: rows.length,
      date: new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }),
      frequency: document.getElementById('frequency').value,
      local: true,
    });
  }
  persistDemo();
  close();
  render();
  notify(scheduled ? 'Demo schedule created. It does not send a transaction.' : 'Payment proposal created. No funds have moved.');
}
function openReview(preview) {
  const rows = preview.recipients.map((row) => `<div class="quote-row"><span class="mono">${esc(row.address)}${row.createAta ? '<small>New token account</small>' : ''}</span><strong>${esc(row.display)} USDC</strong></div>`).join('');
  modal('Review devnet payout', `<p class="lead">${esc(preview.reference)} · ${preview.batches.length} transaction${preview.batches.length === 1 ? '' : 's'}. Simulation succeeded. Your wallet still has to sign.</p>${rows}<div class="quote-row"><span>Total devnet USDC</span><strong>${esc(preview.totalDisplay)}</strong></div><div class="quote-row"><span>Network fee</span><strong>${esc(solText(preview.feeLamports))}</strong></div><div class="quote-row"><span>New token accounts</span><strong>${preview.newAtaCount} · ${esc(solText(preview.rentTotalLamports))} rent</strong></div><div class="quote-row"><span>Memo</span><strong>${preview.memo ? esc(preview.memo) : 'None'}</strong></div><div class="notice">Devnet only. These tokens have no cash value. Set your wallet to Devnet. ${state.needsDevnetHint ? 'This wallet did not advertise devnet, so switch the network in the wallet if it rejects the request.' : 'You will approve each batch in your wallet.'}</div><div class="error" id="sign-error" role="alert"></div><button type="button" class="btn primary full" data-action="sign-payout">Sign and send</button><button type="button" class="btn full" data-action="back-to-form">Back</button>`);
  document.querySelector('.modal')?.classList.add('modal-wide');
}
async function sendPreview() {
  const preview = state.preview;
  if (!preview || state.sending) return;
  state.sending = true;
  const errorBox = document.getElementById('sign-error');
  const button = document.querySelector('[data-action="sign-payout"]');
  if (button) button.disabled = true;
  const results = [];
  try {
    for (let index = 0; index < preview.batches.length; index++) {
      if (errorBox) errorBox.textContent = '';
      if (button) button.textContent = 'Approve ' + (index + 1) + ' of ' + preview.batches.length + ' in your wallet…';
      const batch = preview.batches[index];
      const block = await VectraChain.latestBlockhash();
      const tx = VectraChain.rebuild(preview, batch, block.blockhash);
      const sim = await VectraChain.simulate(tx);
      if (!sim.ok) throw new Error(sim.message);
      const signed = await VectraWallet.sign(state.wallet, state.account, tx);
      let signature = signed.signature;
      if (signed.mode === 'signed') signature = await VectraChain.sendRaw(signed.raw);
      let status = 'confirmed';
      try {
        await VectraChain.confirm(signature, block.lastValidBlockHeight);
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
    recordResults(preview, results);
    showSendResult(preview, results, '');
  } catch (failure) {
    if (results.length) recordResults(preview, results);
    const message = explain(failure);
    if (results.length) showSendResult(preview, results, message);
    else if (errorBox) {
      errorBox.textContent = message;
      if (button) {
        button.disabled = false;
        button.textContent = 'Sign and send';
      }
    } else notify(message);
  } finally {
    state.sending = false;
    refreshBalances(true);
  }
}
function recordResults(preview, results) {
  const batches = results.filter((result) => result.signature).map((result) => ({
    signature: result.signature,
    status: result.status,
    amountDisplay: result.amountDisplay,
    recipients: result.recipients,
  }));
  if (!batches.length) return;
  state.payouts.unshift({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    network: 'devnet',
    reference: preview.reference,
    memo: preview.memo,
    totalDisplay: preview.totalDisplay,
    batches,
  });
  persistPayouts();
}
function showSendResult(preview, results, failure) {
  state.sending = false;
  const lines = results.map((result) => {
    const href = core.explorerTxUrl(result.signature);
    return `<div class="quote-row"><span>${esc(result.status)}</span><strong>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(shortAddress(result.signature))}</a>` : esc(result.signature)}</strong></div>`;
  }).join('');
  modal(failure ? 'Payout incomplete' : 'Payout submitted', `<p class="lead">${failure ? esc(failure) : 'The signed devnet transaction' + (results.length === 1 ? ' is' : 's are') + ' confirmed. Devnet tokens have no cash value.'}</p><div class="quote-row"><span>Reference</span><strong>${esc(preview.reference)}</strong></div>${lines}<div class="notice">Links open Solana Explorer on the devnet cluster. This browser saved the signatures locally.</div><button type="button" class="btn primary full" data-action="close">Done</button>`);
  document.querySelector('.modal')?.classList.add('modal-wide');
}
function routeReview(event) {
  event.preventDefault();
  notify('Routing is a labeled preview. It does not send funds.');
}
function review(id) {
  const proposal = state.proposals.find((item) => item.id === id) || {
    name: id === 'seed-1' ? 'October contributor payroll' : 'Operations wallet funding',
    amount: id === 'seed-1' ? 18000 : 2500,
    seed: true,
    type: 'Transfer',
  };
  modal('Review treasury proposal', `<p>${esc(proposal.name)}</p><div class="quote-row"><span>Amount</span><strong>${money(proposal.amount)} USDC</strong></div><div class="quote-row"><span>Approval policy</span><strong>2 of 3 signatures</strong></div><div class="quote-row"><span>On-chain signature</span><strong>Not submitted</strong></div><div class="notice">${proposal.type === 'Routing' ? 'Live routing and costs must be verified first.' : 'A local review is not an on-chain signature. Squads is not connected. Use Send USDC with a devnet wallet to sign a real devnet transfer.'}</div><button type="button" class="btn primary full" id="local-review">${proposal.type === 'Routing' ? 'Return to routing' : 'Record local review'}</button>`);
  document.getElementById('local-review').onclick = () => {
    if (proposal.type === 'Routing') {
      close();
      navigate('Routing preview');
      return;
    }
    if (!proposal.seed) {
      proposal.status = 'Reviewed';
      persistDemo();
    }
    close();
    render();
    notify(proposal.seed ? 'Illustrative proposal reviewed. No signature requested.' : 'Local review recorded. On-chain signatures still required.');
  };
}
function exportReport() {
  const csv = core.buildReportCsv({
    payouts: state.payouts,
    demoRows: initialTx.map((row) => ({ name: row.name, sub: row.sub, amount: row.amount, status: row.status, date: row.date })),
    proposals: state.proposals,
  });
  const blob = new Blob([csv], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'vectra-devnet-payouts.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  notify('CSV exported. Devnet rows include signatures and explorer URLs. Demo rows are labeled.');
}
function isoToday() {
  const date = new Date();
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}
function donationMode() {
  const address = String(DONATION_ADDRESS || '').trim();
  if (!address) return { live: false, address: '', reason: 'empty' };
  if (!core.isSolanaAddress(address) || !core.isSolanaAddress(core.DEVNET_USDC_MINT)) return { live: false, address: '', reason: 'invalid' };
  return { live: true, address, reason: 'ready' };
}
let donationDraft = '';
let donationAmount = null;
function supportBlurb() {
  return 'Devnet test mode. Pick an amount from $1,999 to $100,000. You send devnet USDC from your own wallet. Those tokens have no cash value.';
}
function donationSettingsNote() {
  const mode = donationMode();
  if (!mode.live) return 'Donations are in demo mode until a valid Solana address is set. No funds can be sent.';
  return 'Donations on this build are devnet-only test mode. The recipient is ' + mode.address + '. The Solana Pay link uses devnet USDC mint ' + core.DEVNET_USDC_MINT + '. Devnet tokens have no cash value. This site never signs, never moves funds, and cannot confirm receipt. Mainnet donations are not available.';
}
function landingIntro() {
  return `<div class="landing-row"><section class="about-card"><div class="about-kicker">What is Vectra?</div><p class="about-lead">Vectra is a calm workspace for Solana treasury teams. This lite build can send devnet USDC from a wallet you control. Mainnet, Squads, and live routing are still locked.</p><div class="try"><div class="try-label">Try it</div><ol><li><span>1</span><p><strong>Connect</strong> Phantom, Solflare, or Backpack on devnet, or use the simulated demo.</p></li><li><span>2</span><p><strong>Review</strong> a multi-recipient devnet USDC payout. Simulation runs before you sign.</p></li><li><span>3</span><p><strong>Keep</strong> the signature locally and open it on Solana Explorer.</p></li></ol></div></section><section class="support-card"><div class="pill">Devnet test mode</div><h2>Support Vectra</h2><p>${esc(supportBlurb())}</p><button type="button" class="btn primary" data-action="donate">Support Vectra</button></section></div>`;
}
function refreshRecipientRemoves() {
  const rows = [...document.querySelectorAll('.recipient')];
  rows.forEach((row) => {
    const button = row.querySelector('[data-action="remove-recipient"]');
    if (!button) return;
    const hide = rows.length < 2;
    button.disabled = hide;
    button.classList.toggle('is-hidden', hide);
  });
}
function syncDonationField() {
  const input = document.getElementById('donation-amount');
  if (!input) return;
  donationDraft = input.value;
  const parsed = core.parseDonation(input.value);
  const error = document.getElementById('donation-error');
  const hint = document.getElementById('donation-hint');
  if (error) error.textContent = !input.value.trim() ? '' : (parsed.error || '');
  if (hint) {
    if (parsed.ok) hint.textContent = 'Devnet test amount · ' + core.formatDonationNumber(parsed.amount) + ' USDC · no cash value';
    else if (parsed.incomplete) hint.textContent = 'Add cents, or remove the decimal point.';
    else hint.textContent = '';
  }
  document.querySelectorAll('[data-donation-preset]').forEach((button) => {
    const preset = Number(button.dataset.amount);
    const on = !!(parsed.ok && preset === parsed.amount);
    button.classList.toggle('active', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  input.setAttribute('aria-invalid', !parsed.ok && input.value.trim() ? 'true' : 'false');
}
function donationPresets() {
  return [DONATION_MIN, 5000, 10000, 25000, DONATION_MAX].filter((amount, index, list) => amount >= DONATION_MIN && amount <= DONATION_MAX && list.indexOf(amount) === index);
}
function openDonate(step) {
  const mode = donationMode();
  if (step === 'confirm') {
    const parsed = core.parseDonation(donationDraft);
    if (!parsed.ok) {
      openDonate('amount');
      return;
    }
    donationAmount = parsed.amount;
    const link = core.solanaPayLink(mode.address, parsed.amount);
    if (mode.live && link) {
      modal('Devnet test donation', `<p class="demo-callout">Devnet only · test mode</p><p class="lead">This does not send dollars. It is a devnet USDC transfer you make from your own wallet. Devnet tokens have no cash value. Vectra does not sign, does not move funds, and cannot confirm receipt.</p><div class="quote-row"><span>Devnet USDC amount</span><strong>${esc(core.formatDonationNumber(parsed.amount))}</strong></div><div class="quote-row"><span>Bounds</span><strong>$1,999 to $100,000</strong></div><div class="field"><label for="donation-address">Recipient address</label><div class="copy-line"><input id="donation-address" readonly spellcheck="false" value="${esc(mode.address)}"><button type="button" class="btn" data-action="copy-donation-address">Copy</button></div></div><div class="field"><label for="donation-mint">Devnet USDC mint</label><input id="donation-mint" readonly spellcheck="false" value="${esc(core.DEVNET_USDC_MINT)}"></div><div class="field"><label for="donation-link">Solana Pay link</label><div class="copy-line copy-stack"><textarea id="donation-link" readonly spellcheck="false" rows="4">${esc(link)}</textarea><button type="button" class="btn primary" data-action="copy-donation-link">Copy link</button></div><small>Set your wallet to Devnet. Mainnet USDC is not used. A copied link is not a receipt.</small></div><button type="button" class="btn full" data-action="donation-back">Edit amount</button>`);
      document.querySelector('.modal')?.classList.add('modal-wide');
      return;
    }
    modal('Confirm donation', `<p class="demo-callout">Demo mode</p><p class="lead">The donation address is not a valid Solana address, so nothing can be sent.</p><div class="quote-row"><span>Amount</span><strong>${money(parsed.amount)} USDC</strong></div><div class="notice">No wallet will open from this preview, and no funds move.</div><button type="button" class="btn primary full" data-action="donation-demo-confirm">Confirm demo donation</button><button type="button" class="btn full" data-action="donation-back">Edit amount</button>`);
    document.querySelector('.modal')?.classList.add('modal-wide');
    return;
  }
  if (step === 'demo-success') {
    const amountBit = donationAmount != null ? ' of ' + money(donationAmount) + ' USDC' : '';
    modal('Preview complete', `<p class="demo-callout">Demo only, no funds moved</p><p class="lead">That was a simulated donation${esc(amountBit)}. Devnet tokens have no cash value. Your keys stay in your wallet.</p><button type="button" class="btn primary full" data-action="close">Done</button>`);
    document.querySelector('.modal')?.classList.add('modal-wide');
    donationDraft = '';
    return;
  }
  const chips = donationPresets().map((amount) => `<button type="button" class="chip" data-action="donation-preset" data-donation-preset="1" data-amount="${amount}" aria-pressed="false">$${esc(core.formatDonationNumber(amount))}</button>`).join('');
  modal('Support Vectra', `<p class="demo-callout">Devnet only · test mode</p><p class="lead">The $1,999 to $100,000 bounds are the product limits. On devnet you would send test USDC, which has no cash value. This page never signs.</p><form id="donation-form"><div class="field"><label for="donation-amount">Amount · devnet USDC</label><div class="amount-chips">${chips}</div><input id="donation-amount" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="1,999.00" aria-describedby="donation-error donation-hint" value="${esc(donationDraft)}"><small>Minimum $1,999. Maximum $100,000. Not a dollar balance.</small><p class="hint" id="donation-hint"></p><p class="error" id="donation-error" role="alert"></p></div><button class="btn primary full" type="submit">Continue</button></form>`);
  document.querySelector('.modal')?.classList.add('modal-wide');
  const input = document.getElementById('donation-amount');
  const form = document.getElementById('donation-form');
  input?.addEventListener('input', syncDonationField);
  input?.addEventListener('blur', () => {
    const loose = core.looseDonationNumber(input.value);
    if (loose.kind === 'number') input.value = core.formatDonationNumber(loose.amount);
    syncDonationField();
  });
  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    const loose = core.looseDonationNumber(input.value);
    if (loose.kind === 'number') input.value = core.formatDonationNumber(loose.amount);
    syncDonationField();
    const parsed = core.parseDonation(input.value);
    const error = document.getElementById('donation-error');
    if (!parsed.ok) {
      if (error) error.textContent = parsed.error || 'Enter a number, like 5,000';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    donationDraft = input.value;
    donationAmount = parsed.amount;
    openDonate('confirm');
  });
  syncDonationField();
  input?.focus();
}
async function copyDonationValue(id, message) {
  const input = document.getElementById(id);
  if (!input) return;
  const value = input.value;
  input.focus();
  input.select();
  let copied = false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      copied = true;
    }
  } catch { /* Clipboard permissions can fail. Fall back to a selection. */ }
  if (!copied) {
    try { copied = document.execCommand('copy'); } catch { copied = false; }
  }
  notify(copied ? message : 'Text selected. Copy it with Ctrl+C or Command+C.');
}

document.addEventListener('click', (event) => {
  const page = event.target.closest('[data-page]');
  if (page) {
    navigate(page.dataset.page);
    return;
  }
  const filter = event.target.closest('[data-filter]');
  if (filter) {
    state.filter = filter.dataset.filter;
    render();
    return;
  }
  const reviewButton = event.target.closest('[data-review]');
  if (reviewButton) {
    review(reviewButton.dataset.review);
    return;
  }
  const actionEl = event.target.closest('[data-action]');
  const action = actionEl?.dataset.action;
  switch (action) {
    case 'connect':
      state.connectIntent = '';
      connect();
      break;
    case 'close':
      close();
      break;
    case 'demo-connect': {
      const turningOff = state.walletMode === 'demo';
      if (state.walletMode === 'live') disconnectLive();
      else clearLiveLocal();
      state.walletMode = turningOff ? 'none' : 'demo';
      close();
      render();
      notify(state.walletMode === 'demo' ? 'Simulated demo wallet on. Balances are fictional.' : 'Simulated demo wallet off.');
      break;
    }
    case 'wallet-connect': {
      const wallet = state.walletChoices[Number(actionEl.dataset.walletIndex)];
      if (wallet) connectLive(wallet);
      break;
    }
    case 'disconnect-live':
      disconnectLive().then(() => {
        close();
        render();
        notify('Wallet disconnected. Nothing was signed.');
      });
      break;
    case 'send':
      if (state.walletMode === 'none') {
        state.connectIntent = 'send';
        connect();
      } else paymentForm(false);
      break;
    case 'schedule':
      if (globalThis.VectraSchedule && VectraSchedule.isRemote()) VectraSchedule.openCreate();
      else paymentForm(true);
      break;
    case 'route':
      navigate('Routing preview');
      break;
    case 'approvals':
      navigate('Approvals');
      break;
    case 'add-recipient':
      if (document.querySelectorAll('.recipient').length < 20) {
        document.getElementById('recipients').insertAdjacentHTML('beforeend', recipientRow());
        refreshRecipientRemoves();
      } else notify('You can add up to 20 recipients.');
      break;
    case 'remove-recipient': {
      const row = actionEl?.closest('.recipient');
      if (row && document.querySelectorAll('.recipient').length > 1) row.remove();
      refreshRecipientRemoves();
      break;
    }
    case 'notifications':
      if (globalThis.VectraSchedule && VectraSchedule.isRemote()) VectraSchedule.openInbox();
      else modal('Treasury notifications', '<div class="notice">Devnet payouts you sign show up in the activity log. Sample proposals are not signatures.</div><p>No transfer is sent from this notice.</p><button type="button" class="btn full" data-action="approvals-close">View approvals</button>');
      break;
    case 'approvals-close':
      close();
      navigate('Approvals');
      break;
    case 'export':
      exportReport();
      break;
    case 'range':
      state.range = state.range === 'This month' ? 'Last 30 days' : 'This month';
      render();
      notify('Illustrative totals stay labeled for both periods.');
      break;
    case 'network':
      networkModal();
      break;
    case 'use-devnet':
      close();
      notify('Devnet stays selected. Mainnet is locked.');
      break;
    case 'refresh-balances':
      refreshBalances(true);
      break;
    case 'sign-payout':
      sendPreview();
      break;
    case 'back-to-form':
      close();
      paymentForm(false);
      break;
    case 'donate':
      openDonate('amount');
      break;
    case 'donation-preset': {
      const input = document.getElementById('donation-amount');
      const amount = Number(actionEl?.dataset.amount);
      if (input && Number.isFinite(amount)) {
        input.value = core.formatDonationNumber(amount);
        syncDonationField();
        input.focus();
      }
      break;
    }
    case 'donation-back':
      openDonate('amount');
      break;
    case 'donation-demo-confirm':
      openDonate('demo-success');
      break;
    case 'copy-donation-address':
      copyDonationValue('donation-address', 'Address copied.');
      break;
    case 'copy-donation-link':
      copyDonationValue('donation-link', 'Payment link copied.');
      break;
    case 'reset':
      modal('Reset demo data?', '<p>Remove proposals and schedules created in this browser. Illustrative sample records and devnet payout history stay.</p><button type="button" class="btn primary full" data-action="confirm-reset">Reset local demo</button>');
      break;
    case 'confirm-reset':
      state.proposals = [];
      state.schedules = [];
      persistDemo();
      close();
      render();
      notify('Local demo data reset. Payout signatures were kept.');
      break;
    case 'clear-payouts':
      modal('Clear payout history?', '<p>Remove saved signatures from this browser. This does not cancel anything already sent on devnet.</p><button type="button" class="btn primary full" data-action="confirm-clear-payouts">Clear history</button>');
      break;
    case 'confirm-clear-payouts':
      state.payouts = [];
      persistPayouts();
      close();
      render();
      notify('Payout history cleared on this browser.');
      break;
    default:
      break;
  }
  if (event.target.classList.contains('overlay')) close();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') close();
  if (event.key === 'Tab' && document.querySelector('.modal')) {
    const elements = [...document.querySelectorAll('.modal button, .modal input, .modal select, .modal textarea, .modal a')].filter((element) => !element.disabled);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
});

globalThis.VectraApp = {
  state,
  render,
  notify,
  modal,
  close,
  explain,
  pageHeading,
  devnetBanner,
  icon,
  solText,
  recordResults,
  showSendResult,
};
VectraWallet.start();
render();
