'use strict';

/**
 * Payment provider adapters.
 *
 * The storefront only knows two verbs: "start a payment" and "somebody says it
 * settled". Everything provider-specific lives here, so switching from the
 * sandbox to Zarinpal is a matter of credentials — not of touching the order,
 * payment or LTH code.
 *
 * Contract:
 *   start(payment, { amountToman, description, callbackUrl }) →
 *     { mode: 'redirect', url } | { mode: 'html', html } | { mode: 'sandbox' }
 *   verify(query, payment) →
 *     { ok: boolean, ref: string|null, outcome: 'success'|'fail', raw }
 *   signatureOk(query) → boolean   (reject forgeries before doing anything)
 *
 * Nothing here writes to the database: the caller owns the transaction. That
 * keeps the fulfilment logic (orders, service requests, LTH contracts) in one
 * place for both sandbox and live providers.
 */

const crypto = require('crypto');
const config = require('../../config');

/** Sandbox: the built-in signed page, zero credentials needed. */
const sandbox = {
  key: 'sandbox',
  label: 'درگاه آزمایشی',
  live: false,
  start() { return { mode: 'sandbox' }; },
  verify() { return { ok: false, ref: null, outcome: 'fail', raw: { reason: 'sandbox_has_no_verify' } }; },
  signatureOk() { return true; }
};

/**
 * Zarinpal REST API v4 (the de-facto standard Iranian PSP).
 * Docs: POST /pg/v4/payment/request.json → { data: { authority, code } }
 *       GET  /pg/v4/payment/verify.json?Authority=…&Amount=… → { data: { ref_id, code } }
 * Amounts are in Rial.
 */
const zarinpal = {
  key: 'zarinpal',
  label: 'زرین‌پال',
  live: true,
  // Read lazily: configuration can change at runtime (tests, config reload)
  // and a captured copy at require time is a classic source of "it worked in
  // staging only" bugs.
  get merchantId() { return process.env.CM_PAYMENT_MERCHANT_ID || ''; },
  get baseUrl() { return process.env.CM_PAYMENT_BASE_URL || 'https://api.zarinpal.com'; },
  async start(payment, { amountToman, description, callbackUrl }) {
    const amountRial = Number(amountToman) * 10;
    const res = await fetch(`${this.baseUrl}/pg/v4/payment/request.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        merchant_id: this.merchantId,
        amount: amountRial,
        callback_url: callbackUrl,
        description,
        metadata: { order_id: payment.id }
      })
    });
    const body = await res.json().catch(() => ({}));
    const authority = body && body.data && body.data.authority;
    if (!res.ok || !authority) {
      const msg = (body && body.errors && body.errors.message) || `HTTP ${res.status}`;
      throw new Error(`zarinpal request failed: ${msg}`);
    }
    return {
      mode: 'redirect',
      url: `${process.env.CM_PAYMENT_GATEWAY_URL || 'https://www.zarinpal.com/pg/StartPay'}/${authority}`,
      authority
    };
  },
  async verify(query, payment) {
    // The gateway appends ?Authority=…&Status=OK|NOK
    const authority = query.Authority || query.authority;
    const status = String(query.Status || query.status || '').toUpperCase();
    if (status !== 'OK' || !authority) {
      return { ok: false, ref: null, outcome: 'fail', raw: { status, authority: authority || null } };
    }
    const amountRial = Number(payment.amount_toman) * 10;
    const url = `${this.baseUrl}/pg/v4/payment/verify.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ merchant_id: this.merchantId, amount: amountRial, authority })
    });
    const body = await res.json().catch(() => ({}));
    // code 100 = verified now, 101 = already verified (safe: our own callback is idempotent)
    const code = body && body.data && body.data.code;
    const refId = body && body.data && body.data.ref_id;
    if (code === 100 || code === 101) {
      return { ok: true, ref: String(refId || authority), outcome: 'success', raw: { code, authority } };
    }
    return { ok: false, ref: null, outcome: 'fail', raw: { code: code || null, authority } };
  },
  signatureOk() {
    // Zarinpal authenticates the callback by us calling verify with the merchant
    // id; there is no shared-secret signature to check here.
    return true;
  }
};

