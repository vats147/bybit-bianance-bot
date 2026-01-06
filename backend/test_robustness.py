import pytest
import asyncio
import httpx
from unittest.mock import patch, MagicMock
from main import app, AUTO_TRADE_CONFIG, ACTIVE_AUTO_TRADES

# Use AsyncClient for async tests
from httpx import AsyncClient, ASGITransport

transport = ASGITransport(app=app)

# -------------------------------------------------------------------
# MOCK DATA
# -------------------------------------------------------------------

MOCK_BINANCE_PREMIUM_INDEX = [
    {
        "symbol": "BTCUSDT",
        "markPrice": "50000.00",
        "lastFundingRate": "0.01", # 1% Funding Rate! Giant.
        "nextFundingTime": 1700000000000
    }
]

# -------------------------------------------------------------------
# TESTS
# -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_invalid_qty_input():
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post("/api/place-order", json={
            "symbol": "BTC",
            "side": "Buy",
            "qty": -1.0,
            "leverage": 5
        }, headers={"X-User-Bybit-Key": "test", "X-User-Bybit-Secret": "test"})
        
    # Expect failure
    assert response.status_code in [400, 422, 500] 

@pytest.mark.asyncio
async def test_missing_keys():
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post("/api/place-order", json={
            "symbol": "BTC",
            "side": "Buy",
            "qty": 0.01
        })
    # Might be 400 or 500 depending on exact logic, but shouldn't look like success
    assert response.status_code != 200

@pytest.mark.asyncio
async def test_duplicate_trade_submission():
    """
    Test Race Condition: 
    Sending 5 concurrent force-trade requests. 
    Only 1 should succeed.
    """
    ACTIVE_AUTO_TRADES.clear()
    
    with patch('requests.get') as mock_get, \
         patch('main.fetch_bybit_rates', new_callable=MagicMock) as mock_bybit, \
         patch('main.execute_auto_trade_entry', new_callable=MagicMock) as mock_exec:
        
        # Setup Mocks
        mock_get.return_value.status_code = 200
        mock_get.return_value.json.return_value = MOCK_BINANCE_PREMIUM_INDEX
        
        async def async_mock_bybit(*args, **kwargs):
            return {
                "BTC": {"markPrice": 50010.0, "rate": 0.0001, "nextFundingTime": 1700000000000}
            }
        mock_bybit.side_effect = async_mock_bybit
        
        async def async_mock_exec(*args, **kwargs):
            await asyncio.sleep(0.05) # Delay to widen the race window
            return True
        mock_exec.side_effect = async_mock_exec

        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            tasks = []
            for _ in range(5):
                tasks.append(ac.post("/api/auto-trade/force", 
                                     headers={"X-User-Bybit-Key": "k", "X-User-Binance-Key": "k"}))
            
            responses = await asyncio.gather(*tasks)
            results = [r.json() for r in responses]
            
            print(f"Results: {results}")
            
            success_count = sum(1 for r in results if r.get('status') == 'success')
            
            # With Lock, only 1 should succeed. 
            # The others should fail with "already active" logic in main.py
            # Logic in main.py: "if symbol in ACTIVE_AUTO_TRADES: continue/return"
            # That logic is inside the Lock now.
            assert success_count == 1
