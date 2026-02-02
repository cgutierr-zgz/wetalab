/**
 * Discord Webhook Notifications
 * 
 * Sends rich embed notifications to Discord for:
 * - Trade entries (side, edge, strength, position size)
 * - Trade resolutions (result, P&L, portfolio update)
 */

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

// Embed colors
const COLORS = {
  UP: 0x45FFB2,      // Green for UP trades
  DOWN: 0xFF5C7A,    // Red for DOWN trades
  WIN: 0x45FFB2,     // Green for wins
  LOSS: 0xFF5C7A,    // Red for losses
  INFO: 0x00D9FF,    // Cyan for info
  WARNING: 0xFFCC66, // Amber for warnings
};

/**
 * Check if Discord notifications are enabled
 */
export function isDiscordEnabled() {
  return !!DISCORD_WEBHOOK_URL && DISCORD_WEBHOOK_URL.startsWith('https://discord.com/api/webhooks/');
}

/**
 * Send a message to Discord webhook
 * @param {Object} payload - Discord webhook payload
 * @returns {Promise<boolean>} - Success status
 */
async function sendWebhook(payload) {
  if (!isDiscordEnabled()) {
    return false;
  }

  try {
    const response = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[Discord] Webhook failed: ${response.status} ${response.statusText}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Discord] Webhook error:', error.message);
    return false;
  }
}

/**
 * Format currency value
 */
function formatCurrency(value) {
  return `$${value.toFixed(2)}`;
}

/**
 * Format percentage
 */
function formatPercent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Format timestamp
 */
