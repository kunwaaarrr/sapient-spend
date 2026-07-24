// node test/testdata-check.mjs — asserts the Profile → "Load test data" fixture actually
// produces every pending-review state it claims to cover (it rots silently otherwise).
import assert from 'node:assert/strict';

const _ls = {};
globalThis.localStorage = {
  getItem: k => (k in _ls ? _ls[k] : null),
  setItem: (k, v) => { _ls[k] = String(v); },
  removeItem: k => { delete _ls[k]; },
};

const { store, INFLOW } = await import('../js/store.js');
const { loadTestData } = await import('../js/seed.js');

loadTestData();

const accId = name => store.state.accounts.find(a => a.name === name).id;
const checking = accId('Everyday Checking');
const visa = accId('Visa Credit Card');
const groups = store.pendingGroups(checking);
const byName = name => groups.find(g => g.payeeName.includes(name));

// --- merchant normalization: separate payee records collapse into one group ---
// (the two seeded WOOLWORTHS 1234/5678 records, plus the demo's own pending Woolworths import row)
const woolies = groups.filter(g => /woolworths/i.test(g.payeeName));
assert.equal(woolies.length, 1, 'the WOOLWORTHS payee records collapse into a single group');
assert.ok(woolies[0].count >= 4, `that group holds every row (got ${woolies[0].count})`);
const distinctPayees = new Set(woolies[0].memberIds.map(id => store.state.transactions.find(t => t.id === id).payeeId));
assert.ok(distinctPayees.size >= 2, 'and its members come from more than one payee record — normalization did the merging');

// --- card states ---
const kmart = byName('Kmart');
assert.ok(kmart && kmart.categoryId == null && kmart.count === 1, 'uncategorised, single row -> flat CTA card');

const bunnings = byName('Bunnings');
assert.ok(bunnings && bunnings.categoryId == null && bunnings.count === 2, 'uncategorised x2 -> CTA + one deck layer');

const aldi = byName('Aldi');
assert.ok(aldi && aldi.count === 3 && aldi.categoryId != null && aldi.autoCategorized, 'x3 guessed -> "suggested" + two deck layers');

const coles = byName('Coles Express');
assert.ok(coles && coles.categoryId != null && !coles.autoCategorized, 'user-confirmed category -> quiet pill');

const uber = byName('Uber Eats');
assert.ok(uber && uber.count === 3 && uber.categoryId == null && !uber.allSameCategory, 'mixed categories -> no agreed category');

const inflow = byName('Side Gig');
assert.equal(inflow.categoryId, INFLOW, 'inflow row -> Ready to Assign');

// --- deck depth is driven by count, so make sure all three depths are present ---
const counts = new Set(groups.map(g => Math.min(g.count, 3)));
assert.ok(counts.has(1) && counts.has(2) && counts.has(3), 'fixture shows flat, one-layer and two-layer decks');

// --- grouping is per account: same merchant on two accounts = two groups ---
const spotifyHere = byName('Spotify');
const spotifyThere = store.pendingGroups(visa).find(g => g.payeeName.includes('Spotify'));
assert.ok(spotifyHere && spotifyThere, 'Spotify pends on both accounts');
assert.notEqual(spotifyHere.key, spotifyThere.key, 'and they are separate groups, not merged');

// --- transfers: the incoming leg is never offered for review ---
const incoming = store.state.transactions.find(t => t.transferAccountId && t.amount > 0 && !t.approved);
assert.ok(incoming, 'fixture includes a pending transfer pair');
const allGroups = [...groups, ...store.pendingGroups(accId('Savings'))];
assert.ok(!allGroups.some(g => g.memberIds.includes(incoming.id)), 'incoming transfer leg excluded from review');

// --- learned merchants sheet has rules to show ---
const taught = store.state.payees.filter(p => p.lastCategoryId != null);
assert.ok(taught.length >= 2, 'fixture teaches some payees so Learned merchants is not empty');

// --- split + flag coverage (feed rendering) ---
assert.ok(store.state.transactions.some(t => t.subtransactions && !t.approved), 'a pending split transaction exists');
assert.ok(store.state.transactions.some(t => t.flag && !t.approved), 'a pending flagged transaction exists');

// --- the demo base survived (budget states, loans, scheduled) ---
assert.ok(store.state.accounts.length >= 6, 'demo accounts (incl. loans) still present');
assert.ok(store.state.scheduled.length > 0, 'scheduled transactions still present');
assert.ok(Object.keys(store.state.budget).length > 0, 'budget assignments still present');

// deterministic: loading twice gives the same shape
const firstCount = store.state.transactions.length;
loadTestData();
assert.equal(store.state.transactions.length, firstCount, 'reloading the fixture is idempotent, not cumulative');

console.log('testdata-check: all assertions passed');
