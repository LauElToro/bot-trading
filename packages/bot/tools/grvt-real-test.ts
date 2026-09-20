import dotenv from 'dotenv';

dotenv.config();

async function testMarketDataDirect() {
  console.log('Testing GRVT public market data...');

  try {
    const instrumentsRes = await fetch('https://market-data.grvt.io/full/v1/instruments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });

    if (instrumentsRes.ok) {
      const instruments = await instrumentsRes.json();
      console.log('Instruments endpoint ok', Array.isArray(instruments) ? instruments.length : typeof instruments);
    } else {
      console.log('Instruments request failed:', instrumentsRes.status, await instrumentsRes.text());
    }

    const btcTickerRes = await fetch('https://market-data.grvt.io/full/v1/ticker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instrument: 'BTC_USDT_Perp' })
    });

    if (btcTickerRes.ok) {
      console.log('BTC ticker ok');
    } else {
      console.log('BTC ticker failed:', btcTickerRes.status, await btcTickerRes.text());
    }
  } catch (error) {
    console.error('Market data test error:', error);
  }
}

async function testTradingAuth() {
  try {
    const tradingRes = await fetch('https://trades.grvt.io/full/v1/account_summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sub_account_id: process.env.GRVT_TRADING_ACCOUNT_ID
      })
    });
    console.log('Trading API status:', tradingRes.status);
  } catch (error) {
    console.error('Trading auth test error:', error);
  }
}

async function runRealTests() {
  await testMarketDataDirect();
  await testTradingAuth();
}

runRealTests();
