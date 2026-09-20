import dns from 'dns';
import { grvtClient } from '../src/api/client.js';

dns.setDefaultResultOrder('ipv4first');

async function testEIP712Order() {
  console.log('Testing EIP-712 order signing...');

  try {
    const balance = await grvtClient.getBalance();
    console.log(`Balance available: $${balance.available_balance}`);

    const testOrder = {
      sub_account_id: process.env.GRVT_TRADING_ACCOUNT_ID!,
      instrument: 'ETH_USDT_Perp',
      size: '0.02',
      price: '1700',
      side: 'buy' as const,
      type: 'limit' as const,
      time_in_force: 'gtc' as const,
      metadata: 'EIP712-test'
    };

    let orderId: string | null = null;

    try {
      const createdOrder = await grvtClient.createOrder(testOrder);
      orderId = createdOrder.order_id;
      console.log(`Order created: ${orderId}`);
    } catch (createError) {
      console.error('Error creating order:', createError);
      if (createError instanceof Error) {
        console.error('Error message:', createError.message);
      }
      return false;
    }

    if (orderId) {
      try {
        const cancelled = await grvtClient.cancelOrder(orderId, testOrder.instrument);
        console.log(cancelled ? 'Order cancelled' : 'Could not cancel order');
      } catch (cancelError) {
        console.error('Error cancelling order:', cancelError);
      }
    }

    console.log('EIP-712 test completed');
    return true;
  } catch (error) {
    console.error('Test failed:', error);
    return false;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  testEIP712Order()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export default testEIP712Order;
