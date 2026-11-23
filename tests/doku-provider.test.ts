import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  DokuProvider,
  dokuSignature,
} from '../src/modules/payments/doku-provider.js';
import { merchantInvoice } from '../src/modules/payments/service.js';
import {
  dokuFixture,
  dokuTime,
  signedHeaders,
} from './helpers/doku-fixture.js';

const invoice = merchantInvoice('WEB-20261123-000001', 1);
const creation = {
  invoice,
  requestId: randomUUID(),
  amount: 105000n,
  currency: 'IDR',
  returnUrl:
    'https://example.test/account/orders/WEB-20261123-000001/payment/return',
  locale: 'id',
} as const;
const notice = (status: string, type?: string) =>
  JSON.stringify(
    {
      order: { invoice_number: invoice, amount: 105000, currency: 'IDR' },
      transaction: {
        status,
        type,
        date: dokuTime,
        original_request_id: creation.requestId,
      },
      additional_info: { arbitrary_new_field: true },
    },
    null,
    2,
  );

describe('DOKU Checkout adapter', () => {
  it('signs the exact bytes using a fixed HMAC fixture', () => {
    expect(
      dokuSignature(
        'test-only-key',
        'test-merchant',
        'event-1',
        dokuTime,
        '/payments/doku/notification',
        '{}',
      ),
    ).toBe('HMACSHA256=BMfRL2o4B+NEYzUg+F3x1VVVE3fpQgnZKZobFkfduck=');
  });
  it('uses documented integer, invoice, redirect, timestamp and hosted expiry fields', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: ['SUCCESS'],
          response: {
            order: {
              invoice_number: invoice,
              amount: '105000',
              session_id: 'session-1',
            },
            payment: {
              url: 'https://sandbox.doku.com/checkout-link-v2/test',
              expired_date: '20261123140000',
            },
          },
        }),
      ),
    );
    const provider = new DokuProvider(
      dokuFixture,
      send,
      () => new Date(dokuTime),
    );
    await expect(provider.createPayment(creation)).resolves.toEqual({
      checkoutUrl: 'https://sandbox.doku.com/checkout-link-v2/test',
      reference: 'session-1',
      expiresAt: new Date('2026-11-23T07:00:00Z'),
    });
    const [endpoint, options] = send.mock.calls[0]!;
    expect(endpoint).toBe('https://api-sandbox.doku.com/checkout/v1/payment');
    expect(options?.headers).toMatchObject({
      'Request-Id': creation.requestId,
      'Request-Timestamp': dokuTime,
      Signature: dokuSignature(
        dokuFixture.secretKey,
        dokuFixture.clientId,
        creation.requestId,
        dokuTime,
        '/checkout/v1/payment',
        String(options?.body),
      ),
    });
    expect(JSON.parse(String(options?.body))).toMatchObject({
      order: {
        invoice_number: invoice,
        amount: 105000,
        callback_url_result: creation.returnUrl,
        language: 'ID',
      },
      additional_info: {
        override_notification_url: dokuFixture.notificationUrl,
      },
    });
    expect(merchantInvoice('WEB-20261123-2147483647', 2147483647)).toMatch(
      /^[A-Z0-9]{1,30}$/,
    );
    expect(merchantInvoice('WEB-20261123-000001', 2)).not.toBe(invoice);
  });
  it.each(['FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED'])(
    'ignores non-success status %s',
    (status) => {
      const body = notice(status);
      expect(
        new DokuProvider(dokuFixture).verifyNotification(
          signedHeaders(body, 'event'),
          Buffer.from(body),
        ).outcome,
      ).toBe('IGNORED');
    },
  );
  it('authenticates success by original request and tolerates additional provider fields', () => {
    const provider = new DokuProvider(dokuFixture);
    const body = notice('SUCCESS', 'SALE');
    expect(
      provider.verifyNotification(
        signedHeaders(body, 'event'),
        Buffer.from(body),
      ),
    ).toMatchObject({
      outcome: 'PAID',
      amount: 105000n,
      originalRequestId: creation.requestId,
      invoice,
    });
    const authorized = notice('SUCCESS', 'AUTHORIZE');
    expect(
      provider.verifyNotification(
        signedHeaders(authorized, 'event'),
        Buffer.from(authorized),
      ).outcome,
    ).toBe('IGNORED');
  });
  it('rejects wrong client, invalid signature, missing headers, invalid date and fractional money', () => {
    const provider = new DokuProvider(dokuFixture);
    const body = notice('SUCCESS');
    const headers = signedHeaders(body, 'event');
    for (const changed of [
      { ...headers, 'client-id': 'wrong' },
      { ...headers, signature: '' },
      { ...headers, 'request-id': undefined },
      signedHeaders(body, 'event', '2026-02-30T00:00:00Z'),
    ])
      expect(() =>
        provider.verifyNotification(changed, Buffer.from(body)),
      ).toThrow();
    expect(() =>
      provider.verifyNotification(headers, Buffer.from(body + '\n')),
    ).toThrow();
    for (const invalid of [
      '{',
      body.replace('105000', '105000.00000000000001'),
    ])
      expect(() =>
        provider.verifyNotification(
          signedHeaders(invalid, 'event'),
          Buffer.from(invalid),
        ),
      ).toThrow();
  });
  it('treats uncertain or untrusted provider responses as unresolved', async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response('duplicate', { status: 400 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            message: ['SUCCESS'],
            response: {
              order: { invoice_number: invoice, amount: '105000' },
              payment: {
                url: 'https://example.test/checkout',
                expired_date: '20261123140000',
              },
            },
          }),
        ),
      );
    const provider = new DokuProvider(dokuFixture, send);
    for (let i = 0; i < 3; i++)
      await expect(provider.createPayment(creation)).rejects.toMatchObject({
        reason: 'uncertain',
      });
    await expect(
      provider.createPayment({ ...creation, amount: 1_000_000_000_000n }),
    ).rejects.toMatchObject({ reason: 'invalid-request' });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
