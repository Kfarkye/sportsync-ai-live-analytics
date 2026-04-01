/**
 * billing.js — Firestore-native billing logic for SportsSync.
 *
 * Collections:
 *   billing_customers   – one doc per Stripe customer
 *   billing_api_keys    – one doc per issued API key (hash-indexed)
 *   billing_events      – idempotency ledger for Stripe webhook events
 *   billing_key_tokens  – ephemeral tokens for post-checkout key retrieval
 *
 * No column-guessing.  Every field name is deterministic.
 */

import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';

const db = () => getFirestore();

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function generateApiKey() {
  const random = randomBytes(32).toString('base64url');
  return `ssk_${random}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ── Idempotency ──────────────────────────────────────────────────────────────

export async function hasProcessedEvent(eventId) {
  const doc = await db().collection('billing_events').doc(eventId).get();
  return doc.exists;
}

export async function recordEvent(event, status = 'processed', errorMessage = null) {
  await db().collection('billing_events').doc(event.id).set({
    event_type: event.type,
    status,
    error_message: errorMessage,
    processed_at: nowIso(),
    stripe_created: event.created,
  });
}

// ── Customer Management ──────────────────────────────────────────────────────

/**
 * Find or create a customer doc keyed by stripe_customer_id.
 * Returns { docId, ...customerData }.
 */
export async function findOrCreateCustomer({
  email,
  stripeCustomerId,
  stripeSubscriptionId,
  product,
  plan,
  name,
}) {
  const col = db().collection('billing_customers');

  // 1. Try by stripe_customer_id (canonical key)
  if (stripeCustomerId) {
    const byStripe = await col.doc(stripeCustomerId).get();
    if (byStripe.exists) {
      const updates = {
        email,
        product,
        plan,
        status: 'active',
        stripe_subscription_id: stripeSubscriptionId || null,
        updated_at: nowIso(),
      };
      if (name) updates.name = name;
      await col.doc(stripeCustomerId).update(updates);
      return { docId: stripeCustomerId, ...byStripe.data(), ...updates };
    }
  }

  // 2. Try by email (fallback for pre-existing customers)
  if (email) {
    const byEmail = await col.where('email', '==', email).limit(1).get();
    if (!byEmail.empty) {
      const existing = byEmail.docs[0];
      const updates = {
        stripe_customer_id: stripeCustomerId || null,
        stripe_subscription_id: stripeSubscriptionId || null,
        product,
        plan,
        status: 'active',
        updated_at: nowIso(),
      };
      if (name) updates.name = name;
      await existing.ref.update(updates);
      return { docId: existing.id, ...existing.data(), ...updates };
    }
  }

  // 3. Create new
  const docId = stripeCustomerId || email;
  if (!docId) throw new Error('customer_create_failed: no customer_id or email');
  const doc = {
    email,
    name: name || null,
    stripe_customer_id: stripeCustomerId || null,
    stripe_subscription_id: stripeSubscriptionId || null,
    product,
    plan,
    status: 'active',
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  await col.doc(docId).set(doc);
  return { docId, ...doc };
}

// ── API Key Management ───────────────────────────────────────────────────────

/**
 * Generate an API key for a customer.  Stores the hash in Firestore,
 * returns the plaintext key (shown once to user via retrieval token).
 */
export async function generateApiKeyForCustomer({ customerId, email, plan }) {
  const plaintext = generateApiKey();
  const keyHash = sha256(plaintext);
  const prefix = plaintext.slice(0, 8);

  await db().collection('billing_api_keys').doc(keyHash).set({
    customer_id: customerId,
    email: email || null,
    key_hash: keyHash,
    key_prefix: prefix,
    tier: plan || 'pro',
    is_primary: true,
    active: true,
    revoked_at: null,
    expires_at: null,
    created_at: nowIso(),
  });

  return { plaintext, keyHash, prefix };
}

/**
 * Validate an API key.  Returns customer doc data if valid, null otherwise.
 */
export async function validateApiKey(rawKey) {
  const keyHash = sha256(rawKey);
  const doc = await db().collection('billing_api_keys').doc(keyHash).get();
  if (!doc.exists) return null;

  const data = doc.data();
  if (!data.active) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at) <= new Date()) return null;

  return data;
}

/**
 * Deactivate all keys for a customer.
 */
export async function deactivateCustomerKeys(customerId) {
  const snap = await db()
    .collection('billing_api_keys')
    .where('customer_id', '==', customerId)
    .where('active', '==', true)
    .get();

  const batch = db().batch();
  snap.docs.forEach((doc) => {
    batch.update(doc.ref, { active: false, revoked_at: nowIso() });
  });
  await batch.commit();
  return snap.size;
}

/**
 * Reactivate all non-expired keys for a customer.
 * FIX: removes the .is('revoked_at', null) bug from the old Supabase version.
 */
export async function reactivateCustomerKeys(customerId) {
  const snap = await db()
    .collection('billing_api_keys')
    .where('customer_id', '==', customerId)
    .where('active', '==', false)
    .get();

  const batch = db().batch();
  snap.docs.forEach((doc) => {
    batch.update(doc.ref, { active: true, revoked_at: null });
  });
  await batch.commit();
  return snap.size;
}

/**
 * Rotate: create new key, mark old key as non-primary with grace period.
 */
export async function rotateApiKey(oldKeyHash) {
  const oldDoc = await db().collection('billing_api_keys').doc(oldKeyHash).get();
  if (!oldDoc.exists) throw new Error('rotate_failed: key not found');

  const oldData = oldDoc.data();
  const graceUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 day grace

  // Demote old key
  await oldDoc.ref.update({
    is_primary: false,
    rotation_grace_until: graceUntil,
  });

  // Generate new primary
  const { plaintext, keyHash, prefix } = await generateApiKeyForCustomer({
    customerId: oldData.customer_id,
    email: oldData.email,
    plan: oldData.tier,
  });

  return {
    new_key: plaintext,
    new_prefix: prefix,
    old_key_prefix: oldData.key_prefix,
    old_key_grace_until: graceUntil,
  };
}

/**
 * Revoke a specific key by prefix.
 */
export async function revokeApiKeyByPrefix(customerId, keyPrefix) {
  const snap = await db()
    .collection('billing_api_keys')
    .where('customer_id', '==', customerId)
    .where('key_prefix', '==', keyPrefix)
    .where('active', '==', true)
    .limit(1)
    .get();

  if (snap.empty) return { revoked: false, remaining_active_keys: 0 };

  await snap.docs[0].ref.update({ active: false, revoked_at: nowIso() });

  // Count remaining
  const remaining = await db()
    .collection('billing_api_keys')
    .where('customer_id', '==', customerId)
    .where('active', '==', true)
    .count()
    .get();

  return { revoked: true, remaining_active_keys: remaining.data().count };
}

// ── Key Retrieval Tokens ─────────────────────────────────────────────────────

/**
 * Store a one-time retrieval token keyed by checkout session ID.
 * Expires in 1 hour.
 */
export async function insertKeyRetrievalToken({ sessionId, customerId, apiKeyPlaintext }) {
  await db().collection('billing_key_tokens').doc(sessionId).set({
    customer_id: customerId,
    api_key_plaintext: apiKeyPlaintext,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    used: false,
    created_at: nowIso(),
  });
}

/**
 * Retrieve and consume a key token.  Returns null if expired/used/missing.
 */
export async function retrieveKeyToken(sessionId) {
  const ref = db().collection('billing_key_tokens').doc(sessionId);
  const doc = await ref.get();
  if (!doc.exists) return null;

  const data = doc.data();
  if (data.used) return null;
  if (new Date(data.expires_at) <= new Date()) return null;

  // Mark as used
  await ref.update({ used: true, retrieved_at: nowIso() });

  return {
    key: data.api_key_plaintext,
    customer_id: data.customer_id,
  };
}

// ── Customer Status Updates ──────────────────────────────────────────────────

export async function updateCustomerStatus(stripeCustomerId, status, subId = null) {
  const ref = db().collection('billing_customers').doc(stripeCustomerId);
  const doc = await ref.get();
  if (!doc.exists) return false;

  const updates = { status, updated_at: nowIso() };
  if (subId) updates.stripe_subscription_id = subId;
  await ref.update(updates);
  return true;
}

/**
 * Resolve internal customer doc ID from a Stripe customer ID.
 */
export async function resolveCustomerByStripe(stripeCustomerId) {
  const doc = await db().collection('billing_customers').doc(stripeCustomerId).get();
  return doc.exists ? { docId: doc.id, ...doc.data() } : null;
}

// ── List keys for customer ───────────────────────────────────────────────────

export async function listCustomerKeys(customerId) {
  const snap = await db()
    .collection('billing_api_keys')
    .where('customer_id', '==', customerId)
    .orderBy('created_at', 'desc')
    .get();

  return snap.docs.map((d) => {
    const data = d.data();
    return {
      key_prefix: data.key_prefix,
      active: data.active,
      is_primary: data.is_primary,
      tier: data.tier,
      created_at: data.created_at,
      expires_at: data.expires_at,
      revoked_at: data.revoked_at,
      rotation_grace_until: data.rotation_grace_until || null,
    };
  });
}