/**
 * Iranian SMS providers, used for login OTP.
 *
 * Both accept a code and a phone in E.164-ish local form (09xxxxxxxxx).
 * Return { ok, provider, id } or throw — the caller decides whether a failed
 * SMS should block login (it should not leak account existence either way).
 */
const smsKavenegar = {
  key: 'kavenegar',
  async send({ phone, code, template }) {
    const apiKey = process.env.CM_SMS_API_KEY || '';
    const sender = process.env.CM_SMS_SENDER || '';
    const text = `کد ورود شما به CENTRAL MINE: ${code}`;
    const params = new URLSearchParams({ receptor: phone, message: text });
    if (sender) params.set('sender', sender);
    const res = await fetch(`https://api.kavenegar.com/v1/${apiKey}/sms/send.json?${params.toString()}`, { method: 'GET' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || (body && body.return && body.return.status !== 200)) {
      throw new Error(`kavenegar failed: ${(body && body.return && body.return.message) || res.status}`);
    }
    const id = body.entries && body.entries[0] && body.entries[0].messageid;
    return { ok: true, provider: 'kavenegar', id: String(id || '') };
  }
};

const smsSmsIr = {
  key: 'smsir',
  async send({ phone, code, template }) {
    const apiKey = process.env.CM_SMS_API_KEY || '';
    const templateId = process.env.CM_SMS_TEMPLATE_ID || '';
    if (templateId) {
      // Verify (template) endpoint: parameters are positional.
      const res = await fetch('https://api.sms.ir/v1/send/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, Accept: 'application/json' },
        body: JSON.stringify({ mobile: phone, templateId: Number(templateId), parameters: [{ name: 'CODE', value: String(code) }] })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== 1) throw new Error(`sms.ir verify failed: ${body.message || res.status}`);
      return { ok: true, provider: 'smsir', id: String((body.data && body.data.messageId) || '') };
    }
    const res = await fetch('https://api.sms.ir/v1/send/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, Accept: 'application/json' },
      body: JSON.stringify({ lineNumber: process.env.CM_SMS_SENDER || '', messageText: `کد ورود شما به CENTRAL MINE: ${code}`, mobiles: [phone] })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== 1) throw new Error(`sms.ir bulk failed: ${body.message || res.status}`);
    return { ok: true, provider: 'smsir', id: String((body.data && body.data.packId) || '') };
  }
};

function paymentProvider() {
  const key = String(process.env.CM_PAYMENT_PROVIDER || '').toLowerCase();
  if (!key || key === 'sandbox') return sandbox;
  if (key === 'zarinpal') {
    if (!zarinpal.merchantId) return sandbox; // misconfigured: stay safe, never half-live
    return zarinpal;
  }
  return sandbox;
}

/** True only when a live provider is selected *and* fully configured. */
function isLivePayment() {
  const p = paymentProvider();
  return Boolean(p.live && p.merchantId);
}

function smsProvider() {
  const key = String(process.env.CM_SMS_PROVIDER || '').toLowerCase();
  if (!key || key === 'sandbox') return null;
  if (key === 'kavenegar' && process.env.CM_SMS_API_KEY) return smsKavenegar;
  if (key === 'smsir' && process.env.CM_SMS_API_KEY) return smsSmsIr;
  return null;
}

/** Human-readable status for /health and the security center. */
function integrationStatus() {
  const pay = paymentProvider();
  const sms = smsProvider();
  return {
    payment_gateway: {
      mode: isLivePayment() ? pay.key : 'sandbox',
      label: pay.label,
      real_connected: isLivePayment()
    },
    sms_otp: {
      mode: sms ? sms.key : 'sandbox',
      real_connected: Boolean(sms)
    },
    push_notifications: { mode: 'inactive', real_connected: false }
  };
}

module.exports = {
  sandbox,
  zarinpal,
  paymentProvider,
  isLivePayment,
  smsProvider,
  integrationStatus,
  signSandbox: (token, outcome) => crypto.createHmac('sha256', config.secret).update(`${token}:${outcome}`).digest('hex')
};
