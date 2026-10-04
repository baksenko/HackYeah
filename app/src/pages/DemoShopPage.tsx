import { useConnection } from '@solana/wallet-adapter-react'
import { Keypair, PublicKey } from '@solana/web3.js'
import { useEffect, useState } from 'react'

import { Address } from '../components/Address'
import { explorerTx } from '../lib/cluster'
import { formatUsdc, parseUsdc } from '../lib/format'
import { findPayment, type FoundPayment } from '../lib/paymentCheck'
import { USDC_MINT } from '../lib/program'

/**
 * DEMO MERCHANT. A pretend café that takes a group payment through Chip In
 * the way a real shop would: it creates a Solana Pay link with a fresh
 * reference for each order, then watches the chain for a payment carrying
 * that reference and checks the amount itself. There is no backend -- a real
 * shop would run the same check (lib/paymentCheck.ts) on its server.
 *
 * Its receiving address comes from the public seed
 * sha256("chip-in:demo-shop:v1"), so anyone could move what it receives: it is
 * a demo that only ever receives test money.
 */
const DEMO_SHOP = new PublicKey('4Wp1hsob5W9Nhm9WgFMyhDbDt6qbgJJgzvDCkE2qgBw4')
const SHOP_NAME = 'Demo Café'
const ITEMS = [
  { name: 'Oat flat white', quantity: 4, price: '4.20' },
  { name: 'Cardamom bun', quantity: 4, price: '3.50' },
] as const
const ORDER_AMOUNT = '30.8' // 4 × 4.20 + 4 × 3.50
const ORDER_TOTAL = parseUsdc(ORDER_AMOUNT)

type Order = { number: number; reference: string }
const ORDER_KEY = 'chipin:demo-shop:order'

/** A new order with a fresh reference. Kept in this browser so a reload keeps watching it. */
function newOrder(): Order {
  const order = { number: Math.floor(1000 + Math.random() * 9000), reference: Keypair.generate().publicKey.toBase58() }
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order))
  } catch {
    // Storage blocked: the order simply lasts until the page is closed.
  }
  return order
}

function savedOrder(): Order {
  try {
    const saved = JSON.parse(localStorage.getItem(ORDER_KEY) ?? 'null') as Order | null
    if (saved?.reference) return saved
  } catch {
    // Unreadable: start a new order.
  }
  return newOrder()
}

/** The Solana Pay transfer request a shop shows at checkout. */
function paymentLink(order: Order): string {
  const params = new URLSearchParams({
    amount: ORDER_AMOUNT,
    'spl-token': USDC_MINT.toBase58(),
    reference: order.reference,
    label: `${SHOP_NAME} order #${order.number}`,
    memo: `demo-order-${order.number}`,
  })
  return `solana:${DEMO_SHOP.toBase58()}?${params.toString()}`
}

export function DemoShopPage() {
  const { connection } = useConnection()
  const [order, setOrder] = useState<Order>(savedOrder)
  const [paid, setPaid] = useState<{ reference: string; payment: FoundPayment } | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const link = paymentLink(order)
  const isPaid = paid?.reference === order.reference

  // Watch the chain for a payment carrying this order's reference.
  useEffect(() => {
    if (isPaid) return
    let cancelled = false
    const check = async () => {
      try {
        const payment = await findPayment(connection, new PublicKey(order.reference), {
          recipient: DEMO_SHOP,
          mint: USDC_MINT,
          amount: BigInt(ORDER_TOTAL.toString()),
        })
        if (cancelled) return
        setCheckError(null)
        if (payment) setPaid({ reference: order.reference, payment })
      } catch {
        if (!cancelled) setCheckError('Could not reach the network to check for the payment. Still trying…')
      }
    }
    void check()
    const id = setInterval(() => void check(), 3000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [connection, order.reference, isPaid])

  return (
    <article className="demo-shop">
      <div className="notice notice-blocked">
        <strong>This is a demo shop, not a real store.</strong>
        <p>
          It shows how a shop can take a group payment through Chip In using Solana Pay. It only
          deals in test USDC, and anyone can move what its demo address receives.
        </p>
      </div>

      <section className="panel">
        <span className="eyebrow">{SHOP_NAME}</span>
        <h1>Order #{order.number}</h1>
        <table className="table">
          <tbody>
            {ITEMS.map((item) => (
              <tr key={item.name}>
                <td>
                  {item.quantity} × {item.name}
                </td>
                <td className="right">{formatUsdc(BigInt(parseUsdc(item.price).toString()) * BigInt(item.quantity))}</td>
              </tr>
            ))}
            <tr className="review-total">
              <td>Total</td>
              <td className="right">{formatUsdc(ORDER_TOTAL)}</td>
            </tr>
          </tbody>
        </table>

        {isPaid ? (
          <div className="notice notice-success">
            <strong>Order paid ✓</strong>
            <p>
              The shop found a payment carrying this order&apos;s reference, and its own USDC
              balance went up by exactly {formatUsdc(ORDER_TOTAL)}.
              {paid.payment.memo ? ` It carried the memo “${paid.payment.memo}”.` : ''}
            </p>
            <a href={explorerTx(paid.payment.signature)} target="_blank" rel="noreferrer">
              See the payment on Solana Explorer →
            </a>
            <button type="button" className="link-button" onClick={() => setOrder(newOrder())}>
              Start a new order
            </button>
          </div>
        ) : (
          <div className="actions">
            <a
              className="button button-primary"
              href={`/create?pay=${encodeURIComponent(link)}`}
              target="_blank"
              rel="noreferrer"
            >
              Pay together with Chip In
            </a>
            <p className="aside">
              Opens Chip In with this order filled in. Your group collects the {formatUsdc(ORDER_TOTAL)};
              when the goal is reached, anyone sends it here. If the group does not make it, everyone
              gets their money back — and this order stays unpaid.
            </p>
            <p className="aside">
              Waiting for payment… This page checks the chain every few seconds for a transaction
              carrying this order&apos;s reference.
            </p>
            {checkError && <p className="aside warn">{checkError}</p>}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>How the shop knows it has been paid</h2>
        <ul className="review-facts">
          <li>Each order gets a fresh, random reference key. It goes into the payment link.</li>
          <li>
            Chip In stores the reference with the group&apos;s campaign, and the program refuses any
            payout that does not carry it — so the payout is always findable, whoever sends it.
          </li>
          <li>
            The shop looks up transactions by the reference and checks, from the transaction itself,
            that its USDC went up by exactly the order total. It trusts nothing else.
          </li>
        </ul>
        <dl className="campaign-parties">
          <dt>Shop address</dt>
          <dd>
            <Address address={DEMO_SHOP.toBase58()} explorer />
          </dd>
          <dt>Reference</dt>
          <dd>
            <Address address={order.reference} explorer />
          </dd>
        </dl>
        <p className="aside">Payment link:</p>
        <input className="share-url mono" value={link} readOnly onFocus={(e) => e.currentTarget.select()} />
      </section>
    </article>
  )
}
