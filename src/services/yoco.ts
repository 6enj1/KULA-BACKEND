import axios from 'axios';

const YOCO_API_URL = 'https://payments.yoco.com/api';
const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY || '';

interface CreateCheckoutParams {
  amount: number;          // Amount in cents (e.g., 4500 for R45.00)
  currency?: string;       // Default: ZAR
  orderId: string;         // Your order reference
  orderNumber: string;     // Human-readable order number
  customerEmail?: string;
  customerName?: string;
  successUrl: string;      // Redirect after success
  cancelUrl: string;       // Redirect after cancel
  failureUrl?: string;     // Redirect after failure
  metadata?: Record<string, string>;
}

interface YocoCheckoutResponse {
  id: string;
  redirectUrl: string;
  status: string;
}

interface YocoPaymentResponse {
  id: string;
  status: 'succeeded' | 'completed' | 'failed' | 'pending';
  amount: number;
  currency: string;
  metadata?: Record<string, string>;
  createdDate: string;
  paymentMethodDetails?: {
    card?: {
      maskedCard: string;
      scheme: string;
    };
  };
}

/**
 * Create a Yoco checkout session
 * Returns a URL to redirect the user to for payment
 */
export async function createCheckout(params: CreateCheckoutParams): Promise<YocoCheckoutResponse> {
  const {
    amount,
    currency = 'ZAR',
    orderId,
    orderNumber,
    customerEmail,
    customerName,
    successUrl,
    cancelUrl,
    failureUrl,
    metadata = {},
  } = params;

  const requestBody = {
    amount,
    currency,
    successUrl,
    cancelUrl,
    failureUrl: failureUrl || cancelUrl,
    metadata: {
      ...metadata,
      orderId,
      orderNumber,
      customerEmail: customerEmail || '',
      customerName: customerName || '',
    },
  };

  const response = await axios.post(
    `${YOCO_API_URL}/checkouts`,
    requestBody,
    {
      headers: {
        'Authorization': `Bearer ${YOCO_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    id: response.data.id,
    redirectUrl: response.data.redirectUrl,
    status: response.data.status,
  };
}

/**
 * Get checkout/payment status
 */
export async function getCheckoutStatus(checkoutId: string): Promise<YocoPaymentResponse> {
  const response = await axios.get(
    `${YOCO_API_URL}/checkouts/${checkoutId}`,
    {
      headers: {
        'Authorization': `Bearer ${YOCO_SECRET_KEY}`,
      },
    }
  );

  return response.data;
}

/**
 * Verify webhook signature from Yoco (Standard Webhooks format)
 * Signed content = "${webhook-id}.${webhook-timestamp}.${body}"
 * Secret is base64-encoded with "whsec_" prefix
 * Signature is base64-encoded HMAC SHA256
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookId: string,
  webhookTimestamp: string,
  webhookSecret: string
): boolean {
  const crypto = require('crypto');

  // Decode the secret (remove "whsec_" prefix, then base64 decode)
  const secretBytes = Buffer.from(webhookSecret.replace('whsec_', ''), 'base64');

  // Construct signed content
  const signedContent = `${webhookId}.${webhookTimestamp}.${payload}`;

  const expectedSignature = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  // Signature header may contain multiple sigs like "v1,<base64sig> v1,<base64sig>"
  const signatures = signature.split(' ').map((s: string) => s.split(',')[1]);

  return signatures.some((sig: string) => {
    try {
      return crypto.timingSafeEqual(
        Buffer.from(sig, 'base64'),
        Buffer.from(expectedSignature, 'base64')
      );
    } catch {
      return false;
    }
  });
}

/**
 * Process refund
 */
export async function createRefund(
  paymentId: string,
  amount?: number // Optional partial refund amount in cents
): Promise<{ id: string; status: string }> {
  const response = await axios.post(
    `${YOCO_API_URL}/refunds`,
    {
      paymentId,
      ...(amount && { amount }),
    },
    {
      headers: {
        'Authorization': `Bearer ${YOCO_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return {
    id: response.data.id,
    status: response.data.status,
  };
}

export default {
  createCheckout,
  getCheckoutStatus,
  verifyWebhookSignature,
  createRefund,
};
