# Funding Rate Arbitrage Bot Extension

This is a Chrome Extension that monitors funding rates on Binance and Delta Exchange to find arbitrage opportunities.

## Installation

1.  Open Chrome and navigate to `chrome://extensions`.
2.  Enable **Developer mode** (top right toggle).
3.  Click **Load unpacked**.
4.  Select the `dist` folder in this project directory:
    `c:\Users\romit\Desktop\newBOt\funding-rate-extension\dist`

## Features

*   **Real-time Monitoring**: Fetches funding rates from Binance (Premium Index) and Delta Exchange (Tickers).
*   **Arbitrage Calculation**: Calculates the spread (absolute percentage difference) between the two exchanges.
*   **Filtering & Sorting**: Filter by minimum spread and sort by rates or APR.
*   **Telegram Alerts**: Configure your Bot Token and Chat ID to receive alerts for high-spread opportunities.
    *   *Note*: Use `@BotFather` on Telegram to create a bot and get a token. Use `@userinfobot` to get your Chat ID.

## Development

*   Run `npm run dev` to start the development server (useful for UI testing).
*   Run `npm run build` to rebuild the extension after making changes.