function formatTimestamp(ms) {
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Send notification on trade entry
 * @param {Object} trade - PaperTrade object
 * @param {Object} portfolio - Current portfolio state
 */
export async function notifyTradeEntry(trade, portfolio) {
  const sideEmoji = trade.side === 'UP' ? '📈' : '📉';
  const strengthEmoji = trade.strength === 'STRONG' ? '💪' : trade.strength === 'GOOD' ? '👍' : '🤔';
  
  const embed = {
    title: `${sideEmoji} New Trade: BTC ${trade.side}`,
    color: COLORS[trade.side],
    fields: [
      {
        name: '💰 Position Size',
        value: formatCurrency(trade.positionSize),
        inline: true,
      },
      {
        name: '📊 Edge',
        value: formatPercent(trade.edge),
        inline: true,
      },
      {
        name: `${strengthEmoji} Strength`,
        value: trade.strength || 'N/A',
        inline: true,
      },
      {
        name: '⏱️ Phase',
        value: trade.phase || 'N/A',
        inline: true,
      },
      {
        name: '🎯 Entry Price',
        value: formatCurrency(trade.entryPrice),
        inline: true,
      },
      {
        name: '🏁 Price to Beat',
        value: formatCurrency(trade.priceToBeat),
        inline: true,
      },
      {
        name: '💵 Portfolio Balance',
        value: formatCurrency(portfolio.balance),
        inline: true,
      },
      {
        name: '📈 Win Rate',
        value: `${(portfolio.winRate * 100).toFixed(1)}%`,
        inline: true,
      },
      {
        name: '🔢 Total Trades',
        value: `${portfolio.wins + portfolio.losses}`,
        inline: true,
      },
    ],
    footer: {
      text: `Trade ID: ${trade.id}`,
    },
    timestamp: new Date(trade.entryTimestamp).toISOString(),
  };

  // Add indicators snapshot if available
  if (trade.indicators) {
    const indicatorText = [];
    if (trade.indicators.rsi) indicatorText.push(`RSI: ${trade.indicators.rsi.toFixed(1)}`);
    if (trade.indicators.macdHistogram !== undefined) {
      indicatorText.push(`MACD Hist: ${trade.indicators.macdHistogram.toFixed(4)}`);
    }
    if (trade.indicators.heikenAshi) {
      indicatorText.push(`HA: ${trade.indicators.heikenAshi.color} (${trade.indicators.heikenAshi.consecutiveCount})`);
    }
    if (trade.indicators.adx) indicatorText.push(`ADX: ${trade.indicators.adx.toFixed(1)}`);
    if (trade.indicators.detectedRegime) indicatorText.push(`Regime: ${trade.indicators.detectedRegime}`);
    
    if (indicatorText.length > 0) {
      embed.fields.push({
        name: '📉 Indicators',
        value: indicatorText.join(' | '),
        inline: false,
      });
    }
  }

  // Add smart money signal if present
  if (trade.indicators?.smartMoneySignal) {
    embed.fields.push({
      name: '🐋 Smart Money',
      value: `Signal: ${trade.indicators.smartMoneySignal} (Net Imbalance: ${(trade.indicators.netImbalance * 100).toFixed(1)}%)`,
      inline: false,
    });
  }

  return sendWebhook({
    username: 'BTC Paper Trader',
    avatar_url: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
    embeds: [embed],
  });
}

/**
 * Send notification on trade resolution
 * @param {Object} trade - Resolved PaperTrade object
 * @param {Object} portfolio - Updated portfolio state
 */
export async function notifyTradeResolution(trade, portfolio) {
  const resultEmoji = trade.result === 'WIN' ? '✅' : '❌';
  const pnlEmoji = trade.pnl >= 0 ? '💰' : '💸';
  const sideEmoji = trade.side === 'UP' ? '📈' : '📉';
  
  const embed = {
    title: `${resultEmoji} Trade ${trade.result}: BTC ${trade.side}`,
    color: COLORS[trade.result],
    fields: [
      {
        name: `${pnlEmoji} P&L`,
        value: `${trade.pnl >= 0 ? '+' : ''}${formatCurrency(trade.pnl)}`,
        inline: true,
      },
      {
        name: '💰 Position Size',
        value: formatCurrency(trade.positionSize),
        inline: true,
      },
      {
        name: '📊 Edge',
        value: formatPercent(trade.edge),
        inline: true,
      },
      {
        name: '🎯 Entry Price',
        value: formatCurrency(trade.entryPrice),
        inline: true,
      },
      {
        name: '🏁 Exit Price',
        value: formatCurrency(trade.exitPrice),
        inline: true,
      },
      {
        name: '🎲 Price to Beat',
        value: formatCurrency(trade.priceToBeat),
        inline: true,
      },
    ],
    footer: {
      text: `Trade ID: ${trade.id}`,
    },
    timestamp: new Date(trade.resolvedTimestamp).toISOString(),
  };

  // Price comparison
  const priceDiff = trade.exitPrice - trade.priceToBeat;
  const priceDiffPct = (priceDiff / trade.priceToBeat) * 100;
  const direction = priceDiff > 0 ? 'ABOVE' : 'BELOW';
  
  embed.fields.push({
    name: '📏 Price vs Target',
    value: `${direction} by ${formatCurrency(Math.abs(priceDiff))} (${Math.abs(priceDiffPct).toFixed(3)}%)`,
    inline: false,
  });

  // Portfolio update section
  embed.fields.push(
    {
      name: '💵 New Balance',
      value: formatCurrency(portfolio.balance),
      inline: true,
    },
    {
      name: '📈 Total P&L',
      value: `${portfolio.totalPnl >= 0 ? '+' : ''}${formatCurrency(portfolio.totalPnl)}`,
      inline: true,
    },
    {
      name: '🎯 Win Rate',
      value: `${(portfolio.winRate * 100).toFixed(1)}% (${portfolio.wins}W/${portfolio.losses}L)`,
      inline: true,
    },
    {
      name: '📉 Max Drawdown',
      value: `${(portfolio.maxDrawdown * 100).toFixed(2)}%`,
      inline: true,
    },
    {
      name: '🏔️ Peak Balance',
      value: formatCurrency(portfolio.peakBalance),
      inline: true,
    },
    {
      name: '🔥 Streak',
      value: portfolio.consecutiveLosses > 0 ? `${portfolio.consecutiveLosses} losses` : 'None',
      inline: true,
    }
  );

  return sendWebhook({
    username: 'BTC Paper Trader',
    avatar_url: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
    embeds: [embed],
  });
}

/**
 * Send a simple notification message
 * @param {string} message - Message text
 * @param {string} type - Message type (INFO, WARNING, etc.)
 */
export async function notifyMessage(message, type = 'INFO') {
  const embed = {
    description: message,
    color: COLORS[type] || COLORS.INFO,
    timestamp: new Date().toISOString(),
  };

  return sendWebhook({
    username: 'BTC Paper Trader',
    avatar_url: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
    embeds: [embed],
  });
}

/**
 * Send session summary notification
 * @param {Object} summary - Session summary data
 */
export async function notifySessionSummary(summary) {
  const embed = {
    title: '📊 Session Summary',
    color: summary.totalPnl >= 0 ? COLORS.WIN : COLORS.LOSS,
    fields: [
      {
        name: '📈 Total Trades',
        value: `${summary.totalTrades}`,
        inline: true,
      },
      {
        name: '✅ Wins',
        value: `${summary.wins}`,
        inline: true,
      },
      {
        name: '❌ Losses',
        value: `${summary.losses}`,
        inline: true,
      },
      {
        name: '🎯 Win Rate',
        value: `${(summary.winRate * 100).toFixed(1)}%`,
        inline: true,
      },
      {
        name: '💰 Total P&L',
        value: `${summary.totalPnl >= 0 ? '+' : ''}${formatCurrency(summary.totalPnl)}`,
        inline: true,
      },
      {
        name: '💵 Final Balance',
        value: formatCurrency(summary.finalBalance),
        inline: true,
      },
      {
        name: '📐 Sharpe Ratio',
        value: summary.sharpeRatio !== undefined ? summary.sharpeRatio.toFixed(2) : 'N/A',
        inline: true,
      },
    ],
    footer: {
      text: 'Paper Trading Session',
    },
    timestamp: new Date().toISOString(),
  };

  // Add phase breakdown if available
  if (summary.byPhase) {
    const phaseText = Object.entries(summary.byPhase)
      .map(([phase, data]) => `${phase}: ${data.wins}W/${data.losses}L (${formatCurrency(data.pnl)})`)
      .join('\n');
    
    if (phaseText) {
      embed.fields.push({
        name: '⏱️ By Phase',
        value: phaseText || 'N/A',
        inline: false,
      });
    }
  }

  // Add strength breakdown if available
  if (summary.byStrength) {
    const strengthText = Object.entries(summary.byStrength)
      .map(([strength, data]) => `${strength}: ${data.wins}W/${data.losses}L (${formatCurrency(data.pnl)})`)
      .join('\n');
    
    if (strengthText) {
      embed.fields.push({
        name: '💪 By Strength',
        value: strengthText || 'N/A',
        inline: false,
      });
    }
  }

  return sendWebhook({
    username: 'BTC Paper Trader',
    avatar_url: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
    embeds: [embed],
  });
}

/**
 * Send error notification
 * @param {string} context - Error context
 * @param {Error|string} error - Error object or message
 */
export async function notifyError(context, error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  const embed = {
    title: '⚠️ Error Alert',
    color: COLORS.WARNING,
    fields: [
      {
        name: '📍 Context',
        value: context,
        inline: false,
      },
      {
        name: '❌ Error',
        value: errorMessage.substring(0, 1000), // Discord field limit
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  return sendWebhook({
    username: 'BTC Paper Trader',
    avatar_url: 'https://cryptologos.cc/logos/bitcoin-btc-logo.png',
    embeds: [embed],
  });
}

/**
 * Setup Discord notifications for PaperTradingEngine
 * @param {Object} engine - PaperTradingEngine instance
 */
export function setupDiscordNotifications(engine) {
  if (!isDiscordEnabled()) {
    console.log('[Discord] Notifications disabled (no webhook URL configured)');
    return;
  }

  console.log('[Discord] Notifications enabled');

  // Store original callbacks
  const originalOnTradeEntered = engine.onTradeEntered;
  const originalOnTradeResolved = engine.onTradeResolved;

  // Wrap trade entry callback
  engine.onTradeEntered = async (trade, portfolio) => {
    // Call original callback first
    if (originalOnTradeEntered) {
      await originalOnTradeEntered(trade, portfolio);
    }

    // Send Discord notification
    try {
      await notifyTradeEntry(trade, portfolio);
    } catch (error) {
      console.error('[Discord] Failed to send trade entry notification:', error.message);
    }
  };

  // Wrap trade resolution callback
  engine.onTradeResolved = async (trade, portfolio, finalPrice) => {
    // Call original callback first
    if (originalOnTradeResolved) {
      await originalOnTradeResolved(trade, portfolio, finalPrice);
    }

    // Send Discord notification
    try {
      await notifyTradeResolution(trade, portfolio);
    } catch (error) {
      console.error('[Discord] Failed to send trade resolution notification:', error.message);
    }
  };
}

// Export all functions
export default {
  isDiscordEnabled,
  notifyTradeEntry,
  notifyTradeResolution,
  notifyMessage,
  notifySessionSummary,
  notifyError,
  setupDiscordNotifications,
};
