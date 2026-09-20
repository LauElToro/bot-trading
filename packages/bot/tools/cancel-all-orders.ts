import { grvtClient } from '../src/api/client.js';
import dotenv from 'dotenv';

dotenv.config();

async function cancelAllOrders() {
  try {
    console.log('Cancelling all open orders...');
    const cancelledCount = await grvtClient.cancelAllOrders();
    console.log(`${cancelledCount} orders cancelled`);

    const remainingOrders = await grvtClient.getOpenOrders();
    if (remainingOrders.length > 0) {
      console.log(`${remainingOrders.length} orders still open:`);
      for (const order of remainingOrders) {
        console.log(`  - ${order.order_id}: ${order.side} ${order.size} ${order.instrument} @ ${order.price}`);
      }
    } else {
      console.log('No open orders remaining');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error cancelling orders:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

setTimeout(() => {
  console.log('Safety timeout reached');
  process.exit(1);
}, 25000);

cancelAllOrders();
