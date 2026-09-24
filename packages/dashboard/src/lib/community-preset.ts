import type { CommunityBot, WizardPreset } from '@/lib/api-types';
import { formatPublicHandle } from '@/components/profile-tags';

export function presetFromCopy(
  bot: CommunityBot,
  extra?: {
    rangeAdapted?: boolean;
    originalRange?: { lower: number; upper: number };
    markPrice?: number | null;
  },
): WizardPreset {
  return {
    pair: bot.pair,
    direction: bot.direction,
    leverage: bot.leverage,
    lower_price: bot.lowerPrice,
    upper_price: bot.upperPrice,
    num_grids: bot.numGrids,
    investment_usdt: bot.investmentUsdt,
    virtual_enabled: bot.virtualEnabled,
    active_window_size: bot.activeWindowSize ?? undefined,
    sl_pct: bot.slPct ?? undefined,
    tp_pct: bot.tpPct ?? undefined,
    auto_shift_enabled: bot.autoShiftEnabled,
    auto_shift_pct: bot.autoShiftPct ?? undefined,
    compound_pct: bot.compoundPct ?? undefined,
    copiedFrom: {
      publishedId: bot.id,
      sourceBotId: bot.sourceBotId,
      authorName: formatPublicHandle(bot.author.name, bot.author.tags),
      rangeAdapted: extra?.rangeAdapted,
      originalLower: extra?.originalRange?.lower,
      originalUpper: extra?.originalRange?.upper,
      markPrice: extra?.markPrice ?? undefined,
    },
  };
}
