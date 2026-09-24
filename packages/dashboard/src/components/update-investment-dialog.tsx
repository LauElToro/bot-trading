import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Modal } from '@/components/primitives/modal';
import { Input } from '@/components/primitives/input';
import { Button } from '@/components/primitives/button';
import { Mono } from '@/components/primitives/mono';
import { api } from '@/lib/api-client';
import { formatSize, formatUsd } from '@/lib/format';
import type { BotSummary } from '@/lib/api-types';
import { useT } from '@/i18n';

interface UpdateInvestmentDialogProps {
  open: boolean;
  onClose: () => void;
  bot: BotSummary;
}

export function UpdateInvestmentDialog({ open, onClose, bot }: UpdateInvestmentDialogProps) {
  const t = useT();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(String(bot.investment_usdt));

  useEffect(() => {
    if (open) setAmount(String(bot.investment_usdt));
  }, [open, bot.investment_usdt]);

  const next = parseFloat(amount);
  const valid = Number.isFinite(next) && next > 0;
  const unchanged = valid && Math.abs(next - bot.investment_usdt) < 0.01;

  const mutation = useMutation({
    mutationFn: () => api.updateBotInvestment(bot.id, next),
    onSuccess: (result) => {
      toast.success(t('botDetail.investmentSaved', { amount: formatUsd(result.investmentUsdt) }));
      void queryClient.invalidateQueries({ queryKey: ['bot', bot.id] });
      void queryClient.invalidateQueries({ queryKey: ['bots'] });
      void queryClient.invalidateQueries({ queryKey: ['gridState', bot.id] });
      onClose();
    },
    onError: (err: Error) => {
      toast.error(t('botDetail.investmentFailed', { msg: err.message }));
    },
  });

  const error = amount.length > 0 && !valid ? t('botDetail.investmentInvalid') : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker={bot.pair.replace(/_/g, ' ')}
      title={t('botDetail.investmentTitle')}
      description={t('botDetail.updateInvestmentHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!valid || unchanged || mutation.isPending}
          >
            {mutation.isPending ? t('botDetail.investmentApplying') : t('botDetail.investmentApply')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between border border-border-subtle px-3 py-2 text-sm">
          <span className="text-text-muted">{t('botDetail.investmentCurrent')}</span>
          <Mono>{formatUsd(bot.investment_usdt)}</Mono>
        </div>
        <Input
          label={t('botDetail.investmentNew')}
          numeric
          inputMode="decimal"
          value={amount}
          error={error}
          autoFocus
          onChange={(e) => setAmount(e.target.value)}
        />
        {bot.quantity_per_level != null && bot.quantity_per_level > 0 && (
          <p className="text-xs text-text-muted">
            {t('botDetail.investmentQty', { qty: formatSize(bot.quantity_per_level) })}
          </p>
        )}
        <p className="text-xs leading-5 text-text-secondary">
          {bot.status === 'running' ? t('botDetail.investmentLiveNote') : t('botDetail.investmentPausedNote')}
        </p>
        {unchanged && <p className="text-xs text-text-muted">{t('botDetail.investmentSame')}</p>}
      </div>
    </Modal>
  );
}
